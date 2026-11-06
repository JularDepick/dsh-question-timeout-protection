/*
 * 界面语言判定
 *
 * 配置页与卡片控件必须用同一套判定, 否则会出现配置页中文而卡片英文。
 * 优先取文档语言(宿主界面语言), 退回浏览器语言, 默认按中文处理。
 * 归一规则与 src/translation/index.ts 的 normalizeLocale 保持一致:
 * 客户端产物不能引入服务端的 node 依赖, 所以这里是同一套规则的副本, 两处必须同时改。
 * 作者: JularDepick
 */

import { DEFAULT_LANGUAGE } from '../constants'

/*
 * 语言码归一: 去首尾空白, 转小写, 下划线转连字符。
 * 一切 zh 变体归到 zh-CN, 一切 en 变体归到 en-US, 其余按语言段小写加地区段大写。
 * 只允许字母, 数字与单个连字符: 归一结果会被拼成文件路径, 不合规的输入按默认语言处理。
 */
export function normalizeLocale(locale: string): string {
  const raw = locale.trim().toLowerCase().replace(/_/g, '-')
  if (raw === '') return DEFAULT_LANGUAGE
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw)) return DEFAULT_LANGUAGE
  const [language, ...rest] = raw.split('-')
  const region = rest[0]
  if (region !== undefined && !/^[a-z0-9]+$/.test(region)) return DEFAULT_LANGUAGE
  if (language === 'zh') return 'zh-CN'
  if (language === 'en') return 'en-US'
  return region === undefined ? language : language + '-' + region.toUpperCase()
}

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
