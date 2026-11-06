/*
 * 语言码归一
 *
 * 客户端半身与服务端翻译加载器必须用同一套规则: 两边各写一份副本时,
 * 任何一边改动都会让界面语言与加载器判定不一致, 表现为配置页中文而卡片英文。
 * 客户端产物不能引入 node 依赖, 所以规则单独放在这个纯函数模块里, 两边都从这里引用。
 * 作者: JularDepick
 */

import { DEFAULT_LANGUAGE } from './constants'

/*
 * 归一: 去首尾空白, 转小写, 下划线转连字符。
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
