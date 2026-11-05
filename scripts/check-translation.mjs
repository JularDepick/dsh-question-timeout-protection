#!/usr/bin/env node
/*
 * 翻译文件一致性检查
 *
 * 以中文版为基准做四件事:
 * 1. 全部 ini 的键集, 重复键, 空值, 占位符是否一致;
 * 2. 配置页字典的键与 ini 的 settings.* 是否一一对应;
 * 3. 界面常量里的中英文案是否都有对应 ini 键且取值一致;
 * 4. [meta] 的版本号与语言标识是否与包清单和文件名相符。
 * 任何不一致都以非零退出。
 * 作者: JularDepick
 */

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BASELINE = 'src/translation/zh-CN.ini'
const TEMPLATE = 'src/translation/.example_zh-CN.ini'
const TRANSLATION_DIR = 'src/translation'

/*
 * 全部翻译文件都纳入检查: 新增语言若不登记, 它的漂移不会有人拦,
 * 因此这里按目录实际内容枚举, 而不是写死文件名清单。
 */
function listIniFiles() {
  const names = readdirSync(join(ROOT, TRANSLATION_DIR)).filter((name) => name.endsWith('.ini')).sort()
  return names.map((name) => TRANSLATION_DIR + '/' + name)
}

const FILES = listIniFiles()

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
 * 源码字面量读取。
 *
 * 之前按书写风格抽字面量(只认单引号与固定类型的数组注解), 改一次写法
 * (换引号、加类型注解、换成 as const)整组常量就脱离校验, 而这类漂移的表现是
 * 界面文案与 ini 对不上、宿主控件定位失效, 都不会报错。
 * 因此这里按字面量本身解析取值, 不依赖书写风格。
 */

/* 读一个字符串字面量, 返回取值与结束位置 */
function readStringLiteral(source, start) {
  const quote = source[start]
  if (quote !== "'" && quote !== '"' && quote !== String.fromCharCode(96)) return undefined
  let value = ''
  let i = start + 1
  while (i < source.length) {
    const ch = source[i]
    if (ch === '\\') {
      value += ch + (source[i + 1] ?? '')
      i += 2
      continue
    }
    if (ch === quote) return { value, end: i + 1 }
    value += ch
    i += 1
  }
  return undefined
}

/*
 * TypeScript 关键字: 常量声明扫描时必须排除, 否则 "as const" 会被当成常量名登记。
 */
const RESERVED_WORDS = new Set(['const', 'let', 'var', 'function', 'class', 'type', 'interface', 'enum', 'namespace', 'declare'])

/*
 * 收集源码里所有常量声明的位置。
 * 用一条全局正则扫描, 避免为每个常量名临时拼正则 ——
 * 拼出来的正则一旦转义写错, 整份检查会静默失效。
 */
function constDeclarations(source) {
  const found = new Map()
  for (const match of source.matchAll(/(?:export[ \t]+)?const[ \t]+([A-Za-z0-9_]+)\b/g)) {
    /*
     * 关键字本身也会被这条正则匹配到: "as const" 后面换行再写一个 const 时,
     * 贪婪的空白匹配会把下一个 const 吃掉, 于是真正的常量名永远登记不上。
     * 因此先把关键字排除掉。
     */
    if (RESERVED_WORDS.has(match[1])) continue
    if (!found.has(match[1])) found.set(match[1], match.index + match[0].length)
  }
  return found
}

/* 定位常量取值的起点(等号右侧第一个字符), 跳过类型注解 */
function constValueStart(source, declarations, name) {
  const declared = declarations.get(name)
  if (declared === undefined) return undefined
  let i = declared
  while (i < source.length && /\s/.test(source[i])) i += 1
  if (source[i] === ':') {
    let depth = 0
    while (i < source.length) {
      const ch = source[i]
      if (ch === '<' || ch === '(' || ch === '[' || ch === '{') depth += 1
      else if (ch === '>' || ch === ')' || ch === ']' || ch === '}') depth -= 1
      else if (ch === '=' && depth <= 0) break
      i += 1
    }
    while (i < source.length && /\s/.test(source[i])) i += 1
  }
  if (source[i] !== '=') return undefined
  i += 1
  while (i < source.length && /\s/.test(source[i])) i += 1
  return i
}

/* 读数组字面体的原始内容: 字符串数组与正则数组都要先取到数组体 */
function readArrayBody(source, start) {
  if (source[start] !== '[') return undefined
  let depth = 0
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === "'" || ch === '"' || ch === String.fromCharCode(96)) {
      const parsed = readStringLiteral(source, i)
      if (parsed === undefined) return undefined
      i = parsed.end - 1
      continue
    }
    if (ch === '[') depth += 1
    else if (ch === ']') {
      depth -= 1
      if (depth === 0) return source.slice(start + 1, i)
    }
  }
  return undefined
}

/* 读数组字面量, 返回元素与"是否全为字符串" */
function readArrayLiteral(source, start) {
  const body = readArrayBody(source, start)
  if (body === undefined) return undefined
  const elements = []
  const pattern = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|\x60((?:[^\x60\\]|\\.)*)\x60/g
  for (const match of body.matchAll(pattern)) elements.push(match[1] ?? match[2] ?? match[3])
  const items = body.split(',').filter((part) => part.trim() !== '')
  return { elements, textual: items.length === elements.length }
}

/* 从数组体里逐字取出正则字面量的模式串, 不编译也不求值 */
function readRegExpPatterns(body) {
  const patterns = []
  for (const match of body.matchAll(/\/((?:\\.|[^/\\\n])*)\/([gimsuy]*)/g)) patterns.push(match[1])
  return patterns
}

/* 读对象字面量的字符串属性 */
function readObjectEntries(source, start) {
  if (source[start] !== '{') return undefined
  const entries = new Map()
  let i = start + 1
  while (i < source.length) {
    const ch = source[i]
    if (ch === '}') return entries
    if (ch === "'" || ch === '"' || ch === String.fromCharCode(96)) {
      const parsed = readStringLiteral(source, i)
      if (parsed === undefined) return undefined
      i = parsed.end
      continue
    }
    if (/[A-Za-z0-9_]/.test(ch)) {
      let j = i
      while (j < source.length && /[A-Za-z0-9_]/.test(source[j])) j += 1
      const key = source.slice(i, j)
      let k = j
      while (k < source.length && /\s/.test(source[k])) k += 1
      if (source[k] !== ':') {
        i = j
        continue
      }
      k += 1
      while (k < source.length && /\s/.test(source[k])) k += 1
      if (source[k] === "'" || source[k] === '"' || source[k] === String.fromCharCode(96)) {
        const parsed = readStringLiteral(source, k)
        if (parsed === undefined) return undefined
        entries.set(key, parsed.value)
        i = parsed.end
        continue
      }
      i = k
      continue
    }
    i += 1
  }
  return entries
}

/*
 * 从源码里抽文案常量。
 * 标量常量按 NAME_ZH / NAME_EN 成对抽取; 数组常量按 NAME = [...] 抽取。
 */
function literalPairs() {
  const source = readFileSync(join(ROOT, 'src/constants.ts'), 'utf8')
  const declarations = constDeclarations(source)
  const pairs = []
  const names = new Set()
  for (const match of source.matchAll(/export const ([A-Za-z0-9_]+)_ZH\b/g)) names.add(match[1])
  for (const name of names) {
    const zhStart = constValueStart(source, declarations, name + '_ZH')
    if (zhStart === undefined) continue
    const zhLiteral = readStringLiteral(source, zhStart)
    if (zhLiteral === undefined) continue
    const enStart = constValueStart(source, declarations, name + '_EN')
    if (enStart === undefined) continue
    const enLiteral = readStringLiteral(source, enStart)
    if (enLiteral === undefined) continue
    pairs.push({ name, zh: zhLiteral.value, en: enLiteral.value })
  }
  return pairs
}

/*
 * 抽取数组型文案常量。
 * 数组可能跨多行书写, 元素可能带 as const 或 satisfies, 因此按字面量解析取值。
 */
function arrayLiterals() {
  const source = readFileSync(join(ROOT, 'src/constants.ts'), 'utf8')
  const declarations = constDeclarations(source)
  const out = []
  for (const name of declarations.keys()) {
    const start = constValueStart(source, declarations, name)
    if (start === undefined) continue
    const parsed = readArrayLiteral(source, start)
    if (parsed === undefined) continue
    const body = readArrayBody(source, start)
    if (body === undefined) continue
    out.push({ name, elements: parsed.elements, textual: parsed.textual, patterns: readRegExpPatterns(body) })
  }
  return out
}

/*
 * 允许与中文版(或另一种语言)取值完全相同的键。
 * 正常应当为空: 取值相同的键要么是漏译, 要么是本来就该两边一致的专有名词。
 * 真要放行时在这里登记, 并写明理由。
 */
const SAME_AS_BASELINE = new Set([])

const problems = []
const baseline = parseIni(readFileSync(join(ROOT, BASELINE), 'utf8'))
const baseKeys = new Set([...baseline.entries.keys()].filter((key) => !key.startsWith('meta.')))

if (!FILES.includes(BASELINE)) problems.push('基准文件缺失: ' + BASELINE)
if (!FILES.includes(TEMPLATE)) problems.push('基准模板缺失: ' + TEMPLATE)

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
const template = parseIni(readFileSync(join(ROOT, TEMPLATE), 'utf8'))
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

/*
 * 新增语言必须真的翻译过:
 * 取值与中文版逐字相同说明没翻译; 与另一种语言逐字相同多半是直接照抄;
 * 所有取值写成同一个字符串则根本没逐条填。
 */
for (const file of FILES) {
  if (file === BASELINE || file === TEMPLATE) continue
  const parsed = parseIni(readFileSync(join(ROOT, file), 'utf8'))
  const values = []
  const identicalKeys = []
  for (const key of baseKeys) {
    const value = parsed.entries.get(key)
    if (value === undefined) continue
    values.push(value)
    if (value === baseline.entries.get(key)) identicalKeys.push(key)
  }
  if (values.length === 0) continue
  /*
   * 逐键判定: 只有整份文件全部照抄才报的话, 漏译一个键会被当成通过,
   * 而界面上的那一条就会一直显示中文原文。允许的例外只在 SAME_AS_BASELINE 里登记。
   */
  for (const key of identicalKeys) {
    if (SAME_AS_BASELINE.has(key)) continue
    problems.push(file + ' 的 ' + key + ' 与中文版逐字相同, 看起来没有翻译')
  }
  if (new Set(values).size === 1) problems.push(file + ' 的所有文案都写成同一个字符串, 看起来没有逐条翻译')
  /*
   * 与另一种已收录语言逐字相同: 多半是直接复制过去忘了翻译,
   * 这种文件一旦混进发布包, 界面会显示另一种语言却标着别的语种。
   */
  for (const other of FILES) {
    if (other === file || other === BASELINE || other === TEMPLATE) continue
    const otherParsed = parseIni(readFileSync(join(ROOT, other), 'utf8'))
    const sameKeys = []
    for (const key of baseKeys) {
      const value = parsed.entries.get(key)
      const reference = otherParsed.entries.get(key)
      if (value === undefined || reference === undefined) continue
      if (value === reference) sameKeys.push(key)
    }
    /*
     * 逐键比对, 同时保留整份照抄的判定: 整份相同是最典型的复制粘贴漏翻译,
     * 只报逐键会让一份完全照抄的文件刷出几十条重复问题。
     */
    if (sameKeys.length === baseKeys.size) {
      problems.push(file + ' 的文案与 ' + other + ' 逐字相同, 看起来没有翻译')
      continue
    }
    for (const key of sameKeys) {
      if (SAME_AS_BASELINE.has(key)) continue
      problems.push(file + ' 的 ' + key + ' 与 ' + other + ' 逐字相同, 看起来没有翻译')
    }
  }
}

/* 配置页字典 <-> ini 的 settings.* */
const i18nSource = readFileSync(join(ROOT, 'src/client/i18n.ts'), 'utf8')
const i18nDeclarations = constDeclarations(i18nSource)

/* 取两块字典: 按常量定义定位取值起点再读对象字面量, 不用子串切分 */
function dictBlock(source, declarations, header) {
  const start = constValueStart(source, declarations, header)
  if (start === undefined) return undefined
  return readObjectEntries(source, start)
}
const zhBlock = dictBlock(i18nSource, i18nDeclarations, 'ZH')
const enBlock = dictBlock(i18nSource, i18nDeclarations, 'EN')
if (zhBlock === undefined || enBlock === undefined) problems.push('没能从 src/client/i18n.ts 里取出中英文案字典')
const dictKeys = new Set(zhBlock === undefined ? [] : [...zhBlock.keys()])
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
  DRAFT_TOO_LARGE_TEXT: 'draft.tooLarge',
  AUTO_INFINITE_LABEL: 'control.autoInfiniteLabel',
  AUTO_INFINITE_ON_TEXT: 'control.autoInfiniteOn',
  AUTO_INFINITE_OFF_TEXT: 'control.autoInfiniteOff',
  AUTO_INFINITE_TITLE: 'control.autoInfiniteTitle',
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
  /* 卡片侧与工具行侧两套文案, 少一条就会在英文界面下静默失效 */
  HOST_WAIT_PATTERNS: [
    '会一直等你回答',
    '已继续工作',
    'Waiting until you answer',
    'Work continued',
    'continued; answer still available',
  ],
  COLLAPSE_CONTROL_LABELS: [
    '收起问题卡片',
    '展开问题卡片',
    'Collapse the question card',
    'Expand the question card',
  ],
  CLOSE_PANEL_LABELS: ['收起问题面板，可从工具调用重新打开', 'Close the panel — reopen it from the tool call'],
  /*
   * 结算后同一按钮的文案变成「查看回答」, 恢复入口时也要认它。
   * ja 的 ask.reopen 与中文同形, 结算后的 ask.review 是「回答を表示」:
   * 补它只是恢复宿主回看入口, 不是让装饰链在非中英界面启用。
   */
  ASK_REOPEN_LABELS: ['回答', 'Answer', '查看回答', 'View answers', '回答を表示'],
  SUBMIT_TEXTS: ['提交', 'Submit'],
  NEXT_QUESTION_TEXTS: ['下一题', 'Next'],
  SKIP_QUESTION_TEXTS: ['跳过', 'Skip'],
}

/*
 * 宿主倒计时与暂停态的识别正则: 它们决定倒计时、无限等待、工具栏开关与自动冻结是否出现。
 * 取值逐字取自 dsh-client-ui-user-questions 的 wait.countdown 与 wait.paused:
 * 0.2.1-rc.2 与 0.2.2-rc.1 的中英文版均为
 * 「{seconds} 秒后继续工作」「已暂停 · 剩余 {seconds} 秒」
 * 「Continuing in {seconds}s」「Paused · {seconds}s remaining」, 两版逐字一致。
 * 宿主改一处措辞, 装饰整链会静默失效, 因此这里按源码里的正则模式逐字对账。
 */
const HOST_PATTERN_BASELINE = {
  COUNTDOWN_PATTERNS: [
    '(\\d+)\\s*秒后(?:继续工作|超时|继续)',
    '剩余\\s*(\\d+)\\s*秒',
    '(?:Continuing in|Timeout in) (\\d+)s',
    'Paused · (\\d+)s remaining',
  ],
  PAUSED_TEXT_PATTERNS: ['已暂停', 'Paused'],
}

/*
 * 宿主 wait.countdown / wait.paused 的原始文案, 逐字取自两个受支持版本:
 * temp/pkg-022/ex 下 0.2.2-rc.1 与 temp/ref-pkgs/extracted 下 0.2.1-rc.2 的中英文取值完全相同。
 * 用它们渲染成实际界面文本, 再要求识别正则能读出秒数并正确区分暂停态:
 * 只比对正则自身是否改动不够, 宿主措辞一变这里就会先报出来。
 */
const HOST_WAIT_TEXT_BASELINE = [
  { template: '{seconds} 秒后继续工作', paused: false },
  { template: '已暂停 · 剩余 {seconds} 秒', paused: true },
  { template: 'Continuing in {seconds}s', paused: false },
  { template: 'Paused · {seconds}s remaining', paused: true },
]
const HOST_WAIT_SAMPLE_SECONDS = '12'

/*
 * 宿主模型选择控件的无障碍标签前缀。
 * 已核实 dsh-client-ui-model-selection@0.2.2-rc.1 的 trigger.aria 为
 * 「选择模型，当前 {model}」与「Select model, current {model}」,
 * MODEL_SELECTOR_BUTTON 按这两个前缀做选择器匹配, 取值不改, 但必须显式断言前缀没有漂移。
 */
const HOST_MODEL_SELECTOR_PREFIXES = ['选择模型', 'Select model']

/*
 * 宿主识别文案数组的登记名: 不在镜像表里, 也不在基线表里, 就是漏登记。
 */
const HOST_LABEL_ARRAYS = new Set(Object.keys(HOST_LABEL_BASELINE))

/* 宿主识别正则数组的登记名: 不进 ini 镜像, 但必须与 HOST_PATTERN_BASELINE 逐字一致 */
const HOST_PATTERN_ARRAYS = new Set(Object.keys(HOST_PATTERN_BASELINE))

/*
 * 不是文案的数组常量: 取值是配置枚举, 不参与镜像比对, 也不需要登记。
 * 正则数组已改由 HOST_PATTERN_BASELINE 对账, 不能再从这里放行。
 */
const IGNORED_ARRAYS = new Set(['FALLBACK_MODES'])

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
 * 占位符与数据来源的绑定: 替换目标里必须出现对应的数据来源,
 * 否则 {items} 与 {text} 对调时两者都还在, 但界面会渲染错位。
 */
const PLACEHOLDER_SOURCES = {
  '{items}': 'selected',
  '{text}': 'custom',
  '{seconds}': 'seconds',
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
for (const match of constantsSource.matchAll(/export const ([A-Za-z0-9_]+)_ZH\b/g)) {
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
  if (!item.textual) {
    /*
     * 正则数组按 HOST_PATTERN_BASELINE 逐字对账, 不得再靠 IGNORED_ARRAYS 静默跳过。
     * 其余非字符串数组仍按旧口径要求显式登记。
     */
    if (HOST_PATTERN_ARRAYS.has(item.name)) continue
    if (!IGNORED_ARRAYS.has(item.name)) {
      problems.push('数组常量 ' + item.name + ' 含非字符串元素, 需要登记进 IGNORED_ARRAYS')
    }
    continue
  }
  const key = ARRAY_KEY_MAP[item.name]
  if (key === undefined) {
    /*
     * 未登记的数组常量不能静默跳过: 它要么该进镜像, 要么该登记成宿主识别文案,
     * 两者都要求有人明确决定一次。
     */
    if (!HOST_LABEL_ARRAYS.has(item.name) && !IGNORED_ARRAYS.has(item.name)) {
      problems.push(
        '数组常量 ' + item.name + ' 未登记: 要么登记进 ARRAY_KEY_MAP, 要么登记进 HOST_LABEL_ARRAYS 或 IGNORED_ARRAYS',
      )
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
 * 宿主识别文案的数组与正则数组: 取值必须与基线一致。
 * 这些取值是插件定位宿主控件与读取倒计时的唯一依据, 被误改就会静默失效, 因此逐字比对。
 */
const sourceArrays = arrayLiterals()
const sourceArrayNames = new Set(sourceArrays.map((item) => item.name))
for (const item of sourceArrays) {
  const labels = HOST_LABEL_BASELINE[item.name]
  if (labels !== undefined) {
    if (!item.textual || item.elements.join('\u0000') !== labels.join('\u0000')) {
      problems.push(
        '宿主识别文案数组 ' + item.name + ' 与基线不一致, 改动时需同步检查脚本里的 HOST_LABEL_BASELINE',
      )
    }
    continue
  }
  const patterns = HOST_PATTERN_BASELINE[item.name]
  if (patterns === undefined) continue
  /* 正则数组必须是纯正则: 写成字符串数组就再也读不出剩余秒数, 这里一并拦下 */
  if (item.textual || item.patterns.length !== patterns.length || item.patterns.join('\u0000') !== patterns.join('\u0000')) {
    problems.push(
      '宿主识别正则数组 ' + item.name + ' 与基线不一致, 改动时需同步检查脚本里的 HOST_PATTERN_BASELINE',
    )
  }
}
/* 基线里登记但源码里已经删掉的常量也要报: 否则删掉整个数组就能绕过对账 */
for (const name of HOST_LABEL_ARRAYS) {
  if (!sourceArrayNames.has(name)) problems.push('宿主识别文案数组 ' + name + ' 在 src/constants.ts 里不存在')
}
for (const name of HOST_PATTERN_ARRAYS) {
  if (!sourceArrayNames.has(name)) problems.push('宿主识别正则数组 ' + name + ' 在 src/constants.ts 里不存在')
}

/*
 * 用登记的原始宿主文案跑一遍识别规则: 倒计时必须能读出示例秒数,
 * 暂停态判定必须与文案的 paused 标记一致, 否则宿主措辞变化会先在这里报出来。
 */
const countdownPatterns = HOST_PATTERN_BASELINE.COUNTDOWN_PATTERNS.map((pattern) => new RegExp(pattern))
const pausedPatterns = HOST_PATTERN_BASELINE.PAUSED_TEXT_PATTERNS.map((pattern) => new RegExp(pattern))
for (const sample of HOST_WAIT_TEXT_BASELINE) {
  const text = sample.template.replace('{seconds}', HOST_WAIT_SAMPLE_SECONDS)
  const seconds = countdownPatterns.map((pattern) => pattern.exec(text)?.[1]).find((value) => value !== undefined)
  if (seconds !== HOST_WAIT_SAMPLE_SECONDS) {
    problems.push('宿主文案 ' + sample.template + ' 已无法由倒计时识别规则读出秒数, 需同步 HOST_PATTERN_BASELINE')
  }
  const paused = pausedPatterns.some((pattern) => pattern.test(text))
  if (paused !== sample.paused) {
    problems.push('宿主文案 ' + sample.template + ' 的暂停态判定与基线不一致, 需同步 HOST_PATTERN_BASELINE')
  }
}

/*
 * MODEL_SELECTOR_BUTTON 的显式断言: 它不是数组常量, 不在上面的宿主基线里,
 * 但前缀一旦漂移, 工具栏开关、自动冻结与倒计时整条装饰链都会找不到锚点。
 * 这里按前缀拼出期望选择器逐字比对, 并核对常量真的被适配器读取。
 */
const constantsDeclarations = constDeclarations(constantsSource)
const modelSelectorValueStart = constValueStart(constantsSource, constantsDeclarations, 'MODEL_SELECTOR_BUTTON')
const modelSelectorLiteral = modelSelectorValueStart === undefined
  ? undefined
  : readStringLiteral(constantsSource, modelSelectorValueStart)
const expectedModelSelector = HOST_MODEL_SELECTOR_PREFIXES
  .map((prefix) => 'button[aria-label^="' + prefix + '"]')
  .join(', ')
if (modelSelectorLiteral === undefined || modelSelectorLiteral.value !== expectedModelSelector) {
  problems.push('常量 MODEL_SELECTOR_BUTTON 与宿主模型选择标签前缀登记不一致, 改动时需同步 HOST_MODEL_SELECTOR_PREFIXES')
}

/* 配置页字典的取值必须与 ini 的 settings.* 一致 */
const zhValues = zhBlock ?? new Map()
const enValues = enBlock ?? new Map()
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
  if (enActual === undefined) {
    problems.push('配置页英文字典缺少取值: ' + key)
    continue
  }
  if (enExpected !== undefined && enExpected !== enActual) {
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
/* MODEL_SELECTOR_BUTTON 登记了却没人用, 等于宿主改文案时永远不会有人复核这处基线 */
if (!adapterSource.includes('MODEL_SELECTOR_BUTTON')) {
  problems.push('src/client/adapter.ts 不再读取 MODEL_SELECTOR_BUTTON, 宿主选择器登记需要复核')
}
const replaceTargets = new Map()
for (const match of adapterSource.matchAll(/\.replace\('(\{[a-zA-Z0-9_]+\})'\s*,\s*([^\n]*)/g)) {
  replaceTargets.set(match[1], match[2])
}
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
 * 占位符与数据来源的绑定: 替换目标里必须出现对应的数据来源。
 * 只看占位符名出现过是不够的, {items} 与 {text} 对调时两者都还在, 但界面会错位。
 */
for (const [token, source] of Object.entries(PLACEHOLDER_SOURCES)) {
  const expression = replaceTargets.get(token)
  if (expression === undefined) continue
  if (!expression.includes(source)) {
    problems.push('占位符 ' + token + ' 的替换目标里没有 ' + source + ', 与绑定不一致: ' + expression.trim())
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
  const fileName = file.slice(TRANSLATION_DIR.length + 1, -'.ini'.length).replace(/^\.example_/, '')
  if (lang !== fileName) problems.push(file + ' 的 meta.lang 应为 ' + fileName + ', 实际 ' + String(lang))
  const name = parsed.entries.get('meta.name')
  if (name === undefined || name === '') problems.push(file + ' 的 meta.name 为空')
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
console.log('翻译一致性检查通过, 共 ' + String(baseKeys.size) + ' 个键, ' + String(FILES.length) + ' 个翻译文件')
