/*
 * 插件入口
 *
 * 导出 name、inject、apply,装配提问超时保护模块: 在每个 agent 作用域注册
 * 带超时的 ask_user_question,以就近遮蔽宿主的阻塞式提问。
 * 作者: JularDepick
 */

import type { Context } from '@deepseek-ai/cordis'
import { Config } from './config'
import { PLUGIN_NAME } from './constants'
import { QuestionTimeoutService } from './question/service'
import { registerQuestionSyncRoute, stopQuestionSync } from './sync/server'

export const name = PLUGIN_NAME

export const inject = ['tools', 'userQuestions', 'agents']

export { Config }
export { QuestionTimeoutService } from './question/service'
export { TranslationManager, translation } from './translation'
export type { FallbackMode } from './constants'

/** 插件装配入口 */
export function apply(ctx: Context, config: Config): void {
  const service = new QuestionTimeoutService(ctx, config)
  service.start()
  let syncStarted = false
  /*
   * 状态通道挂在宿主自带的 HTTP 服务上: 同源、免 CORS, 也不会与另一个实例抢端口。
   * 只有网页客户端的部署才有这个服务 —— 宿主自己的客户端模块服务也依赖它,
   * 因此拿不到 webServer 就等于没有网页客户端, 通道随即可用。
   */
  ctx.inject(['webServer'], (scoped?: Context) => {
    /* 回调的入参在不同宿主版本里可能为空, 因此以回调上下文优先、外层 ctx 兜底 */
    const holder = (scoped ?? ctx) as unknown as {
      webServer?: Parameters<typeof registerQuestionSyncRoute>[0]
      effect?: (install: () => () => void) => void
    }
    const webServer = holder.webServer
    if (webServer === undefined) return
    syncStarted = true
    const off = registerQuestionSyncRoute(webServer)
    holder.effect?.(() => off)
  })
  /*
   * inject 在依赖缺席时只会让回调永不执行, 本身不留痕迹; 若该服务名与目标构建不符,
   * 「无限等待」会在所有部署里静默失效, 因此这里留一条可追的日志。
   */
  const syncProbe = setTimeout(() => {
    if (syncStarted) return
    console.warn(
      '[question-timeout-protection] 未检测到宿主 HTTP 服务, 状态同步通道未启动, 「无限等待」与草稿上报在本部署不可用',
    )
  }, 5000)
  syncProbe.unref?.()
  ctx.effect(() => () => {
    clearTimeout(syncProbe)
    service.dispose()
    stopQuestionSync()
  })
}
