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
import { startQuestionSync, stopQuestionSync } from './sync/server'

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
  /*
   * 状态同步端点只服务网页客户端: 纯命令行或终端界面的 profile 没有客户端模块注册表,
   * 在那里开端口纯属占用, 因此等该服务就绪后再启动, 等不到就不启动。
   */
  let syncStarted = false
  ctx.inject(['clientModules'], () => {
    syncStarted = true
    startQuestionSync()
  })
  /*
   * inject 在依赖缺席时只会让回调永不执行, 本身不留痕迹; 若该服务名与目标构建不符,
   * 「无限等待」会在所有部署里静默失效, 因此这里留一条可追的日志。
   */
  const syncProbe = setTimeout(() => {
    if (syncStarted) return
    console.warn(
      '[question-timeout-protection] 未检测到客户端模块注册表, 状态同步端点未启动, 「无限等待」在本部署不可用',
    )
  }, 5000)
  syncProbe.unref?.()
  ctx.effect(() => () => {
    clearTimeout(syncProbe)
    service.dispose()
    stopQuestionSync()
  })
}
