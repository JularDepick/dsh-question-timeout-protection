/*
 * 插件配置页
 *
 * 注册在插件级配置插槽(plugins.bundle.config), 显示在插件详情页顶部, 不在「包含的组件」的行里。
 * 唯一可配置项是「注入到上下文」, 勾选变化即写入宿主配置, 不需要保存与重置;
 * 其余能力随插件启用状态固定生效, 只做展示。
 * 作者: JularDepick
 */

import { useEffect, useState } from 'react'
import { DEFAULT_FALLBACK_MODE, PLUGIN_NAME, SETTINGS_LOCALE, SETTINGS_NAMESPACE, SETTINGS_SLOT } from '../constants'
import { clientText, SETTINGS_DICTIONARY } from './i18n'
import type { ClientTextKey } from './i18n'

/* 表单里的普通值(服务端已解析 volatile) */
export interface SettingsValues {
  fallback: 'ui' | 'context' | 'both'
  warningSeconds?: number
  cardEnhancements: boolean
  infiniteWait: boolean
  draftFallback: boolean
}

/* 宿主配置表单的快照 */
export interface ConfigSnapshot {
  status: 'loading' | 'ready' | 'unavailable'
  value?: Partial<SettingsValues>
  revision?: number
  writable?: boolean
}

/* 宿主的原子写操作 */
interface ConfigOperation {
  op: 'set' | 'unset'
  path: string[]
  value?: unknown
}

/* 宿主某设置命名空间的配置表单 */
export interface ConfigFormLike {
  getSnapshot(): ConfigSnapshot
  subscribe(listener: () => void): () => void
  mutate(operations: ConfigOperation[], expectedRevision?: number): Promise<boolean>
}

/* 配置表单服务 */
export interface FormsLike {
  get(id: string): ConfigFormLike
}

/* 文案服务的注册接口 */
interface LocaleLike {
  register(id: string, dictionaries: { zh: Record<string, string>; en: Record<string, string> }): () => void
}

/* 配置插槽的组件属性 */
interface PageProps {
  view?: string
}

/** 配置页的客户端上下文 */
export interface SettingsContext {
  slots?: {
    inject(name: string, register: () => (() => void) | Iterable<() => void>): (() => void) | undefined
    register(options: { name: string; key?: string; locale?: string }, component: (props: PageProps) => unknown): () => void
  }
  configForms?: FormsLike
  locale?: LocaleLike
}

/* 快照未就绪时的占位 */
const PENDING: ConfigSnapshot = { status: 'loading', writable: false }

/* 样式只注入一次, 类名前缀固定为 dqtp- */
const STYLE_FLAG = 'dqtpSettings'
const SETTINGS_STYLE = `
.dqtp-form{display:flex;flex-direction:column;gap:14px;max-width:560px;font-size:13px;line-height:1.55;color:var(--dsw-alias-label-primary,#1f2328)}
.dqtp-card{border:1px solid var(--dsw-alias-border-secondary,rgba(127,127,127,.28));border-radius:12px;padding:2px 14px 6px}
.dqtp-card-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 10px;padding:11px 0 7px}
.dqtp-card-title{font-size:13px;font-weight:600}
.dqtp-card-note{font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280)}
.dqtp-option{display:flex;align-items:flex-start;gap:10px;padding:9px 0;cursor:pointer}
.dqtp-option input{flex:none;width:15px;height:15px;margin:2px 0 0;accent-color:var(--dsw-alias-brand-primary,#3b6cf0);cursor:pointer}
.dqtp-option-body{display:flex;flex-direction:column;gap:2px;min-width:0}
.dqtp-option-label{font-weight:500}
.dqtp-option-desc{font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280)}
.dqtp-fixed{display:flex;align-items:flex-start;gap:10px;padding:9px 0}
.dqtp-fixed + .dqtp-fixed,.dqtp-option + .dqtp-fixed,.dqtp-fixed + .dqtp-option{border-top:1px solid var(--dsw-alias-border-tertiary,rgba(127,127,127,.16))}
.dqtp-fixed-mark{flex:none;width:15px;font-size:12px;line-height:20px;text-align:center;color:var(--dsw-alias-label-secondary,#6b7280)}
.dqtp-fixed-label{font-weight:500;color:var(--dsw-alias-label-secondary,#4b5563)}
.dqtp-notice{font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280)}
.dqtp-problem{font-size:12px;color:var(--dsw-alias-label-danger,#c0392b)}
`

let styleInstalled = false

/* 首帧插入一次样式表 */
function ensureStyle(): void {
  if (styleInstalled || typeof document === 'undefined') return
  styleInstalled = true
  const style = document.createElement('style')
  style.dataset[STYLE_FLAG] = 'true'
  style.textContent = SETTINGS_STYLE
  document.head.append(style)
}

/* 固定特性的展示数据: 随插件启用状态生效, 页面不提供开关 */
const FIXED_ROWS: ReadonlyArray<{ label: ClientTextKey; desc: ClientTextKey }> = [
  { label: 'fixedKeepLabel', desc: 'fixedKeepDesc' },
  { label: 'cardEnhancementsLabel', desc: 'cardEnhancementsDesc' },
  { label: 'infiniteWaitLabel', desc: 'infiniteWaitDesc' },
  { label: 'draftFallbackLabel', desc: 'draftFallbackDesc' },
]

/* 是否注入到上下文; 界面保留草稿恒定开启, 因此只映射 ui / both */
function readInject(value: Partial<SettingsValues> | undefined): boolean {
  const mode = value?.fallback ?? DEFAULT_FALLBACK_MODE
  return mode === 'context' || mode === 'both'
}

/* 配置页内容 */
function SettingsPage({ host }: { host: SettingsContext }): JSX.Element {
  const forms = readClientService<FormsLike>(host, 'configForms')
  const [form, setForm] = useState<ConfigFormLike | undefined>(() => forms?.get(SETTINGS_NAMESPACE))
  const [snapshot, setSnapshot] = useState<ConfigSnapshot>(() => form?.getSnapshot() ?? PENDING)
  const [injectContext, setInjectContext] = useState<boolean>(() => readInject(snapshot.value))
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => ensureStyle(), [])

  /* 配置服务可能晚于插件就绪, 拿到服务后再取控制器 */
  useEffect(() => {
    if (form !== undefined || forms === undefined) return
    setForm(forms.get(SETTINGS_NAMESPACE))
  }, [form, forms])

  /* 跟随宿主快照 */
  useEffect(() => {
    if (form === undefined) return
    setSnapshot(form.getSnapshot())
    return form.subscribe(() => setSnapshot(form.getSnapshot()))
  }, [form])

  /* 宿主刷新快照时同步勾选, 写入进行中不覆盖用户操作 */
  useEffect(() => {
    if (busy) return
    setInjectContext(readInject(snapshot.value))
  }, [snapshot.revision, snapshot.status, busy])

  const ready = form !== undefined && snapshot.status === 'ready' && snapshot.writable !== false
  const disabled = !ready || busy

  /* 勾选变化即写入, 成功静默, 失败回滚并提示 */
  const toggle = (next: boolean): void => {
    if (form === undefined || !ready || busy) return
    setInjectContext(next)
    setBusy(true)
    setNotice('')
    void form
      .mutate([{ op: 'set', path: ['fallback'], value: next ? 'both' : 'ui' }], snapshot.revision)
      .then((accepted) => {
        if (!accepted) {
          setInjectContext(readInject(form.getSnapshot().value))
          setNotice(clientText('rejected'))
        }
      })
      .catch(() => {
        setInjectContext(readInject(form.getSnapshot().value))
        setNotice(clientText('rejected'))
      })
      .finally(() => setBusy(false))
  }

  return (
    <form className="dqtp-form" onSubmit={(event) => event.preventDefault()}>
      <section className="dqtp-card">
        <header className="dqtp-card-head">
          <span className="dqtp-card-title">{clientText('fallbackSection')}</span>
          <span className="dqtp-card-note">{clientText('fallbackNote')}</span>
        </header>
        <label className="dqtp-option">
          <input type="checkbox" disabled={disabled} checked={injectContext} onChange={(event) => toggle(event.target.checked)} />
          <span className="dqtp-option-body">
            <span className="dqtp-option-label">{clientText('injectLabel')}</span>
            <span className="dqtp-option-desc">{clientText('injectDesc')}</span>
          </span>
        </label>
      </section>
      <section className="dqtp-card">
        <header className="dqtp-card-head">
          <span className="dqtp-card-title">{clientText('fixedSection')}</span>
          <span className="dqtp-card-note">{clientText('fixedNote')}</span>
        </header>
        {FIXED_ROWS.map((row) => (
          <div key={row.label} className="dqtp-fixed">
            <span className="dqtp-fixed-mark">{'✓'}</span>
            <span className="dqtp-option-body">
              <span className="dqtp-fixed-label">{clientText(row.label)}</span>
              <span className="dqtp-option-desc">{clientText(row.desc)}</span>
            </span>
          </div>
        ))}
      </section>
      {notice === '' ? null : (
        <span className="dqtp-notice" role="status">
          {notice}
        </span>
      )}
      {ready || busy ? null : (
        <p className="dqtp-problem" role="status">
          {clientText(snapshot.status === 'loading' ? 'loading' : 'unavailable')}
        </p>
      )}
    </form>
  )
}

/* 安全读取宿主服务: 未注入时属性访问可能抛错 */
export function readClientService<T>(ctx: unknown, name: string): T | undefined {
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

/** 注册插件详情页顶部的配置区块 */
export function registerSettingsPage(ctx: SettingsContext): () => void {
  const slots = readClientService<NonNullable<SettingsContext['slots']>>(ctx, 'slots')
  if (slots === undefined || typeof slots.inject !== 'function' || typeof slots.register !== 'function') {
    console.error('[question-timeout-protection] 缺少插槽服务, 配置页未注册')
    return () => {}
  }
  const locale = readClientService<LocaleLike>(ctx, 'locale')
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
    /* 插件级配置插槽按包名作为 key, 与 dsh-ops 的注册范式一致 */
    const off = slots.inject(SETTINGS_SLOT, function* register() {
      yield slots.register({ name: SETTINGS_SLOT, key: PLUGIN_NAME, locale: SETTINGS_LOCALE }, (props) =>
        props.view === 'summary' ? clientText('settingsSummary') : <SettingsPage host={ctx} />,
      )
      console.info('[question-timeout-protection] 插件配置已注册', SETTINGS_SLOT, PLUGIN_NAME)
    })
    if (typeof off === 'function') disposers.push(off)
  } catch (error) {
    console.error('[question-timeout-protection] 配置页注册失败', error)
  }
  return () => {
    for (const dispose of disposers) dispose()
  }
}
