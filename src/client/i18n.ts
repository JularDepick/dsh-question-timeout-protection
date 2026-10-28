/*
 * 客户端文案
 *
 * 客户端半身的可见文案按浏览器语言选择中英文, 与翻译文件保持同一套措辞。
 * 作者: JularDepick
 */

const ZH = {
  settingsSummary: '提问超时保护',
  fallbackSection: '超时兜底',
  fallbackNote: '回答超时后如何处理已经输入的内容',
  injectLabel: '注入到上下文',
  injectDesc: '超时前把草稿快照交给服务端, 到期时随工具结果按题带回模型上下文, 由模型自行决定是否重新提问',
  fixedSection: '固定特性',
  fixedNote: '随插件启用状态生效, 不可单独关闭',
  fixedKeepLabel: '界面保留草稿',
  fixedKeepDesc: '超时后把已选选项与已输入内容记入提问气泡, 可在气泡里只读查看',
  cardEnhancementsLabel: '卡片增强',
  cardEnhancementsDesc: '右上角倒计时与警示闪烁, 单选选中底色, 提问标识气泡; 只影响界面装饰',
  infiniteWaitLabel: '无限等待',
  infiniteWaitDesc: '倒计时右侧新增「无限等待」按钮, 点击后本次问答倒计时暂停, 直到用户提交',
  draftFallbackLabel: '超时草稿兜底',
  draftFallbackDesc: '超时后按上面的兜底范围处理已输入的内容',
  rejected: '保存被拒绝, 已重新读取宿主配置',
  loading: '正在读取配置',
  unavailable: '当前部署未暴露该配置',
} as const

const EN: Record<keyof typeof ZH, string> = {
  settingsSummary: 'Question timeout protection',
  fallbackSection: 'Timeout fallback',
  fallbackNote: 'What happens to what the user already typed once the wait expires',
  injectLabel: 'Inject into the context',
  injectDesc: 'The draft snapshot is reported before the timeout and comes back per question through the tool result; the model then decides whether to ask again',
  fixedSection: 'Fixed features',
  fixedNote: 'Follows the plugin enabled state and cannot be turned off separately',
  fixedKeepLabel: 'Keep the draft in the UI',
  fixedKeepDesc: 'Records the selected options and typed text into the question bubble, where it can be read only',
  cardEnhancementsLabel: 'Card enhancements',
  cardEnhancementsDesc: 'Top-right countdown with warning blink, filled radio marker, question bubble; decoration only',
  infiniteWaitLabel: 'Wait indefinitely',
  infiniteWaitDesc: 'Adds a "Wait indefinitely" button next to the countdown that pauses this countdown until the user submits',
  draftFallbackLabel: 'Draft fallback at timeout',
  draftFallbackDesc: 'Handles what was typed once the wait expires, per the fallback above',
  rejected: 'The host refused the write and its configuration was reloaded',
  loading: 'Reading the configuration',
  unavailable: 'This deployment does not expose the setting',
}

import { uiUsesChinese } from './locale'

export type ClientTextKey = keyof typeof ZH

/** 按界面语言返回文案(判定与卡片控件共用) */
export function clientText(key: ClientTextKey): string {
  return uiUsesChinese() ? ZH[key] : EN[key]
}

/** 配置页的文案字典(供宿主 locale 注册) */
export const SETTINGS_DICTIONARY = { zh: ZH, en: EN }
