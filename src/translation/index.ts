/*
 * 翻译加载器
 *
 * 按 locale 加载 src/translation/ 下对应的 xx-YY.ini,
 * 解析 [translation] 节键值,未命中回退默认语言。
 * 键值与加载行为遵循 docs/tech-spec/translation-ini.md。
 * 作者: JularDepick
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_LANGUAGE, FALLBACK_LANGUAGE, TRANSLATION_DIR } from '../constants'

/** 当前文件所在目录(构建产物位于 dist/ 下) */
const MODULE_DIR = dirname(fileURLToPath(import.meta.url))

interface TranslationTable {
  [key: string]: string
}

/** 解析 INI 文本,仅返回 [translation] 节键值 */
function parseTranslationSection(text: string): TranslationTable {
  const table: TranslationTable = {}
  let inSection = false
  for (const line of text.split(/\r?\n/)) {
    const sectionMatch = line.match(/^\[([^\]]+)\]$/)
    if (sectionMatch) {
      inSection = sectionMatch[1] === 'translation'
      continue
    }
    if (!inSection) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim()
    if (key) table[key] = value
  }
  return table
}

/**
 * 定位插件包根目录: 构建产物可能位于 dist/ 或被拆为 dist/ 下的分块,
 * 依次尝试上溯一级与两级,取第一个存在翻译目录的候选。
 */
function resolvePackageRoot(): string {
  const candidates = [join(MODULE_DIR, '..'), join(MODULE_DIR, '..', '..'), join(MODULE_DIR, '..', '..', '..')]
  for (const candidate of candidates) {
    if (existsSync(join(candidate, TRANSLATION_DIR))) return candidate
  }
  return join(MODULE_DIR, '..')
}

/** 插件包根目录 */
const PACKAGE_ROOT = resolvePackageRoot()

/*
 * 语言码归一: zh, zh-cn, zh-hans 归到 zh-CN; zh-tw, zh-hk, zh-mo, zh-hant 归到 zh-TW;
 * en, en-us 归到 en-US; 其余保持原样。
 */
export function normalizeLocale(locale: string): string {
  const raw = locale.trim().toLowerCase().replace(/_/g, '-')
  if (raw === '') return DEFAULT_LANGUAGE
  /*
   * 语言码只允许字母、数字与连字符: 归一后的结果会被直接拼成文件路径,
   * 不做白名单过滤的话, 形如 ../../.. 的输入会越出翻译目录去读别的文件。
   */
  if (!/^[a-z0-9-]+$/.test(raw)) return DEFAULT_LANGUAGE
  const [language, ...rest] = raw.split('-')
  const region = rest[0]
  if (region !== undefined && !/^[a-z0-9]+$/.test(region)) return DEFAULT_LANGUAGE
  if (language === 'zh') {
    if (region === 'tw' || region === 'hk' || region === 'mo' || region === 'hant') return 'zh-TW'
    return 'zh-CN'
  }
  if (language === 'en') return 'en-US'
  return region === undefined ? language : language + '-' + region.toUpperCase()
}

/* 读取失败后的最短重试间隔, 避免热路径每次翻译都做一次失败的读盘 */
const RETRY_INTERVAL_MS = 30000

export class TranslationManager {
  /* 用 Map 存表: 普通对象的原型上带着 constructor 之类的键, 会被当成已加载的翻译 */
  private tables = new Map<string, TranslationTable>()
  private language: string = DEFAULT_LANGUAGE
  private readonly warned = new Set<string>()
  private readonly failedAt = new Map<string, number>()

  /** 清空已加载的翻译表, 供测试或热更新后强制重读 */
  reload(): void {
    this.tables.clear()
    this.failedAt.clear()
    this.warned.clear()
  }

  /** 加载指定语言的翻译表; 读取失败时返回空表但不缓存, 便于修复后自动恢复 */
  load(locale: string): TranslationTable {
    const normalized = normalizeLocale(locale)
    const cached = this.tables.get(normalized)
    if (cached !== undefined) return cached
    const failedAt = this.failedAt.get(normalized)
    if (failedAt !== undefined && Date.now() - failedAt < RETRY_INTERVAL_MS) return {}
    const filePath = join(PACKAGE_ROOT, TRANSLATION_DIR, `${normalized}.ini`)
    try {
      const table = parseTranslationSection(readFileSync(filePath, 'utf-8'))
      this.tables.set(normalized, table)
      this.failedAt.delete(normalized)
      return table
    } catch (error) {
      /* 不缓存失败结果: 打包漏发 ini 或路径变化修好后下一次调用即可恢复 */
      this.failedAt.set(normalized, Date.now())
      if (!this.warned.has(normalized)) {
        this.warned.add(normalized)
        console.warn(
          '[question-timeout-protection] 翻译文件读取失败, 未命中时回退到兜底语言 ' + FALLBACK_LANGUAGE + ':',
          error instanceof Error ? error.message : String(error),
        )
      }
      return {}
    }
  }

  /** 切换当前语言 */
  setLanguage(locale: string): void {
    this.language = normalizeLocale(locale)
    this.load(this.language)
  }

  /** 取翻译文本,未命中回退默认语言,仍未命中返回键名 */
  translate(key: string): string {
    const current = this.load(this.language)
    const fallback = this.load(FALLBACK_LANGUAGE)
    return current[key] ?? fallback[key] ?? key
  }
}

/** 翻译文本快捷方法(使用默认实例) */
export const translation = new TranslationManager()