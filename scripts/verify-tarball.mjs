/*
 * 发布物自检: 核对 release/ 下 tarball 的边界与关键字段
 *
 * 只读脚本, 不依赖外部 tar 命令(受限环境里子进程可能被拒绝):
 * 用 node:zlib 解压后按 ustar 头逐块读出条目, 再取 package/package.json 与工作区清单比对。
 * 目的是拦住"发布物落后于源码"与"包内版本区间与工作区不一致"这两类只能靠人工发现的错包。
 * 作者: JularDepick
 */

import crypto from 'node:crypto'
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

/*
 * --if-present: postpack 阶段用。
 * npm/pnpm publish 自己生成 tarball, 仓库根目录没有新包可搬, 这时不该阻断发布,
 * 只提示"本次没有新产物可校验"; 真正的门禁是 pack:release 里的不带开关调用。
 */
const ifPresent = process.argv.includes('--if-present')
if (!fs.existsSync(tarball)) {
  const message = `verify-tarball: 未找到 ${path.relative(root, tarball)}`
  if (ifPresent) {
    console.log(message + ' (本次没有新产物, 跳过)')
    process.exit(0)
  }
  console.error(message + ', 先运行 pnpm run pack:release')
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

/*
 * 包内三件产物必须与工作区同名文件逐字节一致:
 * 这拦得住"tarball 落后于当前 dist", 拦不住"dist 落后于源码" —— 后者由发布清单里
 * "先重建再打包"那一步保证, 因此这里只声称前者。
 */
for (const name of ['dist/client.js', 'dist/index.mjs', 'dist/index.d.mts']) {
  const packed = entries.get('package/' + name)
  const local = path.join(root, name)
  if (packed === undefined) {
    problems.push('包内缺少 ' + name)
    continue
  }
  if (!fs.existsSync(local)) {
    problems.push('工作区缺少 ' + name + ', 无法与包内产物比对')
    continue
  }
  const digest = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex')
  if (digest(packed) !== digest(fs.readFileSync(local))) {
    problems.push('包内 ' + name + ' 与工作区不一致, 产物可能没有按当前源码重建')
  }
}

/* -latest 别名与版本化 tarball 必须同内容: 有人会直接拿别名上传 */
const aliasName = pkg.name.replace(/^@/, '').replace('/', '-') + '-latest.tgz'
const alias = path.join(root, 'release', aliasName)
if (!fs.existsSync(alias)) {
  problems.push('缺少 -latest 别名副本: ' + aliasName)
} else {
  const digest = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex')
  if (digest(fs.readFileSync(alias)) !== digest(fs.readFileSync(tarball))) {
    problems.push('-latest 别名与版本化 tarball 内容不一致')
  }
}

if (problems.length > 0) {
  console.error('verify-tarball: 发布物自检未通过 (' + base + ')')
  for (const problem of problems) console.error('  - ' + problem)
  process.exit(1)
}
console.log('verify-tarball: 通过, ' + String(entries.size) + ' 个条目, 版本 ' + pkg.version)
