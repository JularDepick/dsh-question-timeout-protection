/*
 * volatile 配置取值
 *
 * 单独成文件, 避免客户端半身因导入 config.ts 而把 schemastery 打进客户端产物;
 * 客户端平台模块表不含 schemastery。
 * 作者: JularDepick
 */

import type { Volatile } from '@deepseek-ai/cordis'

/** 读取 volatile 字段的当前值, 兼容普通值 */
export function configValue<T>(value: Volatile<T> | T | undefined): T | undefined {
  if (typeof value === 'object' && value !== null && 'get' in value) return (value as { get: () => T }).get()
  return value
}
