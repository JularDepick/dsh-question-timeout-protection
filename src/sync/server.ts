/*
 * 客户端到服务端的状态同步通道
 *
 * 宿主的「无限等待」只是浏览器本地状态, 服务端拿不到点击事件。
 * 这里把一个只接收状态上报的小 HTTP 端点挂在宿主自带的 HTTP 服务上:
 * 客户端点击「无限等待」时上报 callId, 工具侧到期时据此改为继续阻塞等待;
 * 客户端也会在提问进行中上报草稿快照, 工具到期时取走这份快照随 pending 结果交给模型。
 *
 * 端点挂在宿主服务上而不是自开回环端口, 是为了让通道与界面同源:
 * 同源请求不带 Origin, 跨源请求的 Origin 必须与请求的 Host 自洽;
 * 另外请求 Host 的主机名必须落在回环白名单里, 否则 DNS rebinding 下攻击者域名解析到回环后,
 * Origin 与 Host 会一起变成攻击者域名, 自洽检查形同虚设。
 * 两道检查合起来, 同机其他网页拿不到令牌, 也伪造不了草稿或「无限等待」。
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
/* 草稿条目被截断时只告警一次, 每秒上报不该刷屏 */
let truncationWarned = false

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
 * 已经有一份快照时只再等 SETTLE_MS 就返回, 因此这条路径上留给用户补交的窗口是 SETTLE_MS,
 * 而不是调用方传入的整个宽限期。
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
  /* 空闲期没有新的限时提问时也要回收残留, 不能只靠登记新调用时清扫 */
  sweepTrackedCalls()
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
  /*
   * 超出上限的条目会被静默丢弃, 那样模型拿到的草稿看起来像是用户只答了前若干题。
   * 这里留一条告警说明被截断, 每种情况只告警一次, 避免每秒上报时刷屏。
   */
  if (value.length > MAX_DRAFT_ANSWERS && !truncationWarned) {
    truncationWarned = true
    console.warn(
      '[question-timeout-protection] 单次上报的草稿条目数为 ' +
        String(value.length) +
        ', 超过上限 ' +
        String(MAX_DRAFT_ANSWERS) +
        ', 超出的部分已丢弃',
    )
  }
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
 * 带 Origin 时, 来源是否与请求的 Host 自洽。
 *
 * 通道挂在宿主自己的 HTTP 服务上, 因此宿主页面发出的请求, Host 头就是它所在地址;
 * 同机其他网页的请求, Host 是它自己的地址, Origin 也指向它自己, 与宿主页面对不上。
 * 但自洽比对只能证明 Origin 与 Host 是同一个值: DNS rebinding 下这两个值都由攻击者给出,
 * 因此端点都在它之前先过 Host 的回环白名单, 不带 Origin 的请求也要过那道白名单。
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
 * 回环主机名白名单: 宿主页面从本机回环地址打开这个通道。
 * 白名单由代码给定, 不取请求方提供的字段, DNS rebinding 改不动它;
 * localhost 与 127.0.0.1 都收下, [::1] 是 IPv6 回环在 Host 头里的写法。
 */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

/*
 * 请求的 Host 是否指向本机回环。
 *
 * 这道检查对不带 Origin 的同源请求同样生效: DNS rebinding 下攻击者域名解析到回环后,
 * 它自己发出的同源请求不带 Origin, 带 Origin 的也能让 Origin 与 Host 同时写成攻击者域名,
 * 只靠 isHostOrigin 的自洽比对挡不住, 因此两个端点都在原有检查之前先过这道白名单。
 * 大小写差异由 URL 解析归一, 带 userinfo 或路径的畸形 Host 一律拒绝。
 */
function isLoopbackHost(host: string | undefined): boolean {
  if (host === undefined || host === '') return false
  try {
    const parsed = new URL('http://' + host)
    if (parsed.username !== '' || parsed.password !== '') return false
    if (parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '') return false
    return LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())
  } catch {
    return false
  }
}

/*
 * 令牌读取端点: 只给宿主页面发令牌。
 *
 * 浏览器同源请求不带 Origin, 跨源请求一定带 Origin:
 * 不带 Origin 的请求同样要先过请求 Host 的回环白名单, 带 Origin 的还要与 Host 同主机同端口,
 * 否则是同机其他网页或 DNS rebinding, 一律拒绝 —— 它们拿到令牌就能伪造草稿或「无限等待」上报。
 */
function serveToken(request: IncomingMessage, response: ServerResponse): boolean {
  if (request.method !== 'GET' || request.url !== SYNC_PATH + '-token') return false
  /* 先挡 DNS rebinding: 攻击者域名解析到回环后, 它给出的 Host 不是回环字面量 */
  if (!isLoopbackHost(request.headers.host)) {
    response.writeHead(403)
    response.end()
    return true
  }
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
  /*
   * 令牌随插件加载重新生成, 一旦被浏览器或中间代理按启发式缓存,
   * 客户端在 401 之后重取仍会拿到旧值, 两个端点会继续拒绝它, 整条通道被判成不可用。
   */
  response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  response.end(JSON.stringify({ token: syncToken }))
  return true
}

/* 处理一次上报请求 */
function handleStateRequest(request: IncomingMessage, response: ServerResponse): void {
  /* 先挡 DNS rebinding: 无 Origin 的同源请求也要过这道回环白名单 */
  if (!isLoopbackHost(request.headers.host)) {
    response.writeHead(403)
    response.end()
    return
  }
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
      /*
       * 客户端还在继续发就已经超限, 这里主动断开连接停止接收:
       * 只回响应不终止流的话, 剩余字节会被一直读进内存直到上传结束。
       */
      /*
       * 不能在这里销毁请求: 销毁会连带拆掉底层连接, 413 响应来不及刷出,
       * 客户端只看到连接被重置, 于是"草稿过长"被当成通道故障并计入连续失败。
       * 剩余字节由上面的 oversized 分支直接丢弃, 内存不会继续增长。
       */
      chunks.length = 0
    }
  })
  /*
   * 客户端中途断开时 IncomingMessage 会发 error 或 aborted, 不接住会变成未捕获异常。
   * 此时响应已不可写, 只留诊断日志, 不再尝试 end。
   */
  request.on('error', (error: unknown) => {
    /* 超限后的断开是服务端自己发起的, 再报「客户端中断」会把事实说反 */
    if (oversized) return
    console.warn('[question-timeout-protection] 状态上报请求体读取失败, 本次上报已丢弃', String(error))
  })
  request.on('aborted', () => {
    if (oversized) return
    console.warn('[question-timeout-protection] 状态上报请求被客户端中断, 本次上报已丢弃')
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
      if (parsed.infinite === false) {
        /*
         * 客户端放弃冻结(宿主暂停控件缺失或通道回执异常)时撤销登记。
         * 留着这条登记会让工具到期后继续阻塞, 而界面已经把这一轮交还宿主,
         * 模型与界面的结论就对不上了。
         */
        clearInfiniteWait(parsed.callId)
      } else if (parsed.infinite === true) {
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
   *
   * 宿主的两条热替换路径与这里的两处假设并不互斥:
   * 配置变更只重新执行 apply, 模块实例与通道令牌沿用, 引用计数既保证路由不重复注册,
   * 也保证先离开的旧实例不会把新实例还在用的路由撤掉;
   * 插件包热替换由 @deepseek-ai/dsh-hmr 先卸载旧插件(注册随之清理)再重新加载代码,
   * 新模块实例从空的模块状态开始, 令牌一并重新生成, 此时路由已释放, 注册不会撞车。
   * 只有「新实例先于旧实例安装」这一顺序会撞上车, 那时注册抛错,
   * 由插件入口记一条告警并把整条通道降级为不可用。
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
