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

/* 登记一个无限等待调用 */
function rememberInfiniteCall(callId: string): void {
  if (infiniteCalls.size >= MAX_INFINITE_CALLS) {
    const oldest = infiniteCalls.values().next()
    if (!oldest.done) infiniteCalls.delete(oldest.value)
  }
  infiniteCalls.add(callId)
}
let server: Server | undefined

/** 启动状态同步端点; 重复调用只启动一次 */
export function startQuestionSync(): void {
  if (server !== undefined) return
  const instance = createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*')
    response.setHeader('Access-Control-Allow-Headers', 'content-type')
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    if (request.method === 'OPTIONS') {
      response.writeHead(204)
      response.end()
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
      /* 这个端点只收一个 callId, 超过上限说明不是本插件客户端, 直接拒绝 */
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
  })
  instance.on('error', (error) => {
    server = undefined
    /*
     * 端口被占用或监听失败时不能静默: 客户端随后会以为「无限等待」已生效,
     * 到期却按超时提交草稿, 与用户意图相反, 这里至少留一条可追的日志。
     */
    console.warn(
      '[question-timeout-protection] 状态同步端点启动失败, 「无限等待」将不可用:',
      error instanceof Error ? error.message : String(error),
    )
  })
  instance.listen(SYNC_PORT, '127.0.0.1', () => {
    const address = instance.address()
    const port = typeof address === 'object' && address !== null ? address.port : SYNC_PORT
    console.info('[question-timeout-protection] 状态同步端点已监听 127.0.0.1:' + String(port))
  })
  server = instance
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
  server?.close()
  server = undefined
  infiniteCalls.clear()
}
