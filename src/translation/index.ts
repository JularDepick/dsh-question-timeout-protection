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

export class TranslationManager {
  private tables: Record<string, TranslationTable> = {}
  private language: string = DEFAULT_LANGUAGE
  private readonly warned = new Set<string>()

  /** 加载指定语言的翻译表; 读取失败时返回空表但不缓存, 便于修复后自动恢复 */
  load(locale: string): TranslationTable {
    const cached = this.tables[locale]
    if (cached) return cached
    const filePath = join(PACKAGE_ROOT, TRANSLATION_DIR, `${locale}.ini`)
    try {
      const table = parseTranslationSection(readFileSync(filePath, 'utf-8'))
      this.tables[locale] = table
      return table
    } catch (error) {
      /* 不缓存失败结果: 打包漏发 ini 或路径变化修好后下一次调用即可恢复 */
      if (!this.warned.has(locale)) {
        this.warned.add(locale)
        console.warn(
          '[question-timeout-protection] 翻译文件读取失败, 将回退到默认语言:',
          error instanceof Error ? error.message : String(error),
        )
      }
      return {}
    }
  }

  /** 切换当前语言 */
  setLanguage(locale: string): void {
    this.language = locale
    this.load(locale)
  }

  /** 取翻译文本,未命中回退默认语言,仍未命中返回键名 */
  translate(key: string): string {
    const current = this.tables[this.language] ?? this.load(this.language)
    const fallback = this.tables[FALLBACK_LANGUAGE] ?? this.load(FALLBACK_LANGUAGE)
    return current[key] ?? fallback[key] ?? key
  }
}

/** 翻译文本快捷方法(使用默认实例) */
export const translation = new TranslationManager()
