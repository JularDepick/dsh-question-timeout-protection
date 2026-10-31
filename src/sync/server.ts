/*
 * 客户端到服务端的状态同步通道
 *
 * 宿主的「无限等待」只是浏览器本地状态, 服务端拿不到点击事件。
 * 这里把一个只接收状态上报的小 HTTP 端点挂在宿主自带的 HTTP 服务上:
 * 客户端点击「无限等待」时上报 callId, 工具侧到期时据此改为继续阻塞等待;
 * 客户端也会在提问进行中上报草稿快照, 工具到期时取走这份快照随 pending 结果交给模型。
 *
 * 端点挂在宿主服务上而不是自开回环端口, 是为了让通道与界面同源:
 * 同源请求不带 Origin, 跨源请求带 Origin 且必须与请求地址同主机同端口,
 * 因此同机其他网页拿不到令牌, 也伪造不了草稿或「无限等待」。
 * 作者: JularDepick
 */

import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { SYNC_PATH } from '../constants'

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

/* 请求体上限: 正常负载只有一个 callId 与少量草稿条目 */
const MAX_BODY_LENGTH = 4096

/* callId 形态白名单, 避免任意字符串灌进集合 */
const CALL_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/

/* 集合上限: 超出后丢弃最早登记的一项, 防止被撑爆 */
const MAX_INFINITE_CALLS = 512

/* 已上报的超时草稿(键为 callId), 工具到期时取走 */
const draftReports = new Map<string, DraftAnswer[]>()

/*
 * 通道令牌: 每次插件加载随机生成, 客户端先取到它再上报。
 * 没有令牌时同机任意网页都能伪造草稿或「无限等待」, 令牌让通道只接受本插件的页面。
 */
const syncToken = randomBytes(24).toString('hex')

/*
 * 权威到期时刻(键为 callId): 工具执行时写入, 服务端据此判断晚到的「无限等待」是否已过期。
 * 客户端自报的截止时刻由卡片倒计时反推, 起点比工具计时晚, 只能当兜底。
 */
const callDeadlines = new Map<string, number>()

/* 草稿条目上限: 单次上报最多保留这么多题 */
const MAX_DRAFT_ANSWERS = 64

/* 调用登记条目上限: 超出后丢弃最早登记的一条, 防止被撑爆 */
const MAX_TRACKED_CALLS = 512

/* 调用登记的存活时长: 超时后仍未结算的登记视为残留, 到期清扫 */
const TRACKED_CALL_TTL_MS = 15 * 60 * 1000

/* 收下更晚到达的草稿更新所需的等待时长(毫秒) */
const SETTLE_MS = 600

/* 等待草稿上报时的轮询间隔(毫秒) */
const POLL_INTERVAL_MS = 100

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

/* 丢弃某次调用残留的草稿快照 */
export function clearDraft(callId: string): void {
  draftReports.delete(callId)
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

/*
 * 清扫残留的调用登记。
 * 工具正常结束会在 finally 里清掉自己的登记, 但异常路径可能来不及,
 * 留下的条目会一直占着内存, 因此登记时顺手清一遍过期条目。
 */
function sweepTrackedCalls(): void {
  const now = Date.now()
  for (const [callId, deadline] of callDeadlines) {
    if (now - deadline > TRACKED_CALL_TTL_MS) callDeadlines.delete(callId)
  }
  for (const callId of callQuestionOrders.keys()) {
    if (!callDeadlines.has(callId)) callQuestionOrders.delete(callId)
  }
  while (callDeadlines.size > MAX_TRACKED_CALLS) {
    const oldest = callDeadlines.keys().next()
    if (oldest.done) break
    callDeadlines.delete(oldest.value)
  }
  while (callQuestionOrders.size > MAX_TRACKED_CALLS) {
    const oldest = callQuestionOrders.keys().next()
    if (oldest.done) break
    callQuestionOrders.delete(oldest.value)
  }
}

/*
 * 来源是否指向宿主页面。
 *
 * 通道挂在宿主自己的 HTTP 服务上, 因此宿主页面发出的请求, Host 头就是它所在地址;
 * 同机其他网页的请求, Host 是它自己的地址, Origin 也指向它自己, 与宿主页面对不上。
 * 浏览器同源请求不带 Origin, 那种请求本来就来自宿主页面自己。
 */
function isHostOrigin(origin: string, host: string | undefined): boolean {
  if (host === undefined || host === '') return false
  const source = parseHostPort(origin)
  if (source === undefined) return false
  const request = parseHostPort('http://' + host)
  if (request === undefined) return false
  return source.host === request.host && source.port === request.port
}

/*
 * 把来源或地址拆成主机与端口。
 * localhost 与 127.0.0.1 指向同一台机器, 视为同一个主机。
 */
function parseHostPort(value: string): { host: string; port: string } | undefined {
  try {
    const parsed = new URL(value)
    if (parsed.hostname === '') return undefined
    const port = parsed.port === '' ? (parsed.protocol === 'https:' ? '443' : '80') : parsed.port
    return { host: normalizeHost(parsed.hostname), port }
  } catch {
    return undefined
  }
}

/* 主机名归一: localhost 与 127.0.0.1 指向同一台机器 */
function normalizeHost(value: string): string {
  return value === 'localhost' ? '127.0.0.1' : value
}

/*
 * 令牌读取端点: 只给宿主页面发令牌。
 *
 * 浏览器同源请求不带 Origin, 跨源请求一定带 Origin:
 * 不带 Origin 的请求来自宿主页面自己, 带 Origin 的必须与请求地址同主机同端口,
 * 否则是同机其他网页, 一律拒绝 —— 它们拿到令牌就能伪造草稿或「无限等待」上报。
 */
function serveToken(request: IncomingMessage, response: ServerResponse): boolean {
  if (request.method !== 'GET' || request.url !== SYNC_PATH + '-token') return false
  const origin = request.headers.origin
  if (typeof origin === 'string') {
    if (!isHostOrigin(origin, request.headers.host)) {
      response.writeHead(403)
      response.end()
      return true
    }
    response.setHeader('Access-Control-Allow-Origin', origin)
    response.setHeader('Vary', 'Origin')
  }
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ token: syncToken }))
  return true
}

/* 处理一次上报请求 */
function handleStateRequest(request: IncomingMessage, response: ServerResponse): void {
  const origin = request.headers.origin
  if (typeof origin === 'string') {
    /* 来源必须与请求地址同主机同端口, 否则是同机其他网页, 一律拒绝 */
    if (!isHostOrigin(origin, request.headers.host)) {
      response.writeHead(403)
      response.end()
      return
    }
    response.setHeader('Access-Control-Allow-Origin', origin)
    response.setHeader('Vary', 'Origin')
  }
  response.setHeader('Access-Control-Allow-Headers', 'content-type, x-qtp-token')
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  if (request.method === 'OPTIONS') {
    /*
     * 预检同样要校验来源: 否则同机任意网页都能通过预检, 只是后续请求会被拦,
     * 但那等于把通道的可用性信息露给了不该知道的人。
     */
    if (typeof origin === 'string' && !isHostOrigin(origin, request.headers.host)) {
      response.writeHead(403)
      response.end()
      return
    }
    response.writeHead(204)
    response.end()
    return
  }
  if (serveToken(request, response)) return
  /* 只读诊断端点: 返回已登记过的调用, 便于排查「无限等待」是否真的送达 */
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
  /* 没有正确令牌的请求一律拒绝, 同机其他网页不得伪造草稿或「无限等待」 */
  const token = request.headers['x-qtp-token']
  if (typeof token !== 'string' || token !== syncToken) {
    response.writeHead(401)
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
      const parsed = JSON.parse(body) as {
        callId?: unknown
        infinite?: unknown
        answers?: unknown
        deadline?: unknown
      }
      if (typeof parsed.callId !== 'string' || !CALL_ID_PATTERN.test(parsed.callId)) {
        response.writeHead(400)
        response.end()
        return
      }
      if (parsed.infinite === true) {
        /*
         * 到期判定以服务端的权威时刻为准: 工具执行时登记的截止时刻。
         * 客户端自报的截止时刻只作兜底 —— 它由卡片倒计时反推, 起点比工具计时晚,
         * 拿它当准会放过已经晚到的「无限等待」, 让界面显示「已暂停」而模型已经超时。
         */
        const authority = callDeadlines.get(parsed.callId)
        const clientDeadline =
          typeof parsed.deadline === 'number' && Number.isFinite(parsed.deadline) ? parsed.deadline : undefined
        const effective = authority ?? clientDeadline
        if (effective !== undefined && Date.now() > effective) {
          response.writeHead(200, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ ok: false, reason: 'expired' }))
          return
        }
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

/**
 * 把状态端点挂到宿主自带的 HTTP 服务上。
 * 同源注册后不需要 CORS, 也不会与另一个 dsh 实例的固定端口互相抢请求。
 * @param webServer 宿主 WebServer 服务, 提供 register 与 getOrigin
 * @returns 注销函数
 */
export function registerQuestionSyncRoute(webServer: {
  register: (route: { kind: 'exact'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void }) => () => void
  getOrigin?: () => string | undefined
}): () => void {
  const off = webServer.register({ kind: 'exact', path: SYNC_PATH, handler: handleStateRequest })
  const offToken = webServer.register({
    kind: 'exact',
    path: SYNC_PATH + '-token',
    handler: handleStateRequest,
  })
  console.info('[question-timeout-protection] 状态同步路由已挂在宿主 HTTP 服务上: ' + SYNC_PATH)
  return () => {
    off()
    offToken()
  }
}

/*
 * 登记一次调用的权威到期时刻(毫秒)。
 * 工具在开始等待时写入, 服务端据此判定晚到的「无限等待」是否已经过期。
 */
export function registerCallDeadline(callId: string, deadline: number): void {
  callDeadlines.set(callId, deadline)
  sweepTrackedCalls()
}

/*
 * 登记一次调用的题目顺序: 客户端只按序号上报草稿, 工具侧再按序号映射回题目 id。
 * 这里留一份权威顺序, 好在两边不一致时能发现, 而不是把草稿挂到错的题目上。
 */
const callQuestionOrders = new Map<string, string[]>()

/* 登记一次调用的题目顺序 */
export function registerCallQuestions(callId: string, ids: readonly string[]): void {
  callQuestionOrders.set(callId, [...ids])
  sweepTrackedCalls()
}

/* 丢弃某次调用残留的题目顺序 */
export function clearCallQuestions(callId: string): void {
  callQuestionOrders.delete(callId)
}

/* 读取一次调用的题目顺序 */
export function callQuestionOrder(callId: string): readonly string[] | undefined {
  return callQuestionOrders.get(callId)
}

/* 丢弃某次调用残留的到期时刻 */
export function clearCallDeadline(callId: string): void {
  callDeadlines.delete(callId)
}

/** 该调用是否已选择无限等待 */
export function isInfiniteWait(callId: string): boolean {
  return infiniteCalls.has(callId)
}

/** 清理一个调用的状态 */
export function clearInfiniteWait(callId: string): void {
  infiniteCalls.delete(callId)
}

/** 清空状态通道里登记的全部状态 */
export function stopQuestionSync(): void {
  infiniteCalls.clear()
  draftReports.clear()
  callDeadlines.clear()
  callQuestionOrders.clear()
}
