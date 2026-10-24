/*
 * 插件配置
 *
 * 导出同名 Config 类型与 Schemastery schema,默认值写入 schema,
 * 使无效配置在插件加载期响亮失败。
 * 作者: JularDepick
 */

import Schema from '@deepseek-ai/schemastery'
import {
  DEFAULT_FALLBACK_MODE,
  DEFAULT_TIMEOUT_SECONDS,
  DEFAULT_WARNING_SECONDS,
  MAX_TIMEOUT_SECONDS,
  MAX_WARNING_SECONDS,
  MIN_TIMEOUT_SECONDS,
  MIN_WARNING_SECONDS,
} from './constants'
import type { FallbackMode } from './constants'

export interface Config {
  /** 提问超时后的兜底范围: 仅界面、仅上下文或两者 */
  fallback: FallbackMode
  /** 倒计时剩余多少秒时进入红字闪烁警示(默认 5) */
  warningSeconds: number
  /** 提问等待时长(秒),仅在本插件接管提问等待时生效(默认 120) */
  timeoutSeconds: number
}

export const Config: Schema<Config> = Schema.object({
  fallback: Schema.union(['ui', 'context', 'both']).default(DEFAULT_FALLBACK_MODE),
  warningSeconds: Schema.number().min(MIN_WARNING_SECONDS).max(MAX_WARNING_SECONDS).default(DEFAULT_WARNING_SECONDS),
  timeoutSeconds: Schema.number().min(MIN_TIMEOUT_SECONDS).max(MAX_TIMEOUT_SECONDS).default(DEFAULT_TIMEOUT_SECONDS),
})
