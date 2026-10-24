/*
 * 客户端文案
 *
 * 客户端半身的可见文案按浏览器语言选择中英文, 与翻译文件保持同一套措辞。
 * 作者: JularDepick
 */

const ZH = {
  markerInjected: '回答超时·已注入上下文',
  markerUi: '回答超时·草稿已保留',
  markerTimedOut: '回答超时',
  draftPanelTitle: '超时前的草稿',
  close: '关闭',
  noDraft: '没有找到这个提问的草稿',
  settingsSummary: '提问超时保护',
  fallbackSection: '超时兜底',
  fallbackNote: '回答超时后如何处理已经输入的内容',
  injectLabel: '注入到上下文',
  injectDesc: '把草稿作为晚回复送给模型, 由模型自行决定是否重新提问',
  fixedSection: '固定特性',
  fixedNote: '随插件启用状态生效, 不可单独关闭',
  fixedKeepLabel: '界面保留草稿',
  fixedKeepDesc: '收起提问卡片, 草稿留在本机, 可在工具调用行点开查看',
  cardEnhancementsLabel: '卡片增强',
  cardEnhancementsDesc: '倒计时文案, 隐藏收起/展开, 超时后锁定输入',
  infiniteWaitLabel: '无限等待阻塞',
  infiniteWaitDesc: '把「慢慢回答」换成「无限等待」, 点击后不再自动超时',
  draftFallbackLabel: '超时草稿兜底',
  draftFallbackDesc: '超时后按上面的兜底范围处理已输入的内容',
  save: '保存',
  reset: '重置',
  saving: '保存中',
  saved: '已保存',
  rejected: '保存被拒绝, 已重新读取宿主配置',
  loading: '正在读取配置',
  unavailable: '当前部署未暴露该配置',
} as const

const EN: Record<keyof typeof ZH, string> = {
  markerInjected: 'Timed out · injected into context',
  markerUi: 'Timed out · draft kept',
  markerTimedOut: 'Timed out',
  draftPanelTitle: 'Draft at timeout',
  close: 'Close',
  noDraft: 'No draft was found for this question',
  settingsSummary: 'Question timeout protection',
  fallbackSection: 'Timeout fallback',
  fallbackNote: 'What happens to what the user already typed once the wait expires',
  injectLabel: 'Inject into the context',
  injectDesc: 'Send the draft back as a late reply and let the model decide whether to ask again',
  fixedSection: 'Fixed behavior',
  fixedNote: 'Follows the plugin enabled state and cannot be turned off separately',
  fixedKeepLabel: 'Keep the draft in the UI',
  fixedKeepDesc: 'The card collapses, the draft stays on this machine and opens from the tool row',
  cardEnhancementsLabel: 'Card enhancements',
  cardEnhancementsDesc: 'Countdown wording, hidden collapse toggle, locked input after the timeout',
  infiniteWaitLabel: 'Wait-indefinitely blocking',
  infiniteWaitDesc: 'Turns "Take your time" into "Wait indefinitely" so the call no longer times out',
  draftFallbackLabel: 'Draft fallback at timeout',
  draftFallbackDesc: 'Handles what was typed once the wait expires, per the fallback above',
  save: 'Save',
  reset: 'Reset',
  saving: 'Saving',
  saved: 'Saved',
  rejected: 'The host refused the write and its configuration was reloaded',
  loading: 'Reading the configuration',
  unavailable: 'This deployment does not expose the setting',
}

export type ClientTextKey = keyof typeof ZH

/** 按浏览器语言返回文案 */
export function clientText(key: ClientTextKey): string {
  const language = typeof navigator === 'undefined' ? 'zh' : navigator.language
  return language.toLowerCase().startsWith('zh') ? ZH[key] : EN[key]
}

/** 配置页的文案字典(供宿主 locale 注册) */
export const SETTINGS_DICTIONARY = { zh: ZH, en: EN }
