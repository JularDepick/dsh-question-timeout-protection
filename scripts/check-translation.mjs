#!/usr/bin/env node
/*
 * 翻译文件一致性检查
 *
 * 以中文版为基准做四件事:
 * 1. 三份 ini 的键集, 重复键, 空值, 占位符是否一致;
 * 2. 配置页字典的键与 ini 的 settings.* 是否一一对应;
 * 3. 界面常量里的中英文案是否都有对应 ini 键且取值一致;
 * 4. [meta] 的版本号与语言标识是否与包清单和文件名相符.
 * 任何不一致都以非零退出。
 * 作者: JularDepick
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BASELINE = 'src/translation/zh-CN.ini'
const FILES = ['src/translation/zh-CN.ini', 'src/translation/en-US.ini', 'src/translation/.example_zh-CN.ini']

/* 解析 [translation] 节: 同时记录重复键与空值 */
function parseIni(text) {
  const entries = new Map()
  const duplicates = []
  const empties = []
  let section = ''
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '') continue
    const header = line.match(/^\[([^\]]+)\]$/)
    if (header) {
      section = header[1]
      continue
    }
    if (line.startsWith(';') || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim()
    const full = section === 'translation' ? key : section + '.' + key
    if (section === 'translation') {
      if (entries.has(key)) duplicates.push(key)
      if (value === '') empties.push(key)
    }
    entries.set(full, value)
  }
  return { entries, duplicates, empties }
}

/* 取出占位符名称集合 */
function placeholders(value) {
  return [...value.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]).sort()
}

/*
 * 从源码里抽文案常量。
 * 标量常量按 NAME_ZH / NAME_EN 成对抽取, 写法可以是单行也可以跨行;
 * 数组常量按 NAME = ['中文', '英文'] 抽取。
 */
function literalPairs() {
  const source = readFileSync(join(ROOT, 'src/constants.ts'), 'utf8')
  const pairs = []
  for (const match of source.matchAll(/export const ([A-Za-z0-9_]+)_ZH\s*=\s*'((?:[^'\\]|\\.)*)'/g)) {
    const name = match[1]
    const zh = match[2]
    const enMatch = source.match(
      new RegExp('export const ' + name + "_EN\\s*=\\s*'((?:[^'\\\\]|\\\\.)*)'"),
    )
    if (enMatch) pairs.push({ name, zh, en: enMatch[1] })
  }
  return pairs
}

/* 抽取数组型文案常量, 只取形如 [中文, 英文] 的两元素数组 */
function arrayLiterals() {
  const source = readFileSync(join(ROOT, 'src/constants.ts'), 'utf8')
  const out = []
  for (const match of source.matchAll(
    /export const ([A-Za-z0-9_]+)\s*:\s*readonly string\[\]\s*=\s*\[\s*'((?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'\s*\]/g,
  )) {
    out.push({ name: match[1], zh: match[2], en: match[3] })
  }
  return out
}

const problems = []
const baseline = parseIni(readFileSync(join(ROOT, BASELINE), 'utf8'))
const baseKeys = new Set([...baseline.entries.keys()].filter((key) => !key.startsWith('meta.')))

for (const file of FILES) {
  const parsed = parseIni(readFileSync(join(ROOT, file), 'utf8'))
  for (const key of parsed.duplicates) problems.push(file + ' 存在重复键 ' + key)
  for (const key of parsed.empties) problems.push(file + ' 存在空值 ' + key)
  for (const key of baseKeys) if (!parsed.entries.has(key)) problems.push(file + ' 缺少键 ' + key)
  for (const key of parsed.entries.keys()) {
    if (key.startsWith('meta.')) continue
    if (!baseKeys.has(key)) problems.push(file + ' 多出键 ' + key)
  }
}

/* 取值与占位符: 中文版与模板必须逐字相同, 其余语言占位符必须一致 */
const template = parseIni(readFileSync(join(ROOT, 'src/translation/.example_zh-CN.ini'), 'utf8'))
for (const key of baseKeys) {
  if (template.entries.get(key) !== baseline.entries.get(key)) problems.push('基准模板与中文版取值不一致: ' + key)
}
for (const file of FILES) {
  const parsed = parseIni(readFileSync(join(ROOT, file), 'utf8'))
  for (const key of baseKeys) {
    const value = parsed.entries.get(key)
    if (value === undefined) continue
    const expected = placeholders(baseline.entries.get(key) ?? '')
    const actual = placeholders(value)
    if (expected.join(',') !== actual.join(',')) problems.push(file + ' 的 ' + key + ' 占位符不一致')
  }
}

/* 配置页字典 <-> ini 的 settings.* */
const i18nSource = readFileSync(join(ROOT, 'src/client/i18n.ts'), 'utf8')
const zhBlock = i18nSource.split('const ZH')[1]?.split('const EN')[0] ?? ''
const dictKeys = new Set([...zhBlock.matchAll(/^\s{2}([A-Za-z0-9_]+):/gm)].map((m) => m[1]))
const settingsKeys = new Set([...baseKeys].filter((key) => key.startsWith('settings.')).map((key) => key.slice(9)))
for (const key of dictKeys) if (!settingsKeys.has(key)) problems.push('配置页字典的 ' + key + ' 在 ini 里缺少 settings.' + key)
for (const key of settingsKeys) if (!dictKeys.has(key)) problems.push('ini 的 settings.' + key + ' 在配置页字典里缺少对应项')

/* 界面常量 <-> ini 键: 显式映射, 同时比值, 键同值不同也要报 */
const CONSTANT_KEY_MAP = {
  COUNTDOWN_TEXT: 'countdown.remaining',
  COUNTDOWN_PAUSED_TEXT: 'countdown.paused',
  SYNC_UNAVAILABLE_TEXT: 'countdown.unavailable',
  INFINITE_WAIT_LABEL: 'control.infiniteWait',
  BUBBLE_DRAFT_LABEL: 'bubble.draftLabel',
  DRAFT_SELECTED_LABEL: 'draft.selected',
  DRAFT_CUSTOM_LABEL: 'draft.custom',
  DRAFT_PANEL_TITLE: 'draftPanel.title',
  DRAFT_PANEL_NOTE: 'draftPanel.note',
  DRAFT_PANEL_EMPTY: 'draftPanel.empty',
  DRAFT_PANEL_UNANSWERED: 'draftPanel.unanswered',
  DRAFT_SYNC_FAILED_TEXT: 'draft.deliveryFailed',
}

/* 数组型文案常量到 ini 键的映射 */
const ARRAY_KEY_MAP = {
  TAKE_TIME_TEXTS: 'control.takeTime',
}

const enIni = parseIni(readFileSync(join(ROOT, 'src/translation/en-US.ini'), 'utf8'))
for (const pair of literalPairs()) {
  const key = CONSTANT_KEY_MAP[pair.name]
  if (key === undefined) {
    problems.push('常量 ' + pair.name + '_ZH/_EN 未登记在检查映射里')
    continue
  }
  const zhExpected = baseline.entries.get(key)
  const enExpected = enIni.entries.get(key)
  if (zhExpected === undefined) problems.push('常量 ' + pair.name + ' 对应的 ini 键不存在: ' + key)
  else if (zhExpected !== pair.zh) problems.push('常量 ' + pair.name + '_ZH 与 ini ' + key + ' 取值不一致')
  if (enExpected !== undefined && enExpected !== pair.en) {
    problems.push('常量 ' + pair.name + '_EN 与 en-US.ini ' + key + ' 取值不一致')
  }
}

/* 数组型常量与 ini 键的取值比对 */
for (const item of arrayLiterals()) {
  const key = ARRAY_KEY_MAP[item.name]
  if (key === undefined) continue
  const zhExpected = baseline.entries.get(key)
  const enExpected = enIni.entries.get(key)
  if (zhExpected === undefined) problems.push('数组常量 ' + item.name + ' 对应的 ini 键不存在: ' + key)
  else if (zhExpected !== item.zh) problems.push('数组常量 ' + item.name + ' 的中文取值与 ini ' + key + ' 不一致')
  if (enExpected !== undefined && enExpected !== item.en) {
    problems.push('数组常量 ' + item.name + ' 的英文取值与 en-US.ini ' + key + ' 不一致')
  }
}

/* 配置页字典的取值必须与 ini 的 settings.* 一致 */
const dictValues = (block) => {
  const out = new Map()
  for (const match of block.matchAll(/^\s{2}([A-Za-z0-9_]+):\s*'((?:[^'\\]|\\.)*)'/gm)) out.set(match[1], match[2])
  return out
}
const zhValues = dictValues(zhBlock)
const enBlock = i18nSource.split('const EN')[1] ?? ''
const enValues = dictValues(enBlock)
for (const key of settingsKeys) {
  const zhExpected = baseline.entries.get('settings.' + key)
  const zhActual = zhValues.get(key)
  if (zhActual === undefined) {
    problems.push('配置页字典缺少取值: ' + key)
    continue
  }
  if (zhExpected !== undefined && zhExpected !== zhActual) {
    problems.push('配置页字典的 ' + key + ' 与 ini settings.' + key + ' 取值不一致')
  }
  const enExpected = enIni.entries.get('settings.' + key)
  const enActual = enValues.get(key)
  if (enActual !== undefined && enExpected !== undefined && enExpected !== enActual) {
    problems.push('配置页英文字典的 ' + key + ' 与 en-US.ini settings.' + key + ' 取值不一致')
  }
}

/* [meta] 校验: for 与包版本一致, lang 与文件名一致, endtime 形如指定格式 */
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
for (const file of FILES) {
  const parsed = parseIni(readFileSync(join(ROOT, file), 'utf8'))
  const forValue = parsed.entries.get('meta.for')
  if (forValue !== 'v' + pkg.version) problems.push(file + ' 的 meta.for 与包版本不一致: ' + String(forValue))
  const lang = parsed.entries.get('meta.lang')
  const expectedLang = file.endsWith('en-US.ini') ? 'en-US' : 'zh-CN'
  if (lang !== expectedLang) problems.push(file + ' 的 meta.lang 应为 ' + expectedLang + ', 实际 ' + String(lang))
  const endtime = parsed.entries.get('meta.endtime') ?? ''
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\+\d{2}:\d{2}$/.test(endtime)) {
    problems.push(file + ' 的 meta.endtime 格式不合规: ' + endtime)
  }
}

if (problems.length > 0) {
  console.error('翻译一致性检查未通过:')
  for (const problem of problems) console.error('  - ' + problem)
  process.exit(1)
}
console.log('翻译一致性检查通过, 共 ' + String(baseKeys.size) + ' 个键')