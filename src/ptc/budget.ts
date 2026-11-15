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

/*
 * 内层程序的到期时刻: 键为根调用标识, 值为「内层调用标识 -> 到期时刻」。
 * PTC 里可以再嵌套一层 run_code, 提问的寿命此时受内层预算约束,
 * 而工具侧只拿得到根调用标识, 因此把内层登记挂在根标识下, 取最近的那个。
 */
const nestedBudgets = new Map<string, Map<string, number>>()

/* 内层登记到期后的宽限(毫秒): 过了这段时间仍未收到结算事件就按残留清掉 */
const NESTED_BUDGET_GRACE_MS = 5000

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

/** 登记一次内层程序的到期时刻(嵌套 run_code) */
function registerNestedBudget(rootCallId: string, callId: string, deadline: number): void {
  if (rootCallId === '') return
  let entries = nestedBudgets.get(rootCallId)
  if (entries === undefined) {
    entries = new Map<string, number>()
    nestedBudgets.set(rootCallId, entries)
  }
  const previous = entries.get(callId)
  if (previous !== undefined && previous >= deadline) return
  entries.set(callId, deadline)
  while (entries.size > MAX_RUN_BUDGETS) {
    const oldest = entries.keys().next()
    if (oldest.done) break
    entries.delete(oldest.value)
  }
  while (nestedBudgets.size > MAX_RUN_BUDGETS) {
    const oldest = nestedBudgets.keys().next()
    if (oldest.done) break
    nestedBudgets.delete(oldest.value)
  }
}

/** 丢弃一次内层程序的登记(内层调用结算时) */
function clearNestedBudget(callId: string): void {
  for (const [rootCallId, entries] of nestedBudgets) {
    if (!entries.delete(callId)) continue
    if (entries.size === 0) nestedBudgets.delete(rootCallId)
  }
}

/** 丢弃一次外层程序的登记: 根结算时连它名下的内层登记一起清掉 */
export function clearRunBudget(callId: string): void {
  runBudgets.delete(callId)
  clearNestedBudget(callId)
  nestedBudgets.delete(callId)
}

/**
 * 读外层程序的剩余预算(毫秒)。
 * 未登记返回 undefined: 不是 PTC 子调用, 或这次 run_code 的调用事件还没到。
 * 已过期返回 0, 让调用方按"预算不足"处理而不是当成无限预算。
 */
export function runBudgetRemaining(callId: string): number | undefined {
  let deadline = runBudgets.get(callId)
  const nested = nestedBudgets.get(callId)
  if (nested !== undefined) {
    const now = Date.now()
    for (const [id, value] of nested) {
      /*
       * 内层程序到期即已结束, 结果事件万一没到也不能让这条登记长期把根预算压成 0:
       * 过了宽限就按残留清掉。根登记不适用这条, 它到期就意味着程序本身要被硬停。
       */
      if (value + NESTED_BUDGET_GRACE_MS <= now) {
        nested.delete(id)
        continue
      }
      if (deadline === undefined || value < deadline) deadline = value
    }
    if (nested.size === 0) nestedBudgets.delete(callId)
  }
  if (deadline === undefined) return undefined
  /*
   * 过期不删登记: 同一个程序里可能还有第二次提问, 删掉会让它退回未收敛的完整等待,
   * 反而更容易被硬停。登记由调用结算与 TTL 回收。
   */
  const remaining = deadline - Date.now()
  return remaining > 0 ? remaining : 0
}

/** 清空全部登记(插件卸载时) */
export function resetRunBudgets(): void {
  runBudgets.clear()
  nestedBudgets.clear()
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
  rootCallId?: unknown
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
          && typeof exec.callId === 'string'
          && exec.callId !== ''
        ) {
          const deadline = Date.now() + readBudgetMs(exec.arguments, defaultBudgetMs())
          if (exec.parent === undefined) {
            registerRunBudget(exec.callId, deadline)
          } else {
            /* 嵌套的 run_code: 内层预算同样会硬停程序, 挂在根标识下供提问取用 */
            registerNestedBudget(
              typeof exec.rootCallId === 'string' ? exec.rootCallId : '',
              exec.callId,
              deadline,
            )
          }
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
