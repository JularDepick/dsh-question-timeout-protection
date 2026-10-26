/*
 * 客户端到服务端的状态同步通道
 *
 * 宿主的「无限等待」只是浏览器本地状态, 服务端拿不到点击事件。这里在回环地址
 * 上开一个只接收状态上报的小 HTTP 端点, 客户端点击「无限等待」时上报 callId,
 * 工具侧到期时据此改为继续阻塞等待。
 * 作者: JularDepick
 */

import { createServer, type Server } from 'node:http'
import { SYNC_PATH, SYNC_PORT } from '../constants'

/* 已声明无限等待的调用 */
const infiniteCalls = new Set<string>()

/* 请求体上限: 正常负载只有一个 callId */
const MAX_BODY_LENGTH = 4096

/* callId 形态白名单, 避免任意字符串灌进集合 */
const CALL_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/

/* 集合上限: 超出后丢弃最早登记的一项, 防止被撑爆 */
const MAX_INFINITE_CALLS = 512

/* 端口被占用时的重试次数与间隔(热更新时旧端点可能还没释放) */
const LISTEN_RETRIES = 5
const LISTEN_RETRY_DELAY = 200

let server: Server | undefined

/* 登记一个无限等待调用 */
function rememberInfiniteCall(callId: string): void {
  if (infiniteCalls.size >= MAX_INFINITE_CALLS) {
    const oldest = infiniteCalls.values().next()
    if (!oldest.done) infiniteCalls.delete(oldest.value)
  }
  infiniteCalls.add(callId)
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
      const parsed = JSON.parse(body) as { callId?: unknown; infinite?: unknown }
      if (typeof parsed.callId !== 'string' || parsed.infinite !== true || !CALL_ID_PATTERN.test(parsed.callId)) {
        response.writeHead(400)
        response.end()
        return
      }
      rememberInfiniteCall(parsed.callId)
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
      setTimeout(() => attemptListen(retry + 1), LISTEN_RETRY_DELAY)
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
  const instance = server
  server = undefined
  infiniteCalls.clear()
  instance?.close()
}
