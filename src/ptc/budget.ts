/*
 * PTC 外层程序预算登记
 *
 * PTC 模式下模型写的程序(run_code)带一份 elapsed-time budget; 到期时 runtime 硬停程序,
 * 由调用方结算在途的绑定调用 —— 本插件的提问工具因此收到中止信号, 这一轮提问
 * 既拿不到 pending 结果, 也留不下草稿。
 *
 * 工具执行上下文里没有暴露外层预算, 因此这里从两个来源记下每次 run_code 的到期时刻:
 * 会话事件流的 tool/call(带 callId 与参数)与 tools/execute 派发时刻。
 * 派发时刻更准 —— 之前的包装(例如工作区准备)会把程序真正开始的时间推后 ——
 * 两者取较晚的一个, 供工具侧把等待收敛到外层剩余预算之内:
 * 提问在预算到期前自己按超时结算, 草稿照常随 pending 结果交给模型。
 * 作者: JularDepick
 */

import { MAX_RUN_BUDGETS, PTC_RUN_TOOL_NAME, RUN_BUDGET_TTL_MS } from '../constants'

/* run_code 调用标识 -> 到期时刻(毫秒) */
const runBudgets = new Map<string, number>()

/**
 * 登记一次外层程序的到期时刻。
 * 同一调用会先由调用事件、再由派发钩子登记一次, 取较晚的到期时刻:
 * 派发发生在调用之后, 取较晚的才不会被前置包装低估预算。
 */
export function registerRunBudget(callId: string, deadline: number): void {
  const previous = runBudgets.get(callId)
  if (previous !== undefined && previous >= deadline) return
  runBudgets.delete(callId)
  runBudgets.set(callId, deadline)
  const now = Date.now()
  for (const [id, value] of runBudgets) {
    if (now - value > RUN_BUDGET_TTL_MS) runBudgets.delete(id)
  }
  while (runBudgets.size > MAX_RUN_BUDGETS) {
    const oldest = runBudgets.keys().next()
    if (oldest.done) break
    runBudgets.delete(oldest.value)
  }
}

/** 丢弃一次外层程序的登记 */
export function clearRunBudget(callId: string): void {
  runBudgets.delete(callId)
}

/**
 * 读外层程序的剩余预算(毫秒)。
 * 未登记返回 undefined: 不是 PTC 子调用, 或这次 run_code 的调用事件还没到。
 * 已过期返回 0, 让调用方按"预算不足"处理而不是当成无限预算。
 */
export function runBudgetRemaining(callId: string): number | undefined {
  const deadline = runBudgets.get(callId)
  if (deadline === undefined) return undefined
  const remaining = deadline - Date.now()
  if (remaining > 0) return remaining
  runBudgets.delete(callId)
  return 0
}

/** 清空全部登记(插件卸载时) */
export function resetRunBudgets(): void {
  runBudgets.clear()
}

/* 会话事件里本模块关心的最小面 */
interface SessionEventLike {
  type?: unknown
  time?: unknown
  data?: unknown
}

/* 事件源的最小面: 只用到 session/event 的注册与注销 */
interface SessionEventSource {
  on: (name: 'session/event', listener: (session: unknown, event: SessionEventLike) => void) => () => void
}

/* 派发钩子里本模块关心的最小面 */
interface ToolExecuteLike {
  name?: unknown
  callId?: unknown
  parent?: unknown
  arguments?: unknown
}

/* 工具派发事件源的最小面: around-dispatch 瀑布, 必须把 next() 的结果原样返回 */
interface ToolExecuteSource {
  on: (
    name: 'tools/execute',
    listener: (exec: ToolExecuteLike, next: () => Promise<unknown>) => Promise<unknown>,
  ) => () => void
}

/*
 * 从 run_code 的参数里读出预算。
 * 会话事件里的 arguments 是 JSON 文本, 解析失败或没写 timeoutMs 时用兜底值。
 */
function readBudgetMs(value: unknown, fallback: number): number {
  let args: unknown = value
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args)
    } catch {
      return fallback
    }
  }
  if (args === null || typeof args !== 'object') return fallback
  const requested = (args as { timeoutMs?: unknown }).timeoutMs
  if (typeof requested !== 'number' || !Number.isFinite(requested) || requested <= 0) return fallback
  return Math.round(requested)
}

/**
 * 监听会话事件, 登记每次 run_code 的到期时刻。
 * @param ctx 插件上下文, 只在根上注册一次
 * @param defaultBudgetMs 外层未声明预算时的兜底值, 延迟读取以兼容 PTC 服务后到
 * @returns 注销函数
 */
export function installRunBudgetTracking(ctx: unknown, defaultBudgetMs: () => number): () => void {
  const source = ctx as SessionEventSource
  const executeSource = ctx as unknown as ToolExecuteSource
  let off: (() => void) | undefined
  let offExecute: (() => void) | undefined
  try {
    /*
     * 派发时刻是外层程序真正开始的时刻: 之前的 pre-execute 包装(工作区准备等)
     * 会把开始时间推后, 只按调用事件起算会低估外层预算。
     * 这里只记时间, 不改参数也不碰结果, 出错也不影响派发。
     */
    offExecute = executeSource.on('tools/execute', async (exec, next) => {
      try {
        if (
          exec !== null
          && typeof exec === 'object'
          && exec.name === PTC_RUN_TOOL_NAME
          && exec.parent === undefined
          && typeof exec.callId === 'string'
          && exec.callId !== ''
        ) {
          registerRunBudget(exec.callId, Date.now() + readBudgetMs(exec.arguments, defaultBudgetMs()))
        }
      } catch {
        /* 登记失败不能影响这次工具派发 */
      }
      return next()
    })
  } catch (error) {
    console.warn('[question-timeout-protection] 无法挂上工具派发钩子, PTC 外层预算起点退化为调用时刻', String(error))
  }
  try {
    off = source.on('session/event', (_session, event) => {
      if (event === null || typeof event !== 'object') return
      const type = event.type
      if (type !== 'tool/call' && type !== 'tool/result') return
      const data = event.data as
        | { callId?: unknown; name?: unknown; arguments?: unknown; message?: { toolCallId?: unknown } }
        | undefined
      if (data === null || data === undefined || typeof data !== 'object') return
      if (type === 'tool/result') {
        /* 结果事件的调用标识落在 message 上, 不在 data 顶层 */
        const settledId = data.message?.toolCallId
        if (typeof settledId === 'string' && settledId !== '') clearRunBudget(settledId)
        return
      }
      const callId = data.callId
      if (typeof callId !== 'string' || callId === '') return
      if (data.name !== PTC_RUN_TOOL_NAME) return
      const startedAt = typeof event.time === 'number' ? event.time : Date.now()
      registerRunBudget(callId, startedAt + readBudgetMs(data.arguments, defaultBudgetMs()))
    })
  } catch (error) {
    console.warn('[question-timeout-protection] 无法监听会话事件, PTC 外层预算感知未生效', String(error))
  }
  return () => {
    offExecute?.()
    off?.()
    resetRunBudgets()
  }
}
