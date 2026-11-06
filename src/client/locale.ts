/*
 * 界面语言判定
 *
 * 配置页与卡片控件必须用同一套判定, 否则会出现配置页中文而卡片英文。
 * 优先取文档语言(宿主界面语言), 退回浏览器语言, 默认按中文处理。
 * 归一规则由 src/locale-core.ts 提供, 与服务端翻译加载器共用同一份实现。
 * 作者: JularDepick
 */

import { DEFAULT_LANGUAGE } from '../constants'
import { normalizeLocale } from '../locale-core'

/* 归一规则与服务端翻译加载器共用同一个实现, 见 src/locale-core.ts */
export { normalizeLocale }

/** 当前界面语言代码, 已按 normalizeLocale 归一 */
export function browserLanguage(): string {
  const documentLang = typeof document === 'undefined' ? '' : document.documentElement.lang
  const navigatorLang = typeof navigator === 'undefined' ? '' : navigator.language
  return normalizeLocale(documentLang || navigatorLang || DEFAULT_LANGUAGE)
}

/** 界面语言是否中文: 只按语言段判定, 地区不参与(繁体界面也显示简体文案) */
export function uiUsesChinese(): boolean {
  return browserLanguage().split('-')[0] === 'zh'
}

/** 按界面语言取中英文之一 */
export function pick(zh: string, en: string): string {
  return uiUsesChinese() ? zh : en
}

/*
 * 界面语言是否为中文或英文。
 * 插件只识别这两套宿主文案: 其他语言下读不到宿主的倒计时与等待文案,
 * 依赖它们的增强(自动冻结, 冻结态校验)不可能生效, 因此按语言直接不渲染这些控件,
 * 而不是渲染出来却点不动。
 */
export function isRecognisedLocale(): boolean {
  const language = browserLanguage().split('-')[0]
  return language === 'zh' || language === 'en'
}
