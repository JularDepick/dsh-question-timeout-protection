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
  startQuestionSync()
  ctx.effect(() => () => {
    service.dispose()
    stopQuestionSync()
  })
}
