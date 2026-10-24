/*
 * 插件配置页
 *
 * 注册到插件详情页的配置插槽, 直接读写插件行的 volatile 配置字段。
 * 作者: JularDepick
 */

import { useEffect, useState } from 'react'
import { PLUGIN_NAME, SETTINGS_ENTRY_ID, SETTINGS_LOCALE, SETTINGS_SLOT } from '../constants'
import { clientText, SETTINGS_DICTIONARY } from './i18n'

/* 表单里的普通值(服务端已解析 volatile) */
interface SettingsValues {
  fallback: 'ui' | 'context' | 'both'
  warningSeconds: number
  timeoutSeconds: number
  cardEnhancements: boolean
  infiniteWait: boolean
  draftFallback: boolean
}

/* 配置表单快照的最小结构 */
interface FormSnapshot<T> {
  status: string
  value: T | undefined
}

/* 配置表单的最小接口 */
interface FormLike<T> {
  getSnapshot(): FormSnapshot<T>
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<boolean>
}

/* 配置表单服务的最小接口 */
interface FormsLike {
  get<T>(entryId: string): FormLike<T>
}

/* 文案服务的注册接口 */
interface LocaleLike {
  register(id: string, dictionaries: { zh: Record<string, string>; en: Record<string, string> }): () => void
}

/** 配置页的客户端上下文 */
export interface SettingsContext {
  slots?: {
    inject(name: string, register: () => (() => void) | Iterable<() => void>): (() => void) | undefined
    register(options: { name: string; key?: string; locale?: string }, component: (props: { view?: string }) => unknown): () => void
  }
  configForms?: FormsLike
  locale?: LocaleLike
}

/* 配置页注册的候选 key: 包名#行 id 与包名 */
const SETTINGS_KEYS: readonly string[] = [SETTINGS_ENTRY_ID, PLUGIN_NAME]

/* 配置表单页面 */
function SettingsPage({ forms }: { forms: FormsLike }): JSX.Element {
  const form = forms.get<Partial<SettingsValues>>(SETTINGS_ENTRY_ID)
  const [snapshot, setSnapshot] = useState<FormSnapshot<Partial<SettingsValues>>>(() => form.getSnapshot())
  useEffect(() => form.subscribe(() => setSnapshot(form.getSnapshot())), [form])
  const value = snapshot.value ?? {}
  const disabled = snapshot.status !== 'ready'

  const setField = (field: keyof SettingsValues, next: unknown): void => {
    void form.set(field, next).catch(() => {})
  }

  const fallbackOptions: ReadonlyArray<{ value: SettingsValues['fallback']; label: string }> = [
    { value: 'ui', label: clientText('fallbackUi') },
    { value: 'context', label: clientText('fallbackContext') },
    { value: 'both', label: clientText('fallbackBoth') },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 520 }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span>{clientText('fallbackLabel')}</span>
        <select
          disabled={disabled}
          value={String(value.fallback ?? 'ui')}
          onChange={(event) => setField('fallback', event.target.value)}
        >
          {fallbackOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span>{clientText('warningLabel')}</span>
        <input
          type="number"
          min={1}
          max={60}
          disabled={disabled}
          value={Number(value.warningSeconds ?? 5)}
          onChange={(event) => setField('warningSeconds', Number(event.target.value))}
        />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span>{clientText('timeoutLabel')}</span>
        <input
          type="number"
          min={1}
          max={2147483}
          disabled={disabled}
          value={Number(value.timeoutSeconds ?? 120)}
          onChange={(event) => setField('timeoutSeconds', Number(event.target.value))}
        />
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="checkbox"
          disabled={disabled}
          checked={value.cardEnhancements ?? true}
          onChange={(event) => setField('cardEnhancements', event.target.checked)}
        />
        <span>{clientText('cardEnhancementsLabel')}</span>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="checkbox"
          disabled={disabled}
          checked={value.infiniteWait ?? true}
          onChange={(event) => setField('infiniteWait', event.target.checked)}
        />
        <span>{clientText('infiniteWaitLabel')}</span>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="checkbox"
          disabled={disabled}
          checked={value.draftFallback ?? true}
          onChange={(event) => setField('draftFallback', event.target.checked)}
        />
        <span>{clientText('draftFallbackLabel')}</span>
      </label>
      {snapshot.status === 'unavailable' ? <span style={{ color: '#b42318' }}>{clientText('unavailable')}</span> : null}
    </div>
  )
}

/* 安全读取宿主服务: 未注入时属性访问可能抛错 */
function readService<T>(ctx: unknown, name: string): T | undefined {
  try {
    const getter = (ctx as { get?: (key: string) => unknown }).get
    if (typeof getter === 'function') {
      const value = getter.call(ctx, name)
      if (value !== undefined && value !== null) return value as T
    }
  } catch {
    /* 服务不可用时按缺失处理 */
  }
  try {
    const value = (ctx as Record<string, unknown>)[name]
    if (value !== undefined && value !== null) return value as T
  } catch {
    /* 服务不可用时按缺失处理 */
  }
  return undefined
}

/** 注册插件详情页里的配置页 */
export function registerSettingsPage(ctx: SettingsContext): () => void {
  const slots = readService<NonNullable<SettingsContext['slots']>>(ctx, 'slots')
  const forms = readService<NonNullable<SettingsContext['configForms']>>(ctx, 'configForms')
  if (slots === undefined || forms === undefined) return () => {}
  if (typeof slots.inject !== 'function' || typeof slots.register !== 'function') return () => {}
  const locale = readService<LocaleLike>(ctx, 'locale')
  const disposers: Array<() => void> = []
  try {
    if (locale !== undefined && typeof locale.register === 'function') {
      const off = locale.register(SETTINGS_LOCALE, SETTINGS_DICTIONARY)
      if (typeof off === 'function') disposers.push(off)
    }
  } catch {
    /* 文案注册失败不影响页面 */
  }
  try {
    const register = (): Iterable<() => void> =>
      SETTINGS_KEYS.map((key) =>
        slots.register(
          { name: SETTINGS_SLOT, key, locale: SETTINGS_LOCALE },
          (props) => (props.view === 'summary' ? clientText('settingsSummary') : <SettingsPage forms={forms} />),
        ),
      ).filter((off) => typeof off === 'function')
    const off = slots.inject(SETTINGS_SLOT, register)
    if (typeof off === 'function') disposers.push(off)
  } catch (error) {
    console.error('[question-timeout-protection] 配置页注册失败', error)
  }
  return () => {
    for (const dispose of disposers) dispose()
  }
}
