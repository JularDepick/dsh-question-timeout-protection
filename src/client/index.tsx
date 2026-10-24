/*
 * 客户端入口
 *
 * 客户端半身只做宿主提问卡片之外的一层适配: 倒计时警示样式与超时草稿注入,
 * 提问卡片本身仍由宿主 dsh-client-ui-user-questions 渲染。
 * 作者: JularDepick
 */

import type { Config as ConfigModel } from '../config'
import { configValue } from '../config-value'
import {
  DEFAULT_CARD_ENHANCEMENTS,
  DEFAULT_DRAFT_FALLBACK,
  DEFAULT_FALLBACK_MODE,
  DEFAULT_INFINITE_WAIT,
  DEFAULT_WARNING_SECONDS,
} from '../constants'
import { installQuestionTimeoutAdapter } from './adapter'
import type { AdapterContext, AdapterOptions } from './adapter'
import { registerSettingsPage } from './settings'
import type { SettingsContext } from './settings'

export const name = 'dsh-question-timeout-protection/client'

/** 需要的客户端服务: 会话绑定、提问晚回复通道、插槽、配置表单与文案 */
export const inject = ['sessions', 'remote.userQuestions', 'slots', 'configForms', 'locale']

/* 客户端上下文除适配器需要的面以外,只要求 effect 生命周期钩子与配置页服务 */
type ClientContext = AdapterContext & SettingsContext & {
  effect?: (install: () => () => void) => void
}

/* 把配置归一成适配器选项, 缺失时使用 schema 默认值 */
function resolveOptions(config: Partial<ConfigModel> | undefined): AdapterOptions {
  return {
    fallback: configValue(config?.fallback) ?? DEFAULT_FALLBACK_MODE,
    warningSeconds: configValue(config?.warningSeconds) ?? DEFAULT_WARNING_SECONDS,
    cardEnhancements: configValue(config?.cardEnhancements) ?? DEFAULT_CARD_ENHANCEMENTS,
    infiniteWait: configValue(config?.infiniteWait) ?? DEFAULT_INFINITE_WAIT,
    draftFallback: configValue(config?.draftFallback) ?? DEFAULT_DRAFT_FALLBACK,
  }
}

export function apply(rawCtx: unknown, config?: Partial<ConfigModel>): void {
  const ctx = rawCtx as ClientContext
  let disposeAdapter: () => void = () => {}
  let disposeSettings: () => void = () => {}
  try {
    disposeAdapter = installQuestionTimeoutAdapter(ctx, resolveOptions(config))
  } catch (error) {
    console.error('[question-timeout-protection] 卡片适配器安装失败', error)
  }
  try {
    disposeSettings = registerSettingsPage(ctx)
  } catch (error) {
    console.error('[question-timeout-protection] 配置页注册失败', error)
  }
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => disposeAdapter)
    ctx.effect(() => disposeSettings)
  } else {
    disposeAdapter()
    disposeSettings()
  }
}
