/*
 * 把 pnpm pack 生成的 tarball 移入 release/
 *
 * 两种调用方式:
 * 1. package.json 的 postpack 生命周期: pnpm pack 与 npm pack 完成打包后自动执行,
 *    此时 tarball 在仓库根目录, 本脚本负责把它移入 release/。
 * 2. pnpm run pack:release 的显式步骤: 带 --strict, 找不到 tarball 视为失败。
 *
 * 不带 --strict 时找不到 tarball 只提示并以 0 退出, 避免 pnpm publish 的
 * postpack 阶段因目录中本就没有 tarball 而中断。
 * 作者: JularDepick
 */

import fs from 'node:fs'
import path from 'node:path'

const strict = process.argv.includes('--strict')
const root = process.cwd()
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

/* 打包文件名: 作用域包把开头的 @ 与路径分隔符换成 - */
const base = `${pkg.name.replace(/^@/, '').replace('/', '-')}-${pkg.version}.tgz`
const source = path.join(root, base)
const targetDir = path.join(root, 'release')
const target = path.join(targetDir, base)

if (!fs.existsSync(source)) {
  const message = `pack-release: tarball not found in repository root: ${base}`
  if (strict) {
    console.error(message)
    process.exit(1)
  }
  console.log(message + ' (skipped)')
  process.exit(0)
}

fs.mkdirSync(targetDir, { recursive: true })
fs.rmSync(target, { force: true })
fs.renameSync(source, target)
console.log(`pack-release: ${base} -> release/${base}`)
