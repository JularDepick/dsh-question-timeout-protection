/*
 * 客户端入口
 *
 * 客户端半身只做宿主提问卡片之外的一层适配: 倒计时警示样式与超时草稿注入,
 * 提问卡片本身仍由宿主 dsh-client-ui-user-questions 渲染。
 * 作者: JularDepick
 */

import type { Config as ConfigModel } from '../config'
import { DEFAULT_FALLBACK_MODE, DEFAULT_TIMEOUT_SECONDS, DEFAULT_WARNING_SECONDS } from '../constants'
import { installQuestionTimeoutAdapter } from './adapter'
import type { AdapterContext } from './adapter'

export const name = 'dsh-question-timeout-protection/client'

/** 需要的客户端服务: 会话绑定(提问投影)与提问晚回复通道 */
export const inject = ['sessions', 'remote.userQuestions']

/* 客户端上下文除适配器需要的面以外,只要求 effect 生命周期钩子 */
type ClientContext = AdapterContext & {
  effect?: (install: () => () => void) => void
}

/* 未收到配置时的默认值,与插件 Config schema 的默认值保持一致 */
const DEFAULT_CONFIG: ConfigModel = {
  fallback: DEFAULT_FALLBACK_MODE,
  warningSeconds: DEFAULT_WARNING_SECONDS,
  timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
}

export function apply(rawCtx: unknown, config: ConfigModel = DEFAULT_CONFIG): void {
  const ctx = rawCtx as ClientContext
  const dispose = installQuestionTimeoutAdapter(ctx, {
    warningSeconds: config.warningSeconds,
    fallback: config.fallback,
  })
  if (typeof ctx.effect === 'function') ctx.effect(() => dispose)
  else dispose()
}
