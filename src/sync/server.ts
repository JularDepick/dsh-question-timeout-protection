/*
 * 客户端到服务端的状态同步通道
 *
 * 宿主的「无限等待」只是浏览器本地状态, 服务端拿不到点击事件。这里在回环地址
 * 上开一个只接收状态上报的小 HTTP 端点, 客户端点击「无限等待」时上报 callId,
 * 工具侧到期时据此改为继续阻塞等待。
 * 作者: JularDepick
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { SYNC_PATH, SYNC_PORT } from '../constants'

/**
 * 客户端上报的超时草稿条目。
 * 客户端只知道草稿落在第几道题(卡片按顺序展示), 题目 id 由工具侧按自己的提问顺序对应。
 */
export interface DraftAnswer {
  index: number
  selected: string[]
  custom?: string
}

/* 已声明无限等待的调用 */
const infiniteCalls = new Set<string>()

/* 请求体上限: 正常负载只有一个 callId */
const MAX_BODY_LENGTH = 4096

/* callId 形态白名单, 避免任意字符串灌进集合 */
const CALL_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/

/* 集合上限: 超出后丢弃最早登记的一项, 防止被撑爆 */
const MAX_INFINITE_CALLS = 512

/* 已上报的超时草稿(键为 callId), 工具到期时取走 */
const draftReports = new Map<string, DraftAnswer[]>()

/* 等待草稿上报的等待者 */
const draftWaiters = new Map<string, Array<(value: DraftAnswer[] | undefined) => void>>()

/* 草稿条目上限: 单次上报最多保留这么多题 */
const MAX_DRAFT_ANSWERS = 64

/* 收下更晚到达的草稿更新所需的等待时长(毫秒) */
const SETTLE_MS = 600

/* 等待草稿上报时的轮询间隔(毫秒) */
const POLL_INTERVAL_MS = 100

/* 端口被占用时的重试次数与间隔(热更新时旧端点可能还没释放) */
const LISTEN_RETRIES = 5
const LISTEN_RETRY_DELAY = 200

let server: Server | undefined
/* 端口占用重试的定时器句柄, 卸载时必须取消 */
let retryTimer: NodeJS.Timeout | undefined

/* 登记一个无限等待调用 */
function rememberInfiniteCall(callId: string): void {
  if (infiniteCalls.size >= MAX_INFINITE_CALLS) {
    const oldest = infiniteCalls.values().next()
    if (!oldest.done) infiniteCalls.delete(oldest.value)
  }
  infiniteCalls.add(callId)
}

/*
 * 登记客户端上报的超时草稿。
 * 工具到期时会等一小段时间等这份上报, 拿到后随 pending 结果一起交给模型。
 */
export function reportDraft(callId: string, answers: DraftAnswer[]): void {
  if (draftReports.size >= MAX_INFINITE_CALLS && !draftReports.has(callId)) {
    const oldest = draftReports.keys().next()
    if (!oldest.done) draftReports.delete(oldest.value)
  }
  draftReports.set(callId, answers)
  const waiters = draftWaiters.get(callId)
  if (waiters === undefined) return
  draftWaiters.delete(callId)
  for (const waiter of waiters) waiter(answers)
}

/*
 * 等待某次调用的草稿上报。
 * 客户端在用户编辑卡片时就会持续上报草稿快照, 因此到期时通常已经有一份;
 * 这里再给一段宽限时间, 收下更晚到达的那一份, 取最新值交给工具。
 */
export async function awaitDraft(callId: string, timeoutMs: number): Promise<DraftAnswer[] | undefined> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const reported = draftReports.get(callId)
    if (reported !== undefined) {
      /* 已有一份就再等一小段, 收下更晚到达的更新 */
      await sleep(SETTLE_MS)
      const latest = draftReports.get(callId)
      draftReports.delete(callId)
      return latest ?? reported
    }
    await sleep(POLL_INTERVAL_MS)
  }
  draftReports.delete(callId)
  return undefined
}

/* 等待一小段时间 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/* 把客户端上报的草稿整理成可用的条目数组, 脏数据一律丢弃 */
function normalizeAnswers(value: unknown): DraftAnswer[] {
  if (!Array.isArray(value)) return []
  const answers: DraftAnswer[] = []
  for (const entry of value.slice(0, MAX_DRAFT_ANSWERS)) {
    if (typeof entry !== 'object' || entry === null) continue
    const item = entry as { index?: unknown; selected?: unknown; custom?: unknown }
    if (typeof item.index !== 'number' || !Number.isInteger(item.index) || item.index < 0) continue
    const selected = Array.isArray(item.selected)
      ? item.selected.filter((label): label is string => typeof label === 'string')
      : []
    const custom = typeof item.custom === 'string' ? item.custom : undefined
    answers.push({
      index: item.index,
      selected,
      ...(custom === undefined || custom.trim() === '' ? {} : { custom }),
    })
  }
  return answers
}

/* 处理一次上报请求 */
function handleStateRequest(request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse): void {
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Headers', 'content-type')
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  if (request.method === 'OPTIONS') {
    response.writeHead(204)
    response.end()
    return
  }
  /* 只读诊断端点: 回环地址上返回已登记过的调用, 便于排查「无限等待」是否真的送达 */
  if (request.method === 'GET' && request.url === SYNC_PATH + '-state') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ calls: [...infiniteCalls] }))
    return
  }
  if (request.method !== 'POST' || request.url !== SYNC_PATH) {
    response.writeHead(404)
    response.end()
    return
  }
  let body = ''
  let oversized = false
  request.on('data', (chunk: Buffer) => {
    if (oversized) return
    body += chunk.toString('utf8')
    if (body.length > MAX_BODY_LENGTH) {
      oversized = true
      response.writeHead(413)
      response.end()
    }
  })
  request.on('end', () => {
    if (oversized) return
    try {
      const parsed = JSON.parse(body) as { callId?: unknown; infinite?: unknown; answers?: unknown }
      if (typeof parsed.callId !== 'string' || !CALL_ID_PATTERN.test(parsed.callId)) {
        response.writeHead(400)
        response.end()
        return
      }
      if (parsed.infinite === true) {
        rememberInfiniteCall(parsed.callId)
      } else if (Array.isArray(parsed.answers)) {
        reportDraft(parsed.callId, normalizeAnswers(parsed.answers))
      } else {
        response.writeHead(400)
        response.end()
        return
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{"ok":true}')
    } catch {
      response.writeHead(400)
      response.end()
    }
  })
}

/* 尝试监听, 端口被占用时按间隔重试 */
function attemptListen(retry: number): void {
  const instance = createServer(handleStateRequest)
  instance.on('error', (error) => {
    server = undefined
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EADDRINUSE' && retry < LISTEN_RETRIES) {
      /* 重试句柄要留着: 卸载时若不清掉, 端点会在插件停用之后才起来并一直监听 */
      retryTimer = setTimeout(() => {
        retryTimer = undefined
        attemptListen(retry + 1)
      }, LISTEN_RETRY_DELAY)
      return
    }
    /*
     * 端口被占用或监听失败时不能静默: 客户端随后会以为「无限等待」已生效,
     * 到期却按超时提交草稿, 与用户意图相反, 这里至少留一条可追的日志。
     */
    console.warn(
      '[question-timeout-protection] 状态同步端点启动失败, 「无限等待」将不可用:',
      error instanceof Error ? error.message : String(error),
    )
  })
  instance.on('listening', () => {
    server = instance
    const address = instance.address()
    const port = typeof address === 'object' && address !== null ? address.port : SYNC_PORT
    console.info('[question-timeout-protection] 状态同步端点已监听 127.0.0.1:' + String(port))
  })
  instance.listen(SYNC_PORT, '127.0.0.1')
}

/**
 * 把状态端点挂到宿主自带的 HTTP 服务上。
 * 同源注册后不需要 CORS, 也不会与另一个 dsh 实例的固定端口互相抢请求。
 * @param webServer 宿主 WebServer 服务, 提供 register 与 getOrigin
 * @returns 注销函数
 */
export function registerQuestionSyncRoute(webServer: {
  register: (route: { kind: 'exact'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void }) => () => void
}): () => void {
  const off = webServer.register({ kind: 'exact', path: SYNC_PATH, handler: handleStateRequest })
  console.info('[question-timeout-protection] 状态同步路由已挂在宿主 HTTP 服务上: ' + SYNC_PATH)
  return off
}

/** 启动状态同步端点; 重复调用只启动一次 */
export function startQuestionSync(): void {
  if (server !== undefined) return
  attemptListen(0)
}

/** 该调用是否已选择无限等待 */
export function isInfiniteWait(callId: string): boolean {
  return infiniteCalls.has(callId)
}

/** 清理一个调用的状态 */
export function clearInfiniteWait(callId: string): void {
  infiniteCalls.delete(callId)
}

/** 停止状态同步端点 */
export function stopQuestionSync(): void {
  if (retryTimer !== undefined) {
    clearTimeout(retryTimer)
    retryTimer = undefined
  }
  const instance = server
  server = undefined
  infiniteCalls.clear()
  instance?.close()
  draftReports.clear()
  draftWaiters.clear()
}
