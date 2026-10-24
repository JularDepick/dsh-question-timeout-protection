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
  fallbackLabel: '超时兜底范围',
  fallbackUi: '仅界面保留草稿',
  fallbackContext: '注入到上下文',
  fallbackBoth: '界面与上下文都保留',
  warningLabel: '警示秒数(最后多少秒红字闪烁)',
  timeoutLabel: '提问等待时长(秒)',
  cardEnhancementsLabel: '卡片增强(倒计时文案、隐藏收起/展开、超时锁定)',
  infiniteWaitLabel: '无限等待按钮与点击后的阻塞',
  draftFallbackLabel: '超时草稿兜底(保存草稿并按兜底范围处理)',
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
  fallbackLabel: 'Timeout fallback scope',
  fallbackUi: 'Keep the draft in the UI only',
  fallbackContext: 'Inject into the context',
  fallbackBoth: 'Keep in the UI and the context',
  warningLabel: 'Warning seconds (red flash in the last seconds)',
  timeoutLabel: 'Question timeout (seconds)',
  cardEnhancementsLabel: 'Card enhancements (countdown wording, hidden collapse toggle, timeout lock)',
  infiniteWaitLabel: 'Wait-indefinitely control and its blocking behavior',
  draftFallbackLabel: 'Draft fallback at timeout',
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
