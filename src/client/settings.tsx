/*
 * 插件配置页
 *
 * 注册到插件详情页的行配置插槽(plugins.row.config), 页面本身不读取任何客户端配置服务,
 * 只渲染宿主经插槽下发的该行配置表单(props.form)。
 * 作者: JularDepick
 */

import { useEffect, useState } from 'react'
import { SETTINGS_ENTRY_ID, SETTINGS_LOCALE, SETTINGS_SLOT } from '../constants'
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

/* 宿主配置表单的快照 */
interface PageFormSnapshot {
  status: 'loading' | 'ready' | 'unavailable'
  value?: Partial<SettingsValues>
  revision?: number
  writable?: boolean
}

/* 宿主的原子写操作 */
interface PageOperation {
  op: 'set' | 'unset'
  path: string[]
  value?: unknown
}

/* 宿主经插槽下发的行配置表单 */
interface PageForm {
  readonly state: PageFormSnapshot
  mutate(operations: PageOperation[], expectedRevision?: number): Promise<boolean>
}

/* 行配置插槽的组件属性 */
interface PageProps {
  view?: string
  form?: PageForm
}

/* 文案服务的注册接口 */
interface LocaleLike {
  register(id: string, dictionaries: { zh: Record<string, string>; en: Record<string, string> }): () => void
}

/** 配置页的客户端上下文 */
export interface SettingsContext {
  slots?: {
    inject(name: string, register: () => (() => void) | Iterable<() => void>): (() => void) | undefined
    register(options: { name: string; key?: string; locale?: string }, component: (props: PageProps) => unknown): () => void
  }
  locale?: LocaleLike
}

/* 兜底范围下拉项 */
const FALLBACK_OPTIONS: ReadonlyArray<{ value: SettingsValues['fallback']; label: string }> = [
  { value: 'ui', label: clientText('fallbackUi') },
  { value: 'context', label: clientText('fallbackContext') },
  { value: 'both', label: clientText('fallbackBoth') },
]

const FIELD_STYLE = { display: 'flex', flexDirection: 'column', gap: 4 } as const
const SWITCH_STYLE = { display: 'flex', alignItems: 'center', gap: 8 } as const

/* 配置表单页面 */
function SettingsPage({ form }: PageProps): JSX.Element {
  const [draft, setDraft] = useState<Partial<SettingsValues>>(() => form?.state.value ?? {})
  const [revision, setRevision] = useState<number | undefined>(form?.state.revision)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  /* 宿主刷新快照时同步草稿, 正在编辑(dirty)时不覆盖用户输入 */
  useEffect(() => {
    if (dirty) return
    setDraft(form?.state.value ?? {})
    setRevision(form?.state.revision)
  }, [form?.state.value, form?.state.revision, dirty])

  const status = form?.state.status
  const ready = form !== undefined && status === 'ready' && form.state.writable !== false
  const disabled = !ready || busy

  const edit = (patch: Partial<SettingsValues>): void => {
    setDraft((current) => ({ ...current, ...patch }))
    setDirty(true)
    setNotice('')
  }

  const reset = (): void => {
    setDraft(form?.state.value ?? {})
    setRevision(form?.state.revision)
    setDirty(false)
    setNotice('')
  }

  const save = async (): Promise<void> => {
    if (form === undefined || !ready || busy || revision === undefined) return
    setBusy(true)
    setNotice('')
    try {
      const operations: PageOperation[] = [
        { op: 'set', path: ['fallback'], value: draft.fallback ?? 'ui' },
        { op: 'set', path: ['warningSeconds'], value: Number(draft.warningSeconds ?? 5) },
        { op: 'set', path: ['timeoutSeconds'], value: Number(draft.timeoutSeconds ?? 120) },
        { op: 'set', path: ['cardEnhancements'], value: draft.cardEnhancements ?? true },
        { op: 'set', path: ['infiniteWait'], value: draft.infiniteWait ?? true },
        { op: 'set', path: ['draftFallback'], value: draft.draftFallback ?? true },
      ]
      const accepted = await form.mutate(operations, revision)
      setNotice(clientText(accepted ? 'saved' : 'rejected'))
      if (accepted) setDirty(false)
    } catch {
      setNotice(clientText('rejected'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 520 }}
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <label style={FIELD_STYLE}>
        <span>{clientText('fallbackLabel')}</span>
        <select
          disabled={disabled}
          value={String(draft.fallback ?? 'ui')}
          onChange={(event) => edit({ fallback: event.target.value as SettingsValues['fallback'] })}
        >
          {FALLBACK_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label style={FIELD_STYLE}>
        <span>{clientText('warningLabel')}</span>
        <input
          type="number"
          min={1}
          max={60}
          disabled={disabled}
          value={Number(draft.warningSeconds ?? 5)}
          onChange={(event) => edit({ warningSeconds: Number(event.target.value) })}
        />
      </label>
      <label style={FIELD_STYLE}>
        <span>{clientText('timeoutLabel')}</span>
        <input
          type="number"
          min={1}
          max={2147483}
          disabled={disabled}
          value={Number(draft.timeoutSeconds ?? 120)}
          onChange={(event) => edit({ timeoutSeconds: Number(event.target.value) })}
        />
      </label>
      <label style={SWITCH_STYLE}>
        <input
          type="checkbox"
          disabled={disabled}
          checked={draft.cardEnhancements ?? true}
          onChange={(event) => edit({ cardEnhancements: event.target.checked })}
        />
        <span>{clientText('cardEnhancementsLabel')}</span>
      </label>
      <label style={SWITCH_STYLE}>
        <input
          type="checkbox"
          disabled={disabled}
          checked={draft.infiniteWait ?? true}
          onChange={(event) => edit({ infiniteWait: event.target.checked })}
        />
        <span>{clientText('infiniteWaitLabel')}</span>
      </label>
      <label style={SWITCH_STYLE}>
        <input
          type="checkbox"
          disabled={disabled}
          checked={draft.draftFallback ?? true}
          onChange={(event) => edit({ draftFallback: event.target.checked })}
        />
        <span>{clientText('draftFallbackLabel')}</span>
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button type="submit" disabled={disabled || !dirty}>
          {clientText(busy ? 'saving' : 'save')}
        </button>
        <button type="button" disabled={disabled || !dirty} onClick={reset}>
          {clientText('reset')}
        </button>
        {notice === '' ? null : <span role="status">{notice}</span>}
      </div>
      {ready || busy ? null : <span style={{ color: '#b42318' }}>{clientText(status === 'loading' ? 'loading' : 'unavailable')}</span>}
    </form>
  )
}

/* 行配置插槽的组件: 摘要只输出标题, 页面渲染表单 */
function renderRowConfig(props: PageProps): unknown {
  return props.view === 'summary' ? clientText('settingsSummary') : <SettingsPage form={props.form} />
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
  if (slots === undefined || typeof slots.inject !== 'function' || typeof slots.register !== 'function') {
    console.error('[question-timeout-protection] 缺少插槽服务, 配置页未注册')
    return () => {}
  }
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
    /* 与 dsh-ops 同一范式: 插槽声明后注册一条 key 为 包名#行 id 的条目 */
    const off = slots.inject(SETTINGS_SLOT, function* register() {
      yield slots.register({ name: SETTINGS_SLOT, key: SETTINGS_ENTRY_ID, locale: SETTINGS_LOCALE }, renderRowConfig)
      console.info('[question-timeout-protection] 行配置已注册', SETTINGS_ENTRY_ID)
    })
    if (typeof off === 'function') disposers.push(off)
  } catch (error) {
    console.error('[question-timeout-protection] 配置页注册失败', error)
  }
  return () => {
    for (const dispose of disposers) dispose()
  }
}
