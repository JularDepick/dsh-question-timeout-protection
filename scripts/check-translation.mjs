#!/usr/bin/env node
/*
 * 翻译键集一致性检查
 *
 * 对比三份 ini 的 [translation] 键集, 以及与客户端配置页字典的键集是否一致,
 * 任何一处漂移都以非零退出, 便于在打包前拦截。
 * 作者: JularDepick
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const FILES = ['src/translation/zh-CN.ini', 'src/translation/en-US.ini', 'src/translation/.example_zh-CN.ini']

/* 解析 [translation] 节的键名 */
function keysOf(text) {
  const keys = new Set()
  let inSection = false
  for (const line of text.split(/\r?\n/)) {
    const section = line.match(/^\[([^\]]+)\]$/)
    if (section) {
      inSection = section[1] === 'translation'
      continue
    }
    if (!inSection) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    if (key !== '') keys.add(key)
  }
  return keys
}

const problems = []
const sets = FILES.map((file) => ({ file, keys: keysOf(readFileSync(join(ROOT, file), 'utf8')) }))
const [first, ...rest] = sets

for (const { file, keys } of rest) {
  for (const key of first.keys) if (!keys.has(key)) problems.push(file + ' 缺少键 ' + key)
  for (const key of keys) if (!first.keys.has(key)) problems.push(file + ' 多出键 ' + key)
}

/* 配置页字典的键必须与 ini 的 settings.* 一一对应 */
const i18nSource = readFileSync(join(ROOT, 'src/client/i18n.ts'), 'utf8')
const zhBlock = i18nSource.split('const ZH')[1]?.split('const EN')[0] ?? ''
const dictKeys = new Set([...zhBlock.matchAll(/^\s{2}([A-Za-z0-9_]+):/gm)].map((m) => m[1]))
const settingsKeys = new Set([...first.keys].filter((key) => key.startsWith('settings.')).map((key) => key.slice('settings.'.length)))
for (const key of dictKeys) if (!settingsKeys.has(key)) problems.push('src/client/i18n.ts 的 ' + key + ' 在 ini 里缺少对应键')
for (const key of settingsKeys) if (!dictKeys.has(key)) problems.push('ini 的 settings.' + key + ' 在配置页字典里缺少对应项')

if (problems.length > 0) {
  console.error('翻译键集不一致:')
  for (const problem of problems) console.error('  - ' + problem)
  process.exit(1)
}
console.log('翻译键集一致, 共 ' + String(first.keys.size) + ' 个键')
