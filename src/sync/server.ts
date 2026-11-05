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

/*
 * 已声明无限等待的调用, 值是登记时刻。
 * 带上时间戳才能做过期清扫: 只有数量上限时, 旧条目会一直占着内存直到被新的挤掉。
 */
const infiniteCalls = new Map<string, number>()

/*
 * 请求体上限: 负载是一个 callId 与少量草稿条目, 但草稿里的补充内容是自由文本,
 * 中文按 3 字节/字计算。64 KiB 只够约两万字, 粘贴长文就会被拒收并连带判成通道不可用,
 * 因此放宽到 256 KiB(约八万字), 同时保留上限防止被无限灌入。
 */
const MAX_BODY_LENGTH = 256 * 1024

/*
 * callId 形态白名单: 只挡空白与控制字符, 不假定具体字符集。
 * 宿主 callId 由模型提供方生成且不做校验, 收紧到某个字符集会整体拒绝合法 callId,
 * 表现是这一轮的每次上报都被回 400, 通道等于不可用。
 */
const CALL_ID_PATTERN = /^[^\u0000-\u0020\u007f]{1,200}$/

/* 集合上限: 超出后丢弃最早登记的一项, 防止被撑爆 */
const MAX_INFINITE_CALLS = 512

/* 已上报的超时草稿(键为 callId), 工具到期时取走 */
const draftReports = new Map<string, DraftAnswer[]>()

/* 草稿上报时间: 客户端在调用结算后仍可能继续上报, 没有时间戳就会一直留在内存里 */
const draftReportedAt = new Map<string, number>()

/* 草稿上报的存活时长: 超过这个时间还没被取走就按残留清掉 */
const DRAFT_REPORT_TTL_MS = 5 * 60 * 1000

/* 已结算的调用: 结算之后到达的「无限等待」一律按过期处理, 不能反过来改变结算结果 */
const settledCalls = new Map<string, number>()

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

/* 草稿快照容量: 与「无限等待」的容量分开, 两件事的压力来源不同 */
const MAX_DRAFT_SNAPSHOTS = 256

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
  if (infiniteCalls.size >= MAX_INFINITE_CALLS && !infiniteCalls.has(callId)) {
    const oldest = infiniteCalls.keys().next()
    if (!oldest.done) infiniteCalls.delete(oldest.value)
  }
  infiniteCalls.set(callId, Date.now())
}

/*
 * 登记客户端上报的超时草稿。
 * 工具到期时会等一小段时间等这份上报, 拿到后随 pending 结果一起交给模型。
 */
export function reportDraft(callId: string, answers: DraftAnswer[]): boolean {
  /*
   * 只收「限时提问」的草稿: 阻塞提问(timeout=-1)不登记权威到期时刻,
   * 它永远不会按超时结算, 收下的快照没有取用者, 只会在内存里躺到过期。
   */
  if (!callDeadlines.has(callId)) return false
  if (draftReports.size >= MAX_DRAFT_SNAPSHOTS && !draftReports.has(callId)) {
    const oldest = draftReports.keys().next()
    if (!oldest.done) {
      draftReports.delete(oldest.value)
      draftReportedAt.delete(oldest.value)
    }
  }
  draftReports.set(callId, answers)
  draftReportedAt.set(callId, Date.now())
  return true
}

/*
 * 等待某次调用的草稿上报。
 * 客户端在用户编辑卡片时就会持续上报草稿快照, 因此到期时通常已经有一份;
 * 这里再给一段宽限时间, 收下更晚到达的那一份, 取最新值交给工具。
 *
 * 宽限期内若登记了「无限等待」, 立即结束等待并返回 undefined:
 * 用户是在到期瞬间点的, 这一轮提问还想继续等, 工具据此回到等待里而不是按超时结算。
 */
export async function awaitDraft(callId: string, timeoutMs: number): Promise<DraftAnswer[] | undefined> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (infiniteCalls.has(callId)) {
      /* 用户刚点了「无限等待」: 这一轮不该按超时结算, 草稿留到之后再取 */
      return undefined
    }
    const reported = draftReports.get(callId)
    if (reported !== undefined) {
      /* 已有一份就再等一小段, 收下更晚到达的更新 */
      await sleep(SETTLE_MS)
      if (infiniteCalls.has(callId)) return undefined
      const latest = draftReports.get(callId)
      draftReports.delete(callId)
      draftReportedAt.delete(callId)
      return latest ?? reported
    }
    await sleep(POLL_INTERVAL_MS)
  }
  draftReports.delete(callId)
  draftReportedAt.delete(callId)
  return undefined
}

/* 丢弃某次调用残留的草稿快照 */
export function clearDraft(callId: string): void {
  draftReports.delete(callId)
  draftReportedAt.delete(callId)
}

/*
 * 登记调用已结算。
 * 结算之后才到达的「无限等待」不能反过来改变结算结果,
 * 而结算时清掉权威到期时刻后, 晚到的上报会退回客户端自报的时刻并被当成有效,
 * 因此这里留一条有存活期的结算标记。
 */
export function markCallSettled(callId: string): void {
  settledCalls.set(callId, Date.now())
  while (settledCalls.size > MAX_TRACKED_CALLS) {
    const oldest = settledCalls.keys().next()
    if (oldest.done) break
    settledCalls.delete(oldest.value)
  }
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
  for (const [callId, settledAt] of settledCalls) {
    if (now - settledAt > TRACKED_CALL_TTL_MS) settledCalls.delete(callId)
  }
  /* 客户端在调用结算后可能还在上报, 没有时间戳这里会一直攒着 */
  for (const [callId, reportedAt] of draftReportedAt) {
    if (now - reportedAt <= DRAFT_REPORT_TTL_MS) continue
    draftReportedAt.delete(callId)
    draftReports.delete(callId)
  }
  for (const callId of callQuestionOrders.keys()) {
    if (!callDeadlines.has(callId)) callQuestionOrders.delete(callId)
  }
  /* 「无限等待」的登记也要过期: 没有清扫时旧条目只能等被新条目挤掉 */
  for (const [callId, registeredAt] of infiniteCalls) {
    if (now - registeredAt > TRACKED_CALL_TTL_MS) infiniteCalls.delete(callId)
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
  /*
   * 请求侧只知道 Host 头(不带协议), 因此端口按来源自身的协议补默认值:
   * 反代或 https 部署下来源是 https://host, 默认端口是 443,
   * 一律按 http 的 80 补会与来源对不上, 整条通道被 403。
   */
  const request = parseHostPort(source.protocol + '//' + host)
  if (request === undefined) return false
  return source.host === request.host && source.port === request.port
}

/*
 * 把来源或地址拆成主机与端口。
 * localhost 与 127.0.0.1 指向同一台机器, 视为同一个主机。
 */
function parseHostPort(value: string): { host: string; port: string; protocol: string } | undefined {
  try {
    const parsed = new URL(value)
    if (parsed.hostname === '') return undefined
    const port = parsed.port === '' ? (parsed.protocol === 'https:' ? '443' : '80') : parsed.port
    return { host: normalizeHost(parsed.hostname), port, protocol: parsed.protocol }
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
  /*
   * 除令牌端点外一律校验令牌, 诊断端点也不例外:
   * 它虽然只读, 但会把已登记的调用标识暴露给同机任意进程, 与通道其余部分的口径保持一致。
   */
  const token = request.headers['x-qtp-token']
  if (typeof token !== 'string' || token !== syncToken) {
    response.writeHead(401)
    response.end()
    return
  }
  /* 只读诊断端点: 返回已登记过的调用, 便于排查「无限等待」是否真的送达 */
  if (request.method === 'GET' && request.url === SYNC_PATH + '-state') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ calls: [...infiniteCalls.keys()] }))
    return
  }
  if (request.method !== 'POST' || request.url !== SYNC_PATH) {
    response.writeHead(404)
    response.end()
    return
  }
  /*
   * 请求体按字节累积, 收完再统一解码。
   * 逐块 toString('utf8') 会把落在两个 TCP 块之间的多字节字符解成乱码,
   * 而草稿的补充内容正是自由文本, 一旦命中就是静默的文本损坏。
   */
  const chunks: Buffer[] = []
  let received = 0
  let oversized = false
  request.on('data', (chunk: Buffer) => {
    if (oversized) return
    chunks.push(chunk)
    received += chunk.length
    if (received > MAX_BODY_LENGTH) {
      oversized = true
      /* 客户端据此显示「草稿过长」而不是把它算成通道故障 */
      response.writeHead(413, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ ok: false, reason: 'too-large' }))
    }
  })
  request.on('end', () => {
    if (oversized) return
    const body = Buffer.concat(chunks).toString('utf8')
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
        if (settledCalls.has(parsed.callId)) {
          /* 这一轮提问已经结算并交给模型, 再登记「无限等待」只会让界面与模型状态对不上 */
          response.writeHead(200, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ ok: false, reason: 'expired' }))
          return
        }
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
        /*
         * 没有登记的调用(已结算的历史卡片, 阻塞提问)收下也没有取用者,
         * 这里明说丢弃, 客户端才不会以为草稿已经送达。
         */
        if (!reportDraft(parsed.callId, normalizeAnswers(parsed.answers))) {
          response.writeHead(200, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ ok: true, ignored: true }))
          return
        }
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
  /*
   * 热更新可能先装载新实例再释放旧实例, 而宿主对重复的 (kind, path) 直接抛错。
   * 路由因此按引用计数只注册一次: 后来的实例复用已有路由, 最后一个使用者离开时才注销。
   */
  if (detachRoutes === undefined) {
    const offs: Array<() => void> = []
    try {
      offs.push(webServer.register({ kind: 'exact', path: SYNC_PATH, handler: handleStateRequest }))
      offs.push(webServer.register({ kind: 'exact', path: SYNC_PATH + '-token', handler: handleStateRequest }))
      /* 只读诊断端点也要单独登记: 宿主按精确路径路由, 不登记就取不到 */
      offs.push(webServer.register({ kind: 'exact', path: SYNC_PATH + '-state', handler: handleStateRequest }))
    } catch (error) {
      /* 三条路由要么全挂上要么全撤掉, 不能留下半套路由让客户端上报到一半 */
      for (const off of offs.reverse()) {
        try {
          off()
        } catch {
          /* 回滚失败不应覆盖原始注册错误 */
        }
      }
      throw error
    }
    detachRoutes = () => {
      for (const off of offs.reverse()) {
        try {
          off()
        } catch {
          /* 宿主可能已随实例一起销毁, 注销失败不再抛出 */
        }
      }
    }
    syncChannelReady = true
    console.info('[question-timeout-protection] 状态同步路由已挂在宿主 HTTP 服务上: ' + SYNC_PATH)
  }
  channelUsers += 1
  let released = false
  return () => {
    if (released) return
    released = true
    channelUsers = Math.max(0, channelUsers - 1)
    if (channelUsers > 0) return
    detachRoutes?.()
    detachRoutes = undefined
    /* 路由已全部撤销: 把登记表一起清空, 避免旧调用的状态留到 TTL 过期 */
    clearSyncState()
  }
}

/* 清空通道登记的全部状态(只在没有使用者时调用) */
function clearSyncState(): void {
  syncChannelReady = false
  infiniteCalls.clear()
  draftReports.clear()
  draftReportedAt.clear()
  callDeadlines.clear()
  callQuestionOrders.clear()
  settledCalls.clear()
}

/* 状态通道是否已经挂在宿主 HTTP 服务上, 供工具判断要不要等客户端上报 */
let syncChannelReady = false

/* 通道路由的引用计数与注销函数: 新旧实例并存时共享同一套路由 */
let channelUsers = 0
let detachRoutes: (() => void) | undefined

/* 是否有可用的状态通道 */
export function hasSyncChannel(): boolean {
  return syncChannelReady
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
  /*
   * 旧实例卸载时若还有新实例在用同一套路由, 清空共享登记会把新实例刚登记的调用一起抹掉,
   * 无限等待与草稿注入随即静默失效; 只有最后一个使用者离开时才清空。
   */
  if (channelUsers > 0) return
  clearSyncState()
}
