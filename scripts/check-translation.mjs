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

/*
 * 抽取数组型文案常量。
 * 数组可能跨多行书写, 因此整体取出数组字面量再逐个解析元素;
 * 只认单行两元素数组的正则会让跨行书写的常量整组脱离校验, 改动它时检查脚本不会报。
 */
function arrayLiterals() {
  const source = readFileSync(join(ROOT, 'src/constants.ts'), 'utf8')
  const out = []
  for (const match of source.matchAll(
    /export const ([A-Za-z0-9_]+)\s*:\s*readonly string\[\]\s*=\s*\[([\s\S]*?)\]/g,
  )) {
    const elements = [...match[2].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((element) => element[1])
    out.push({ name: match[1], elements })
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
/*
 * 取两块字典: 按整行锚定 const ZH = { 与 const EN: ... = { ,
 * 不用 split('const EN') 这种子串切分 —— 源码里出现 const ENTRY 之类的标识符就会切错块,
 * 切错之后英文取值比对会被静默跳过。
 */
function dictBlock(source, header) {
  const matched = source.match(new RegExp('const ' + header + '(?::[^=]*)?\\s*=\\s*\\{([\\s\\S]*?)\\n\\}'))
  return matched === null ? '' : matched[1]
}
const zhBlock = dictBlock(i18nSource, 'ZH')
const enBlock = dictBlock(i18nSource, 'EN')
if (zhBlock === '' || enBlock === '') problems.push('没能从 src/client/i18n.ts 里取出中英文案字典')
const dictKeys = new Set([...zhBlock.matchAll(/^\s{2}([A-Za-z0-9_]+):/gm)].map((m) => m[1]))
const settingsKeys = new Set([...baseKeys].filter((key) => key.startsWith('settings.')).map((key) => key.slice(9)))
for (const key of dictKeys) if (!settingsKeys.has(key)) problems.push('配置页字典的 ' + key + ' 在 ini 里缺少 settings.' + key)
for (const key of settingsKeys) if (!dictKeys.has(key)) problems.push('ini 的 settings.' + key + ' 在配置页字典里缺少对应项')


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

/* 数组型文案常量到 ini 键的映射(仅收录需要镜像的数组) */
const ARRAY_KEY_MAP = {
  TAKE_TIME_TEXTS: 'control.takeTime',
}

/*
 * 宿主控件的识别文案: 按收录边界不进镜像(宿主改版就会变, 镜像它们只会带来无意义的同步负担),
 * 但它们是插件定位宿主控件的唯一依据, 一旦被误改就会静默失效。
 * 这里记录一份基线取值, 源码里的数组与基线不一致时报错, 改动时同步更新本表。
 */
const HOST_LABEL_BASELINE = {
  TAKE_TIME_TEXTS: ['慢慢回答', 'Take time'],
  COLLAPSE_CONTROL_LABELS: [
    '收起问题卡片',
    '展开问题卡片',
    'Collapse the question card',
    'Expand the question card',
  ],
  CLOSE_PANEL_LABELS: ['收起问题面板，可从工具调用重新打开', 'Close the panel — reopen it from the tool call'],
  ASK_REOPEN_LABELS: ['回答', 'Answer'],
  SUBMIT_TEXTS: ['提交', 'Submit'],
  NEXT_QUESTION_TEXTS: ['下一题', 'Next'],
  SKIP_QUESTION_TEXTS: ['跳过', 'Skip'],
}

/*
 * 宿主识别文案数组的登记名: 不在镜像表里, 也不在基线表里, 就是漏登记。
 */
const HOST_LABEL_ARRAYS = new Set(Object.keys(HOST_LABEL_BASELINE))

/*
 * 每个镜像键期望的占位符集合。
 * 只校验"占位符在代码里被替换过"不够: {items} 与 {text} 对调时那一条仍然通过,
 * 界面上的「已选」会显示用户补充的文本, 因此这里按键绑定占位符名。
 */
const KEY_PLACEHOLDERS = {
  'countdown.remaining': ['seconds'],
  'draft.selected': ['items'],
  'draft.custom': ['text'],
}

/*
 * 界面常量 <-> ini 键: 显式映射, 同时比值, 键同值不同也要报。
 * 映射表里的每个常量名都必须在源码里真的存在: 常量被删掉而映射表还留着,
 * 取值比对会整体跳过, 那一条文案就静默脱离检查。
 */
const constantsSource = readFileSync(join(ROOT, 'src/constants.ts'), 'utf8')
for (const name of Object.keys(CONSTANT_KEY_MAP)) {
  for (const suffix of ['_ZH', '_EN']) {
    if (!constantsSource.includes('export const ' + name + suffix)) {
      problems.push('常量 ' + name + suffix + ' 在 src/constants.ts 里不存在, 映射表需要同步更新')
    }
  }
}
/*
 * 源码里出现的中英文文案常量必须成对: 少了英文那一半时, 取值比对会把整条跳过,
 * 界面上的英文就会悄悄退回别的措辞。
 */
for (const match of constantsSource.matchAll(/export const ([A-Za-z0-9_]+)_ZH\s*=/g)) {
  if (!constantsSource.includes('export const ' + match[1] + '_EN')) {
    problems.push('常量 ' + match[1] + '_EN 不存在, 中英文文案没有成对')
  }
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
  if (key === undefined) {
    /*
     * 未登记的数组常量不能静默跳过: 它要么该进镜像, 要么该登记成宿主识别文案,
     * 两者都要求有人明确决定一次。
     */
    if (!HOST_LABEL_ARRAYS.has(item.name)) {
      problems.push('数组常量 ' + item.name + ' 未登记: 要么登记进 ARRAY_KEY_MAP, 要么登记进 HOST_LABEL_ARRAYS')
    }
    continue
  }
  if (item.elements.length !== 2) {
    problems.push('数组常量 ' + item.name + ' 的元素个数不是 2, 无法与 ini 键比对')
    continue
  }
  const zhExpected = baseline.entries.get(key)
  const enExpected = enIni.entries.get(key)
  if (zhExpected === undefined) problems.push('数组常量 ' + item.name + ' 对应的 ini 键不存在: ' + key)
  else if (zhExpected !== item.elements[0]) problems.push('数组常量 ' + item.name + ' 的中文取值与 ini ' + key + ' 不一致')
  if (enExpected !== undefined && enExpected !== item.elements[1]) {
    problems.push('数组常量 ' + item.name + ' 的英文取值与 en-US.ini ' + key + ' 不一致')
  }
}

/*
 * 宿主识别文案的数组: 取值必须与基线一致。
 * 这些文案是插件定位宿主控件的唯一依据, 被误改就会静默失效, 因此逐字比对。
 */
for (const item of arrayLiterals()) {
  if (!HOST_LABEL_ARRAYS.has(item.name)) continue
  const baseline = HOST_LABEL_BASELINE[item.name]
  if (item.elements.join('\u0000') !== baseline.join('\u0000')) {
    problems.push(
      '宿主识别文案数组 ' + item.name + ' 与基线不一致, 改动时需同步检查脚本里的 HOST_LABEL_BASELINE',
    )
  }
}

/* 配置页字典的取值必须与 ini 的 settings.* 一致 */
const dictValues = (block) => {
  const out = new Map()
  for (const match of block.matchAll(/^\s{2}([A-Za-z0-9_]+):\s*'((?:[^'\\]|\\.)*)'/gm)) out.set(match[1], match[2])
  return out
}
const zhValues = dictValues(zhBlock)
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

/* 模板的 meta 段必须与中文版逐字相同 */
for (const key of ['meta.for', 'meta.lang', 'meta.name', 'meta.endtime']) {
  if (template.entries.get(key) !== baseline.entries.get(key)) {
    problems.push('基准模板的 ' + key + ' 与中文版不一致')
  }
}

/*
 * 占位符必须真的被替换: 界面代码里 replace 的目标串集合要与 ini 里的占位符名称对齐,
 * 否则占位符会原样出现在界面上。
 */
const adapterSource = readFileSync(join(ROOT, 'src/client/adapter.ts'), 'utf8')
const replaceTargets = new Set([...adapterSource.matchAll(/\.replace\('(\{[a-zA-Z0-9_]+\})'/g)].map((m) => m[1]))
for (const key of baseKeys) {
  for (const name of placeholders(baseline.entries.get(key) ?? '')) {
    const token = '{' + name + '}'
    if (!replaceTargets.has(token)) problems.push('占位符 ' + token + ' (键 ' + key + ') 在 src/client/adapter.ts 里没有对应的替换目标')
  }
}

/* 镜像键与占位符名必须一一对应, {items} 与 {text} 对调也要能查出来 */
for (const [key, expected] of Object.entries(KEY_PLACEHOLDERS)) {
  const actual = placeholders(baseline.entries.get(key) ?? '')
  if (actual.join(',') !== expected.join(',')) {
    problems.push('键 ' + key + ' 的占位符应为 ' + expected.join(',') + ', 实际为 ' + (actual.join(',') || '(无)'))
  }
}

/*
 * ini 键必须都有代码来源: 键集应当正好等于
 * 镜像标量常量 + 镜像数组常量 + 配置页字典三部分的并集。
 * 三份 ini 同时多出一个没人用的孤儿键, 或代码里的常量被删掉而 ini 留着, 都要报错。
 */
const sourceKeys = new Set()
for (const name of Object.keys(CONSTANT_KEY_MAP)) sourceKeys.add(CONSTANT_KEY_MAP[name])
for (const name of Object.keys(ARRAY_KEY_MAP)) sourceKeys.add(ARRAY_KEY_MAP[name])
for (const key of settingsKeys) sourceKeys.add('settings.' + key)
for (const key of baseKeys) {
  if (!sourceKeys.has(key)) problems.push('ini 的键 ' + key + ' 在代码里找不到对应来源')
}
for (const key of sourceKeys) {
  if (!baseKeys.has(key)) problems.push('代码里的来源键 ' + key + ' 在 ini 里缺失')
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