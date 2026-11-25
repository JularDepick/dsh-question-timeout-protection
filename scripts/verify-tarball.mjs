/*
 * 发布物自检: 核对 release/ 下 tarball 的边界与关键字段
 *
 * 只读脚本, 不依赖外部 tar 命令(受限环境里子进程可能被拒绝):
 * 用 node:zlib 解压后按 ustar 头逐块读出条目, 再取 package/package.json 与工作区清单比对。
 * 目的是拦住"发布物落后于源码"与"包内版本区间与工作区不一致"这两类只能靠人工发现的错包。
 * 作者: JularDepick
 */

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const root = process.cwd()
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const base = `${pkg.name.replace(/^@/, '').replace('/', '-')}-${pkg.version}.tgz`
const tarball = path.join(root, 'release', base)

/* 发布物应有的条目: 构建产物三件, 两份 README, 三份翻译, patch, 版权与许可, 包清单 */
const EXPECTED = [
  'package/COPYRIGHT',
  'package/LICENSE',
  'package/README.md',
  'package/README_en-US.md',
  'package/cordis.patch.yml',
  'package/dist/client.js',
  'package/dist/index.d.mts',
  'package/dist/index.mjs',
  'package/package.json',
  'package/src/translation/.example_zh-CN.ini',
  'package/src/translation/en-US.ini',
  'package/src/translation/zh-CN.ini',
]

/* 读 tar 的八进制数值字段 */
function octal(block, start, length) {
  const text = block.subarray(start, start + length).toString('utf8').replace(/\0.*$/, '').trim()
  if (text === '') return 0
  const value = Number.parseInt(text, 8)
  return Number.isFinite(value) ? value : 0
}

/* 解析 tar 归档: 返回条目名与文件内容 */
function readTar(buffer) {
  const entries = new Map()
  let offset = 0
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '')
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '')
    const full = prefix === '' ? name : prefix + '/' + name
    const size = octal(header, 124, 12)
    const type = String.fromCharCode(header[156] === 0 ? 48 : header[156])
    const start = offset + 512
    /* 长名字的 pax 头与全局头不带内容语义, 跳过即可 */
    if (type === '0' || type === '\0') entries.set(full, buffer.subarray(start, start + size))
    offset = start + Math.ceil(size / 512) * 512
  }
  return entries
}

if (!fs.existsSync(tarball)) {
  console.error(`verify-tarball: 未找到 ${path.relative(root, tarball)}, 先运行 pnpm run pack:release`)
  process.exit(1)
}

const entries = readTar(zlib.gunzipSync(fs.readFileSync(tarball)))
const problems = []

for (const name of EXPECTED) {
  if (!entries.has(name)) problems.push('缺少条目: ' + name)
}
for (const name of entries.keys()) {
  if (!EXPECTED.includes(name)) problems.push('多出条目: ' + name)
}

const packedRaw = entries.get('package/package.json')
if (packedRaw === undefined) {
  problems.push('包内没有 package.json, 无法核对版本与区间')
} else {
  const packed = JSON.parse(packedRaw.toString('utf8'))
  if (packed.version !== pkg.version) {
    problems.push(`包内 version 为 ${String(packed.version)}, 工作区为 ${String(pkg.version)}`)
  }
  if (packed.engines?.dsh !== pkg.engines?.dsh) {
    problems.push('包内 engines.dsh 与工作区不一致: ' + String(packed.engines?.dsh))
  }
  for (const [name, range] of Object.entries(pkg.peerDependencies ?? {})) {
    if (packed.peerDependencies?.[name] !== range) {
      problems.push(`包内 peer ${name} 与工作区不一致: ${String(packed.peerDependencies?.[name])}`)
    }
  }
  /* 生命周期脚本会被包管理器剥离, 这里只确认构建脚本没有跟着进包 */
  if (packed.scripts?.prepack !== undefined) problems.push('包内仍带 prepack 生命周期脚本')
}

if (problems.length > 0) {
  console.error('verify-tarball: 发布物自检未通过 (' + base + ')')
  for (const problem of problems) console.error('  - ' + problem)
  process.exit(1)
}
console.log('verify-tarball: 通过, ' + String(entries.size) + ' 个条目, 版本 ' + pkg.version)
