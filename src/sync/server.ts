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
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8')
    })
    request.on('end', () => {
      try {
        const parsed = JSON.parse(body) as { callId?: unknown; infinite?: unknown }
        if (typeof parsed.callId === 'string' && parsed.infinite === true) infiniteCalls.add(parsed.callId)
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end('{"ok":true}')
      } catch {
        response.writeHead(400)
        response.end()
      }
    })
  })
  instance.on('error', () => {
    server = undefined
  })
  instance.listen(SYNC_PORT, '127.0.0.1')
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
