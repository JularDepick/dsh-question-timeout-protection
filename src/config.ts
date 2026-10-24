/*
 * 插件配置
 *
 * 导出同名 Config 类型与 Schemastery schema,默认值写入 schema,
 * 使无效配置在插件加载期响亮失败。字段都声明为 volatile, 以便插件页的
 * 配置表单读写;运行时字段是带 get 的访问器, 读取统一走 configValue。
 * 作者: JularDepick
 */

import Schema from '@deepseek-ai/schemastery'
import type { Volatile } from '@deepseek-ai/cordis'
import {
  DEFAULT_CARD_ENHANCEMENTS,
  DEFAULT_DRAFT_FALLBACK,
  DEFAULT_FALLBACK_MODE,
  DEFAULT_INFINITE_WAIT,
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
  fallback: Volatile<FallbackMode>
  /** 倒计时剩余多少秒时进入红字闪烁警示(默认 5) */
  warningSeconds: Volatile<number>
  /** 提问等待时长(秒),仅在本插件接管提问等待时生效(默认 120) */
  timeoutSeconds: Volatile<number>
  /** 是否启用卡片增强(倒计时文案、隐藏收起/展开、超时锁定等) */
  cardEnhancements: Volatile<boolean>
  /** 是否提供「无限等待」入口与点击后的阻塞行为 */
  infiniteWait: Volatile<boolean>
  /** 是否在超时后保存草稿并按兜底范围处理 */
  draftFallback: Volatile<boolean>
}

export { configValue } from './config-value'

export const Config = Schema.object({
  fallback: Schema.union(['ui', 'context', 'both']).default(DEFAULT_FALLBACK_MODE).volatile(),
  warningSeconds: Schema.number().min(MIN_WARNING_SECONDS).max(MAX_WARNING_SECONDS).default(DEFAULT_WARNING_SECONDS).volatile(),
  timeoutSeconds: Schema.number().min(MIN_TIMEOUT_SECONDS).max(MAX_TIMEOUT_SECONDS).default(DEFAULT_TIMEOUT_SECONDS).volatile(),
  cardEnhancements: Schema.boolean().default(DEFAULT_CARD_ENHANCEMENTS).volatile(),
  infiniteWait: Schema.boolean().default(DEFAULT_INFINITE_WAIT).volatile(),
  draftFallback: Schema.boolean().default(DEFAULT_DRAFT_FALLBACK).volatile(),
})


