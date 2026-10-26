/*
 * 界面语言判定
 *
 * 配置页与卡片控件必须用同一套判定, 否则会出现配置页中文而卡片英文。
 * 优先取文档语言(宿主界面语言), 退回浏览器语言, 默认按中文处理。
 * 作者: JularDepick
 */

/** 当前界面语言代码, 已转小写 */
export function browserLanguage(): string {
  const documentLang = typeof document === 'undefined' ? '' : document.documentElement.lang
  const navigatorLang = typeof navigator === 'undefined' ? '' : navigator.language
  return (documentLang || navigatorLang || 'zh').toLowerCase()
}

/** 界面语言是否中文 */
export function uiUsesChinese(): boolean {
  return browserLanguage().startsWith('zh')
}

/** 按界面语言取中英文之一 */
export function pick(zh: string, en: string): string {
  return uiUsesChinese() ? zh : en
}
