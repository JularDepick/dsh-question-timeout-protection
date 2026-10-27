/*
 * 客户端提问增强适配器
 *
 * 不接管宿主提问卡片的渲染, 只在其 DOM 上补齐插件要求的界面能力:
 * 卡片右上角的插件自绘倒计时与「无限等待」按钮、单选选项选中后的方形底色、
 * 工具调用行的提问标识气泡。超时后按兜底范围分流: 开启注入时经宿主官方晚回复
 * 通道按题提交草稿本身, 卡片随结算由宿主移除; 未开启注入时驱动宿主收起卡片,
 * 不做任何提交。草稿存在内存里, 由气泡弹出的锚定悬浮卡片只读查看。
 * 作者: JularDepick
 */

import { pick } from './locale'
import {
  ASK_REOPEN_LABELS,
  ASK_ROW_SELECTOR,
  BUBBLE_BUTTON_CLASS,
  BUBBLE_DRAFT_LABEL_EN,
  BUBBLE_DRAFT_LABEL_ZH,
  BUBBLE_STATE_ATTRIBUTE,
  BUBBLE_STATE_DRAFT,
  CARD_BUTTON_SELECTOR,
  CARD_OPTIONS_SELECTOR,
  HOST_WAIT_PATTERNS,
  INJECTION_TIMEOUT_MS,
  INJECTION_WATCH_MS,
  MAX_KEPT_DRAFTS,
  MAX_SESSION_SUBSCRIPTIONS,
  PAUSED_TEXT_PATTERNS,
  SCAN_DEBOUNCE_MS,
  SCAN_INTERVAL_MS,
  CARD_FOOTER_ACTIONS_SELECTOR,
  CARD_INPUT_SELECTOR,
  CARD_LOCKED_CLASS,
  CLOSE_PANEL_LABELS,
  COLLAPSE_CONTROL_LABELS,
  COUNTDOWN_ATTRIBUTE,
  COUNTDOWN_PATTERNS,
  COUNTDOWN_PAUSED_CLASS,
  COUNTDOWN_PAUSED_TEXT_EN,
  COUNTDOWN_PAUSED_TEXT_ZH,
  COUNTDOWN_STYLE_ID,
  COUNTDOWN_TEXT_EN,
  COUNTDOWN_TEXT_ZH,
  COUNTDOWN_WARNING_CLASS,
  DRAFT_CUSTOM_LABEL_EN,
  DRAFT_CUSTOM_LABEL_ZH,
  DRAFT_PANEL_CLOSE_EN,
  DRAFT_PANEL_CLOSE_ZH,
  DRAFT_PANEL_EMPTY_EN,
  DRAFT_PANEL_EMPTY_ZH,
  DRAFT_PANEL_ID,
  DRAFT_PANEL_MARGIN,
  DRAFT_PANEL_NOTE_EN,
  DRAFT_PANEL_NOTE_ZH,
  DRAFT_PANEL_OFFSET,
  DRAFT_PANEL_TITLE_EN,
  DRAFT_PANEL_TITLE_ZH,
  DRAFT_PANEL_UNANSWERED_EN,
  DRAFT_PANEL_UNANSWERED_ZH,
  DRAFT_SELECTED_LABEL_EN,
  DRAFT_SELECTED_LABEL_ZH,
  HEADER_ACTIONS_SELECTOR,
  HIDDEN_CONTROL_CLASS,
  HOST_DRAFT_STORAGE_PREFIX,
  INFINITE_BUTTON_CLASS,
  INFINITE_WAIT_LABEL_EN,
  INFINITE_WAIT_LABEL_ZH,
  SYNC_UNAVAILABLE_TEXT_EN,
  SYNC_UNAVAILABLE_TEXT_ZH,
  NEXT_QUESTION_TEXTS,
  PANEL_BUTTON_SELECTOR,
  QUESTION_CARD_KEY_PREFIX,
  QUESTION_CARD_SELECTOR,
  SKIP_QUESTION_TEXTS,
  SUBMIT_TEXTS,
  SYNC_PATH,
  SYNC_PORT,
  TAKE_TIME_TEXTS,
  TOOL_CALL_ID_ATTRIBUTE,
  TOOL_CALL_ID_SELECTOR,
  WAIT_STATUS_SELECTOR,
  injectsContext,
} from '../constants'
import type { FallbackMode } from '../constants'

/** 适配器需要的插件配置 */
export interface AdapterOptions {
  /** 进入警示态的剩余秒数 */
  warningSeconds: number
  /** 兜底范围 */
  fallback: FallbackMode
  /** 是否启用卡片增强 */
  cardEnhancements: boolean
  /** 是否启用「无限等待」 */
  infiniteWait: boolean
  /** 是否启用超时草稿兜底 */
  draftFallback: boolean
}

/** 配置来源, 每次读取都返回当前生效的选项 */
export interface AdapterOptionsSource {
  getOptions(): AdapterOptions
}

/** 一条晚回复答案 */
interface AnswerItem {
  id: string
  selected: string[]
  custom?: string
}

/** 会话提问投影中的一行 */
interface ProjectionRow {
  callId: string
  state: string
  questions: ReadonlyArray<QuestionMeta>
}

/** 投影里的题目元信息 */
interface QuestionMeta {
  id: string
  question?: string
  header?: string
}

/** 会话投影面 */
interface ProjectionFace {
  getSnapshot?: () => unknown
  subscribe?: (listener: () => void) => () => void
}

/** 客户端会话绑定 */
interface SessionBinding {
  session?: {
    projections?: {
      faceOf?: (name: string) => ProjectionFace | undefined
    }
  }
}

/** 晚回复调用结果(宿主 Remote 使用 { ok, value } 包裹) */
interface RemoteResult {
  ok?: boolean
  value?: boolean
}

/** 适配器使用的客户端最小上下文面 */
export interface AdapterContext {
  sessions?: { binding?: (sessionId: string) => SessionBinding | undefined }
  remote?: {
    userQuestions?: {
      answer?: (sessionId: string, callId: string, answer: { answers: AnswerItem[] }) => Promise<RemoteResult>
    }
  }
}

/** 提问卡片标识(key 形如 question:<sessionId>:<callId>) */
interface CardIdentity {
  sessionId: string
  callId: string
}

/** 卡片里当前的作答内容 */
/** 单题的草稿内容 */
interface DraftItem {
  selected: string[]
  custom: string
  skipped: boolean
}

/** 超时后保存在内存里的一次草稿, 按题分开 */
interface StoredDraft {
  sessionId: string
  callId: string
  questions: ReadonlyArray<QuestionMeta>
  items: DraftItem[]
}

/* 插件自绘控件的样式: 倒计时、无限等待按钮、提问气泡、锚定草稿悬浮卡片 */
const CARD_STYLE = `
@keyframes dqtp-countdown-blink {
  0%, 100% { color: #e5484d; opacity: 1; }
  50% { color: #e5484d; opacity: 0.35; }
}
[data-dqtp-countdown] {
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
  font-size: 12px;
  line-height: 24px;
  margin-right: 8px;
}
[data-dqtp-countdown].dqtp-countdown-warning {
  color: #e5484d !important;
  font-weight: 600;
  animation: dqtp-countdown-blink 1s ease-in-out infinite;
}
[data-dqtp-countdown].dqtp-countdown-paused {
  color: var(--dsw-alias-label-secondary);
}
.dqtp-host-control-hidden {
  display: none !important;
}
.dqtp-infinite-wait {
  flex-shrink: 0;
  white-space: nowrap;
  height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-secondary, rgba(0, 0, 0, 0.16));
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  line-height: 22px;
  cursor: pointer;
}
.dqtp-infinite-wait:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06));
}
.dqtp-question-bubble {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 10px;
  margin-left: 6px;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-secondary, rgba(0, 0, 0, 0.16));
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  line-height: 20px;
  white-space: nowrap;
  cursor: pointer;
  vertical-align: middle;
}
.dqtp-question-bubble[data-dqtp-bubble="draft"] {
  border-color: #e5484d;
  color: #e5484d;
  font-weight: 600;
}
[data-question-key] button[role="radio"][aria-checked="true"] > span:first-child {
  background: var(--dsw-alias-label-primary);
  color: var(--dsw-alias-label-primary-foreground);
}
.dqtp-card-locked {
  cursor: default;
}
#dqtp-draft-panel {
  position: fixed;
  z-index: 2147483000;
}
#dqtp-draft-panel .dqtp-draft-card {
  width: min(360px, calc(100vw - 24px));
  max-height: min(320px, calc(100vh - 32px));
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-secondary, rgba(0, 0, 0, 0.16));
  background: var(--dsw-alias-bg-elevated, #fff);
  color: var(--dsw-alias-label-primary, #111);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.2);
  font-size: 13px;
  line-height: 20px;
  text-align: left;
}
#dqtp-draft-panel .dqtp-draft-title {
  font-size: 13px;
  font-weight: 600;
}
#dqtp-draft-panel .dqtp-draft-note {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary, #666);
}
#dqtp-draft-panel .dqtp-draft-body {
  flex: 1;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 13px;
  line-height: 20px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--dsw-alias-bg-secondary, rgba(0, 0, 0, 0.04));
}
#dqtp-draft-panel .dqtp-draft-actions {
  display: flex;
  justify-content: flex-end;
}
#dqtp-draft-panel .dqtp-draft-close {
  height: 26px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-secondary, rgba(0, 0, 0, 0.16));
  background: transparent;
  color: inherit;
  font-size: 12px;
  cursor: pointer;
}
@media (prefers-reduced-motion: reduce) {
  [data-dqtp-countdown].dqtp-countdown-warning { animation: none; }
}
`

/* 从卡片 key 解析会话与调用标识 */
function parseCardKey(key: string | null): CardIdentity | undefined {
  if (key === null) return undefined
  if (!key.startsWith(QUESTION_CARD_KEY_PREFIX)) return undefined
  const rest = key.slice(QUESTION_CARD_KEY_PREFIX.length)
  const split = rest.lastIndexOf(':')
  if (split <= 0) return undefined
  return { sessionId: rest.slice(0, split), callId: rest.slice(split + 1) }
}

/* 按标识定位提问卡片 */
function findCard(identity: CardIdentity): HTMLElement | undefined {
  const key = QUESTION_CARD_KEY_PREFIX + identity.sessionId + ':' + identity.callId
  for (const element of Array.from(document.querySelectorAll(QUESTION_CARD_SELECTOR))) {
    if (!(element instanceof HTMLElement)) continue
    if (element.getAttribute('data-question-key') === key) return element
  }
  return undefined
}

/* 读取宿主倒计时文本中的剩余秒数 */
function parseRemainingSeconds(text: string): number | undefined {
  for (const pattern of COUNTDOWN_PATTERNS) {
    const matched = pattern.exec(text)
    if (matched !== null) return Number(matched[1])
  }
  return undefined
}

/* 注入样式,重复安装时跳过 */
function ensureStyle(): void {
  if (document.getElementById(COUNTDOWN_STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = COUNTDOWN_STYLE_ID
  style.textContent = CARD_STYLE
  document.head.appendChild(style)
}

/*
 * 读取卡片里已选的选项文案。
 * 用无障碍标签而不是节点文本: 选项按钮里同时含标号, 标题与说明, 文本会拼成一大段,
 * 而宿主持久化的 selected 用的正是这个标签, 两者必须一致才不会把说明当成选项。
 */
function readSelected(card: HTMLElement): string[] {
  const selected: string[] = []
  for (const button of Array.from(card.querySelectorAll('button[aria-checked="true"]'))) {
    const label = (button.getAttribute('aria-label') ?? '').trim()
    if (label !== '' && !selected.includes(label)) selected.push(label)
  }
  return selected
}

/* 读取卡片输入框里的自由文本, 优先取作答区里的输入框 */
function readCustom(card: HTMLElement): string {
  const scoped = card.querySelector(CARD_OPTIONS_SELECTOR + ' textarea')
  const field = scoped ?? card.querySelector(CARD_INPUT_SELECTOR)
  if (field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement) return field.value
  return ''
}

/* 单题空草稿 */
function emptyItem(): DraftItem {
  return { selected: [], custom: '', skipped: false }
}

/* 单题是否有可展示的内容 */
function hasItemContent(item: DraftItem): boolean {
  return item.selected.length > 0 || item.custom.trim() !== ''
}

/* 把单题内容拼成一段可读文本, 供只读悬浮卡片展示 */
function composeItem(item: DraftItem): string {
  const parts: string[] = []
  /* 标签是带占位符的模板, 选项之间以斜杠分隔, 与翻译规范里约定的连接符一致 */
  if (item.selected.length > 0)
    parts.push(pick(DRAFT_SELECTED_LABEL_ZH, DRAFT_SELECTED_LABEL_EN).replace('{items}', item.selected.join(' / ')))
  const custom = item.custom.trim()
  if (custom !== '') parts.push(pick(DRAFT_CUSTOM_LABEL_ZH, DRAFT_CUSTOM_LABEL_EN).replace('{text}', custom))
  return parts.join('\n\n')
}

/* 读取宿主分页文案里的题目序号与题数(形如 2 / 3) */
function readProgress(card: HTMLElement): { index: number; count: number } | undefined {
  const element = card.querySelector('[class*="_progress"]')
  const matched = /(\d+)\s*\/\s*(\d+)/.exec(element?.textContent ?? '')
  if (matched === null) return undefined
  const index = Number(matched[1]) - 1
  const count = Number(matched[2])
  if (!Number.isInteger(index) || index < 0 || !Number.isInteger(count) || count <= 0) return undefined
  return { index, count }
}

/*
 * 读取宿主持久化的分题草稿。
 * 宿主把未提交的草稿按会话写进 localStorage(键 dsh.user-questions.drafts.v1.session-<id>),
 * 内容是 { progressByRequest: { "question:<session>:<callId>": { index, drafts: [...] } } },
 * drafts 每项对应一题的 { selected, custom, skipped }。
 */
function readHostDrafts(identity: CardIdentity, count: number): DraftItem[] | undefined {
  try {
    const storage = window.localStorage
    const cacheKey = QUESTION_CARD_KEY_PREFIX + identity.sessionId + ':' + identity.callId
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i)
      if (key === null || !key.startsWith(HOST_DRAFT_STORAGE_PREFIX)) continue
      if (!key.includes(identity.sessionId)) continue
      const raw = storage.getItem(key)
      if (raw === null) continue
      const parsed = JSON.parse(raw) as { progressByRequest?: Record<string, { drafts?: unknown }> }
      const drafts = parsed.progressByRequest?.[cacheKey]?.drafts
      if (!Array.isArray(drafts) || drafts.length !== count) continue
      return drafts.map((entry) => {
        const value = (typeof entry === 'object' && entry !== null ? entry : {}) as {
          selected?: unknown
          custom?: unknown
          skipped?: unknown
        }
        return {
          selected: Array.isArray(value.selected)
            ? value.selected.filter((label): label is string => typeof label === 'string')
            : [],
          custom: typeof value.custom === 'string' ? value.custom : '',
          skipped: value.skipped === true,
        }
      })
    }
  } catch {
    /* 存储不可用时按缺失处理 */
  }
  return undefined
}

/* 宿主没有持久化记录时, 至少把卡片当前显示这一题的作答放到对应位置 */
function readLiveDrafts(card: HTMLElement | undefined, count: number): DraftItem[] {
  const items = Array.from({ length: count }, () => emptyItem())
  if (card === undefined) return items
  const progress = readProgress(card)
  if (progress === undefined || progress.index >= count) return items
  items[progress.index] = { selected: readSelected(card), custom: readCustom(card), skipped: false }
  return items
}

/*
 * 合并两批分题草稿: 默认前一批优先, 缺的用后一批补齐。
 * liveIndex 指向卡片当前显示的那一题, 该题一律以实时值为准 ——
 * 否则用户把手里的输入清空后, 旧值会被补回来并可能被当作草稿注入。
 */
function mergeDrafts(
  primary: DraftItem[] | undefined,
  fallback: DraftItem[] | undefined,
  count: number,
  liveIndex?: number,
): DraftItem[] {
  const merged: DraftItem[] = []
  for (let i = 0; i < count; i += 1) {
    const first = primary?.[i] ?? emptyItem()
    const second = fallback?.[i] ?? emptyItem()
    if (i === liveIndex) {
      /*
       * 当前显示的这一题以卡片实时值为准, 但卡片在超时后可能被宿主重渲染成空,
       * 所以实时值为空时仍要保留宿主持久化的内容, 不能把已选的选项丢掉。
       */
      const liveHasContent = second.selected.length > 0 || second.custom.trim() !== ''
      merged.push(liveHasContent
        ? { selected: [...second.selected], custom: second.custom, skipped: second.skipped }
        : { selected: [...first.selected], custom: first.custom, skipped: first.skipped })
      continue
    }
    merged.push({
      selected: [...(first.selected.length > 0 ? first.selected : second.selected)],
      custom: first.custom.trim() !== '' ? first.custom : second.custom,
      skipped: first.skipped && second.skipped,
    })
  }
  return merged
}

/** 宿主晚回复调用签名 */
type RemoteAnswer = (sessionId: string, callId: string, answer: { answers: AnswerItem[] }) => Promise<RemoteResult>

/*
 * 解析宿主晚回复通道。
 * 客户端上下文按服务声明可能只暴露 remote 或 remote.userQuestions, 未注入时直接读属性会抛错,
 * 因此先按属性读、再退回服务查找, 两条都失败就按缺失处理。
 */
/* 取提问投影面: 先按属性读, 未注入时退回 ctx.get, 两者都拿不到就返回 undefined */
function resolveProjectionFace(ctx: AdapterContext, sessionId: string): ProjectionFace | undefined {
  const pick = (sessions: unknown): ProjectionFace | undefined => {
    const binding = (sessions as { binding?: (id: string) => unknown } | undefined)?.binding?.(sessionId)
    const face = (binding as { session?: { projections?: { faceOf?: (key: string) => unknown } } } | undefined)?.session
      ?.projections?.faceOf?.('userQuestions')
    return typeof face === 'object' && face !== null ? (face as ProjectionFace) : undefined
  }
  try {
    const direct = pick((ctx as { sessions?: unknown }).sessions)
    if (direct !== undefined) return direct
  } catch {
    /* 未注入 sessions 时按缺失处理 */
  }
  try {
    const getter = (ctx as { get?: (name: string) => unknown }).get
    const sessions = typeof getter === 'function' ? getter.call(ctx, 'sessions') : undefined
    return pick(sessions)
  } catch {
    return undefined
  }
}

function resolveRemoteAnswer(ctx: AdapterContext): RemoteAnswer | undefined {
  try {
    const remote = (ctx as { remote?: { userQuestions?: { answer?: RemoteAnswer } } }).remote
    if (typeof remote?.userQuestions?.answer === 'function') return remote.userQuestions.answer.bind(remote.userQuestions)
  } catch {
    /* 未注入 remote 时按缺失处理 */
  }
  try {
    const getter = (ctx as { get?: (name: string) => unknown }).get
    if (typeof getter === 'function') {
      const direct = getter.call(ctx, 'remote.userQuestions') as { answer?: RemoteAnswer } | undefined
      if (typeof direct?.answer === 'function') return direct.answer.bind(direct)
      const remote = getter.call(ctx, 'remote') as { userQuestions?: { answer?: RemoteAnswer } } | undefined
      if (typeof remote?.userQuestions?.answer === 'function') return remote.userQuestions.answer.bind(remote.userQuestions)
    }
  } catch {
    /* 服务不可用时按缺失处理 */
  }
  return undefined
}

/*
 * 把各题的超时草稿按题结构化地送回模型: 每题带自己的已选与补充, 不附加任何整批说明文本,
 * 超时语义由工具的 pending 说明承担。宿主会把这条回复 steer 成一条用户消息。
 */
async function injectAnswer(
  ctx: AdapterContext,
  identity: CardIdentity,
  questions: ReadonlyArray<{ id: string }>,
  items: DraftItem[],
): Promise<boolean> {
  const answer = resolveRemoteAnswer(ctx)
  if (answer === undefined || questions.length === 0) return false
  const answers: AnswerItem[] = questions.map((question, index) => {
    const item = items[index] ?? emptyItem()
    const custom = item.custom.trim()
    return {
      id: question.id,
      selected: [...item.selected],
      ...(custom === '' ? {} : { custom }),
    }
  })
  const lastFilled = answers.reduce(
    (last, item, index) => (item.selected.length > 0 || (item.custom ?? '').trim() !== '' ? index : last),
    -1,
  )
  if (lastFilled < 0) return false
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    /*
     * 宿主侧偶尔会挂起, 这里加超时。超时要按失败处理: 超时后草稿并没有进入上下文,
     * 若当成成功就会把卡片收起, 用户看到的就是"草稿没有进入上下文"。
     */
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('injection timeout')), INJECTION_TIMEOUT_MS)
    })
    const result = await Promise.race([answer(identity.sessionId, identity.callId, { answers }), expired])
    if (result !== undefined && (result.ok === false || result.value === false)) {
      console.warn('[question-timeout-protection] 超时草稿注入被宿主拒绝', JSON.stringify(result))
      return false
    }
    return true
  } catch (error) {
    console.warn('[question-timeout-protection] 超时草稿注入失败', error)
    return false
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/*
 * 把「无限等待」的点击状态同步给服务端, 使工具到期后继续阻塞。
 * 失败必须让调用方知道: 通道不可达时无限等待无法生效, 不能静默按超时提交草稿。
 */
/*
 * 只认明确的成功应答: 宿主的单页应用兜底路由对未知路径也可能回 200 并给出页面,
 * 只看 response.ok 会把"没人接收"当成"已登记", 于是到期照样按超时提交草稿。
 */
function postInfiniteWait(url: string, callId: string): Promise<boolean> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ callId, infinite: true }),
  })
    .then(async (response) => {
      if (!response.ok) return false
      try {
        const payload = (await response.json()) as { ok?: unknown }
        return payload.ok === true
      } catch {
        return false
      }
    })
    .catch(() => false)
}

/*
 * 优先走与界面同源的路由: 同源既不需要 CORS, 也天然排除同名端口的第二个实例;
 * 只有宿主没有注册该路由时才回退到本机回环端口。
 */
async function reportInfiniteWait(identity: CardIdentity): Promise<boolean> {
  if (await postInfiniteWait(SYNC_PATH, identity.callId)) return true
  return postInfiniteWait('http://127.0.0.1:' + String(SYNC_PORT) + SYNC_PATH, identity.callId)
}

/**
 * 安装提问超时适配器。
 * @param ctx 客户端上下文
 * @param source 配置来源, 每次读取都取当前生效值
 * @returns 卸载函数
 */
export function installQuestionTimeoutAdapter(ctx: AdapterContext, source: AdapterOptionsSource): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {}
  ensureStyle()

  /* 已处理过超时流程的调用 */
  const handled = new Set<string>()
  /* 最近一次成功提交的时间, 用于观察宿主是否真的让该行离开等待 */
  const recentInjections = new Map<string, number>()
  /* 已超时的调用, 卡片一律锁定并收起 */
  const timedOut = new Set<string>()
  /* 超时时草稿为空的调用, 交还宿主原版超时路径, 插件不再改卡片与工具行 */
  const passive = new Set<string>()
  /* 「无限等待」上报失败的调用: 通道不可达时同样交还宿主, 绝不能按超时提交草稿 */
  const syncUnavailable = new Set<string>()
  /* 点击「无限等待」后冻结的剩余毫秒 */
  const paused = new Map<string, number>()
  /* 每个调用的截止时间, 按 callId 记, 卡片重渲染后延续 */
  const deadlines = new Map<string, number>()
  /* 超时草稿(内存), 键为 callId */
  const drafts = new Map<string, StoredDraft>()
  /* 每个调用最近一次的分题草稿, 卡片重渲染后仍可用 */
  const lastDrafts = new Map<string, DraftItem[]>()
  /* 会话提问投影订阅 */
  const subscriptions = new Map<string, () => void>()
  /* 已锁定过的卡片节点 */
  const lockedCards = new WeakSet<HTMLElement>()
  /* 已触发过收起的卡片节点, 避免重复点击宿主的关闭按钮 */
  const hiddenCards = new WeakSet<HTMLElement>()
  /* 正在提交超时草稿的调用, 提交期间先不隐藏卡片 */
  const submitting = new Set<string>()
  /* 投影已到达但卡片尚未挂载的调用, 等卡片出现再评估 */
  const deferred = new Map<string, ProjectionRow>()

  /* 所有登记过状态的 callId, 供结算后统一回收 */
  const knownCallIds = (): string[] => {
    const ids = new Set<string>()
    for (const id of handled) ids.add(id)
    for (const id of timedOut) ids.add(id)
    for (const id of passive) ids.add(id)
    for (const id of syncUnavailable) ids.add(id)
    for (const id of submitting) ids.add(id)
    for (const id of drafts.keys()) ids.add(id)
    for (const id of lastDrafts.keys()) ids.add(id)
    for (const id of deadlines.keys()) ids.add(id)
    for (const id of paused.keys()) ids.add(id)
    for (const id of deferred.keys()) ids.add(id)
    return [...ids]
  }

  /*
   * 回收一个已结算调用的瞬态, 避免长会话里无限累积。
   * 草稿快照要留下: 气泡按钮靠它展示只读悬浮卡片, 结算后就抹掉等于把入口一起删了。
   */
  const forgetCall = (callId: string): void => {
    handled.delete(callId)
    timedOut.delete(callId)
    passive.delete(callId)
    syncUnavailable.delete(callId)
    submitting.delete(callId)
    deadlines.delete(callId)
    paused.delete(callId)
    deferred.delete(callId)
  }

  /* 草稿快照只保留最近若干条, 防止长时间使用后无限增长 */
  const pruneDrafts = (): void => {
    while (drafts.size > MAX_KEPT_DRAFTS) {
      const oldest = drafts.keys().next()
      if (oldest.done) break
      drafts.delete(oldest.value)
    }
    while (lastDrafts.size > MAX_KEPT_DRAFTS) {
      const oldest = lastDrafts.keys().next()
      if (oldest.done) break
      lastDrafts.delete(oldest.value)
    }
  }
  /* 当前打开的只读草稿悬浮卡片 */
  let panel: HTMLElement | undefined
  /* 悬浮卡片锚定的气泡按钮 */
  let panelAnchor: HTMLElement | undefined

  /* 当前生效的插件配置 */
  const options = (): AdapterOptions => source.getOptions()

  /* 倒计时文案, 暂停态与运行态分开 */
  const countdownText = (remainingMs: number, isPaused: boolean): string => {
    const seconds = Math.max(0, Math.ceil(remainingMs / 1000))
    const template = isPaused
      ? pick(COUNTDOWN_PAUSED_TEXT_ZH, COUNTDOWN_PAUSED_TEXT_EN)
      : pick(COUNTDOWN_TEXT_ZH, COUNTDOWN_TEXT_EN)
    return template.replace('{seconds}', String(seconds))
  }

  /* 在卡片右上角确保插件自绘倒计时存在 */
  const ensureCountdown = (card: HTMLElement, key: string): HTMLElement | undefined => {
    const actions = card.querySelector(HEADER_ACTIONS_SELECTOR)
    if (!(actions instanceof HTMLElement)) return undefined
    const selector = '[' + COUNTDOWN_ATTRIBUTE + ']'
    const found = actions.querySelector(selector)
    if (found instanceof HTMLElement && found.getAttribute(COUNTDOWN_ATTRIBUTE) === key) return found
    if (found instanceof HTMLElement) found.remove()
    const element = document.createElement('span')
    element.setAttribute(COUNTDOWN_ATTRIBUTE, key)
    actions.insertBefore(element, actions.firstChild)
    return element
  }

  /* 在倒计时右侧确保「无限等待」按钮存在 */
  const ensureInfiniteButton = (card: HTMLElement, countdown: HTMLElement | undefined): HTMLElement | undefined => {
    const actions = card.querySelector(HEADER_ACTIONS_SELECTOR)
    if (!(actions instanceof HTMLElement)) return undefined
    const selector = 'button.' + INFINITE_BUTTON_CLASS
    const found = actions.querySelector(selector)
    if (found instanceof HTMLElement) return found
    const button = document.createElement('button')
    button.type = 'button'
    button.className = INFINITE_BUTTON_CLASS
    if (countdown !== undefined && countdown.parentElement === actions) {
      actions.insertBefore(button, countdown.nextSibling)
    } else {
      actions.insertBefore(button, actions.firstChild)
    }
    return button
  }

  /* 隐藏宿主自带的倒计时与等待状态文本, 由插件自绘 */
  const hideHostWaitStatus = (card: HTMLElement): void => {
    for (const element of Array.from(card.querySelectorAll(WAIT_STATUS_SELECTOR))) {
      if (element instanceof HTMLElement) element.classList.add(HIDDEN_CONTROL_CLASS)
    }
  }

  /* 隐藏宿主的收起/展开开关与「慢慢回答」按钮 */
  const hideHostControls = (card: HTMLElement): void => {
    for (const element of Array.from(card.querySelectorAll(CARD_BUTTON_SELECTOR))) {
      const label = element.getAttribute('aria-label') ?? element.getAttribute('title') ?? ''
      if (COLLAPSE_CONTROL_LABELS.includes(label)) {
        element.classList.add(HIDDEN_CONTROL_CLASS)
        continue
      }
      if (TAKE_TIME_TEXTS.includes(element.textContent?.trim() ?? '')) element.classList.add(HIDDEN_CONTROL_CLASS)
    }
  }

  /*
   * 记录被插件改过的禁用状态。
   * React 只在自己的 prop 变化时才重写 disabled, 插件直接置真后宿主不会替我们复位,
   * 因此还原时必须把原值写回去, 否则卸载或退回宿主路径后会留下点不动的死卡片。
   */
  const disabledOriginals = new WeakMap<HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement, boolean>()
  const disableControl = (element: HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement): void => {
    if (!disabledOriginals.has(element)) disabledOriginals.set(element, element.disabled)
    element.disabled = true
  }
  const restoreDisabled = (root: HTMLElement): void => {
    const controls = root.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement>(
      CARD_INPUT_SELECTOR + ', ' + CARD_BUTTON_SELECTOR,
    )
    for (const control of Array.from(controls)) {
      const previous = disabledOriginals.get(control)
      if (previous === undefined) continue
      control.disabled = previous
      disabledOriginals.delete(control)
    }
  }

  /* 超时后禁止继续在卡片里回答 */
  const lockCard = (card: HTMLElement): void => {
    if (lockedCards.has(card)) return
    lockedCards.add(card)
    card.classList.add(CARD_LOCKED_CLASS)
    for (const field of Array.from(card.querySelectorAll(CARD_INPUT_SELECTOR))) {
      if (field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement) disableControl(field)
    }
    for (const button of Array.from(card.querySelectorAll(CARD_BUTTON_SELECTOR))) {
      if (!(button instanceof HTMLButtonElement)) continue
      const text = button.textContent?.trim() ?? ''
      if (SUBMIT_TEXTS.includes(text) || NEXT_QUESTION_TEXTS.includes(text) || SKIP_QUESTION_TEXTS.includes(text)) {
        disableControl(button)
      }
    }
  }

  /*
   * 收起问答卡片: 先按宿主自带的关闭按钮触发它的 dismiss(仅撤下卡片, 请求仍存活),
   * 再加隐藏类兜底, 防止宿主重渲染把卡片带回界面。
   */
  const hideCard = (card: HTMLElement): void => {
    if (!hiddenCards.has(card)) {
      hiddenCards.add(card)
      for (const button of Array.from(card.querySelectorAll(CARD_BUTTON_SELECTOR))) {
        const label = (button.getAttribute('aria-label') ?? button.getAttribute('title') ?? '').trim()
        if (!CLOSE_PANEL_LABELS.includes(label)) continue
        button.click()
        break
      }
    }
    card.classList.add(HIDDEN_CONTROL_CLASS)
  }

  /*
   * 把卡片还原成宿主原样: 撤销插件加的隐藏类, 移除自绘倒计时与「无限等待」按钮。
   * 草稿为空时超时不接管, 宿主按 continued 原版继续显示并允许作答。
   */
  const restoreCard = (card: HTMLElement): void => {
    for (const element of Array.from(card.querySelectorAll('.' + HIDDEN_CONTROL_CLASS))) {
      element.classList.remove(HIDDEN_CONTROL_CLASS)
    }
    for (const element of Array.from(
      card.querySelectorAll('[' + COUNTDOWN_ATTRIBUTE + '], button.' + INFINITE_BUTTON_CLASS),
    )) {
      element.remove()
    }
    restoreDisabled(card)
    card.classList.remove(CARD_LOCKED_CLASS)
    lockedCards.delete(card)
    hiddenCards.delete(card)
  }

  /*
 * 按文案隐藏宿主的等待状态提示: 宿主可能把「会一直等你回答」「已继续工作, 仍可回答」
 * 渲染在类名不匹配的容器里, 只靠类名后缀会漏掉, 插件接管后必须一并藏起来。
 */
function hideHostWaitText(card: HTMLElement): void {
  for (const element of Array.from(card.querySelectorAll('span, div'))) {
    if (!(element instanceof HTMLElement)) continue
    if (element.hasAttribute(COUNTDOWN_ATTRIBUTE) || element.querySelector('button') !== null) continue
    const text = (element.textContent ?? '').trim()
    if (text === '' || text.length > 40) continue
    if (!HOST_WAIT_PATTERNS.some((pattern) => pattern.test(text))) continue
    element.classList.add(HIDDEN_CONTROL_CLASS)
  }
}

/* 装饰一张提问卡片: 倒计时、无限等待按钮、宿主控件隐藏、超时收起 */
  const decorateCard = (card: HTMLElement, identity: CardIdentity): void => {
    /* 草稿为空的超时不接管, 卡片保持宿主原样 */
    if (passive.has(identity.callId)) return
    /* 首次读到的剩余时长记为插件自己的截止时间 */
    if (!deadlines.has(identity.callId) && !paused.has(identity.callId)) {
      for (const element of Array.from(card.querySelectorAll(WAIT_STATUS_SELECTOR))) {
        if (!(element instanceof HTMLElement)) continue
        const statusText = element.textContent?.trim() ?? ''
        /*
         * 暂停态下的剩余秒数不是真实到期时间, 拿它当截止时间会让自绘倒计时从暂停值开始走,
         * 因此这里按暂停态处理, 不登记截止时间。
         */
        if (PAUSED_TEXT_PATTERNS.some((pattern) => pattern.test(statusText))) {
          paused.set(identity.callId, Date.now())
          break
        }
        const total = parseRemainingSeconds(statusText)
        if (total === undefined) continue
        deadlines.set(identity.callId, Date.now() + total * 1000)
        break
      }
    }
    const key = QUESTION_CARD_KEY_PREFIX + identity.sessionId + ':' + identity.callId
    const frozen = paused.get(identity.callId)
    const deadline = deadlines.get(identity.callId)
    /*
     * 只有正在进行的提问才挂倒计时与「无限等待」: 历史提问与已结算回答的只读卡片
     * 没有宿主等待状态, 也就拿不到截止时间, 这时把插件控件一律隐藏, 并把宿主原样还原
     * (含「已继续工作, 仍可回答」提示与收起/展开控件), 不要连带宿主文案一起藏掉。
     */
    const live = frozen !== undefined || deadline !== undefined
    if (!live) {
      restoreCard(card)
      if (timedOut.has(identity.callId) && !submitting.has(identity.callId)) {
        lockCard(card)
        hideCard(card)
      }
      return
    }
    hideHostWaitStatus(card)
    hideHostWaitText(card)
    hideHostControls(card)
    const countdown = ensureCountdown(card, key)
    if (countdown !== undefined) {
      let remainingMs: number | undefined
      if (frozen !== undefined) remainingMs = frozen
      else if (deadline !== undefined) remainingMs = Math.max(0, deadline - Date.now())
      if (syncUnavailable.has(identity.callId)) {
        /* 通道不可达时倒计时位置显示不可用提示, 不给人「已经无限等待」的错觉 */
        const text = pick(SYNC_UNAVAILABLE_TEXT_ZH, SYNC_UNAVAILABLE_TEXT_EN)
        if (countdown.textContent !== text) countdown.textContent = text
        countdown.classList.remove(HIDDEN_CONTROL_CLASS, COUNTDOWN_PAUSED_CLASS)
        countdown.classList.add(COUNTDOWN_WARNING_CLASS)
      } else if (remainingMs === undefined || timedOut.has(identity.callId)) {
        countdown.textContent = ''
        countdown.classList.add(HIDDEN_CONTROL_CLASS)
        countdown.classList.remove(COUNTDOWN_WARNING_CLASS, COUNTDOWN_PAUSED_CLASS)
      } else {
        const next = countdownText(remainingMs, frozen !== undefined)
        if (countdown.textContent !== next) countdown.textContent = next
        countdown.classList.remove(HIDDEN_CONTROL_CLASS)
        const seconds = Math.ceil(remainingMs / 1000)
        countdown.classList.toggle(
          COUNTDOWN_WARNING_CLASS,
          frozen === undefined && seconds <= options().warningSeconds,
        )
        countdown.classList.toggle(COUNTDOWN_PAUSED_CLASS, frozen !== undefined)
      }
    }

    const button = ensureInfiniteButton(card, countdown)
    if (button !== undefined) {
      const hidden =
        !options().infiniteWait ||
        timedOut.has(identity.callId) ||
        frozen !== undefined ||
        syncUnavailable.has(identity.callId)
      button.classList.toggle(HIDDEN_CONTROL_CLASS, hidden)
      const label = pick(INFINITE_WAIT_LABEL_ZH, INFINITE_WAIT_LABEL_EN)
      if (button.textContent !== label) button.textContent = label
    }

    /* 超时后锁定并收起卡片; 提交进行中先保留, 结算后由宿主移除 */
    if (timedOut.has(identity.callId) && !submitting.has(identity.callId)) {
      lockCard(card)
      hideCard(card)
    }
  }

  /* 点击「无限等待」: 冻结本次问答的倒计时, 直到用户提交为止 */
  const pauseCountdown = (card: HTMLElement, identity: CardIdentity): void => {
    if (paused.has(identity.callId)) return
    const deadline = deadlines.get(identity.callId)
    paused.set(identity.callId, deadline === undefined ? 0 : Math.max(0, deadline - Date.now()))
    /* 同步触发宿主自带的「慢慢回答」, 让宿主自己的定时器也停下 */
    for (const element of Array.from(card.querySelectorAll(CARD_BUTTON_SELECTOR))) {
      if (!TAKE_TIME_TEXTS.includes(element.textContent?.trim() ?? '')) continue
      element.click()
      break
    }
    decorateCard(card, identity)
    void reportInfiniteWait(identity).then((accepted) => {
      if (accepted) return
      /*
       * 通道不可达(端口占用, 双实例, 或通过别的机器访问 web)时无限等待根本无法生效,
       * 这里撤回冻结、把该调用交还宿主, 并在倒计时位置给出可见提示, 避免到期仍提交草稿。
       */
      paused.delete(identity.callId)
      syncUnavailable.add(identity.callId)
      console.warn('[question-timeout-protection] 「无限等待」状态上报失败, 本次问答改由宿主原版处理')
      const current = findCard(identity)
      if (current !== undefined) decorateCard(current, identity)
    })
  }

  /* 把悬浮卡片摆到气泡旁边: 优先下方, 放不下翻到上方, 水平居中并夹在视口内 */
  const placePanel = (root: HTMLElement, anchor: HTMLElement): void => {
    const card = root.firstElementChild
    if (!(card instanceof HTMLElement)) return
    const rect = anchor.getBoundingClientRect()
    const width = card.offsetWidth
    const height = card.offsetHeight
    const viewWidth = window.innerWidth
    const viewHeight = window.innerHeight
    let left = rect.left + rect.width / 2 - width / 2
    left = Math.max(DRAFT_PANEL_MARGIN, Math.min(left, viewWidth - width - DRAFT_PANEL_MARGIN))
    let top = rect.bottom + DRAFT_PANEL_OFFSET
    if (top + height > viewHeight - DRAFT_PANEL_MARGIN) {
      const above = rect.top - DRAFT_PANEL_OFFSET - height
      top = above >= DRAFT_PANEL_MARGIN ? above : Math.max(DRAFT_PANEL_MARGIN, viewHeight - height - DRAFT_PANEL_MARGIN)
    }
    root.style.left = String(Math.round(left)) + 'px'
    root.style.top = String(Math.round(top)) + 'px'
  }

  /*
   * 跟随锚点重新定位; 锚点被滚出视口或已从文档移除时直接收起悬浮卡片,
   * 避免卡片停在界面之外或指向已经不在视野里的气泡。
   */
  const repositionPanel = (): void => {
    if (panel === undefined || panelAnchor === undefined) return
    if (!panelAnchor.isConnected) {
      closeDraftPanel()
      return
    }
    const rect = panelAnchor.getBoundingClientRect()
    if (rect.bottom < 0 || rect.top > window.innerHeight) {
      closeDraftPanel()
      return
    }
    placePanel(panel, panelAnchor)
  }

  /* 关闭只读草稿悬浮卡片 */
  const closeDraftPanel = (): void => {
    if (panel === undefined) return
    panel.remove()
    panel = undefined
    panelAnchor = undefined
    window.removeEventListener('scroll', repositionPanel, true)
    window.removeEventListener('resize', repositionPanel)
    document.removeEventListener('keydown', onPanelKeyDown, true)
    document.removeEventListener('pointerdown', onPanelPointerDown, true)
  }

  /* Esc 关闭悬浮卡片 */
  function onPanelKeyDown(event: Event): void {
    if (!(event instanceof KeyboardEvent) || event.key !== 'Escape') return
    closeDraftPanel()
  }

  /* 点击卡片外部关闭悬浮卡片, 点气泡本身交给点击处理器做开关 */
  function onPanelPointerDown(event: Event): void {
    if (panel === undefined) return
    const target = event.target
    if (!(target instanceof Node)) return
    if (panel.contains(target)) return
    if (panelAnchor !== undefined && panelAnchor.contains(target)) return
    closeDraftPanel()
  }

  /* 打开只读草稿悬浮卡片: 只展示超时那一刻的内容, 不提供任何作答入口 */
  const openDraftPanel = (draft: StoredDraft, anchor: HTMLElement): void => {
    closeDraftPanel()
    const root = document.createElement('div')
    root.id = DRAFT_PANEL_ID
    const card = document.createElement('div')
    card.className = 'dqtp-draft-card'
    const title = document.createElement('div')
    title.className = 'dqtp-draft-title'
    title.textContent = pick(DRAFT_PANEL_TITLE_ZH, DRAFT_PANEL_TITLE_EN)
    const note = document.createElement('div')
    note.className = 'dqtp-draft-note'
    note.textContent = pick(DRAFT_PANEL_NOTE_ZH, DRAFT_PANEL_NOTE_EN)
    const body = document.createElement('div')
    body.className = 'dqtp-draft-body'
    const blocks = draft.questions.map((question, index) => {
      const item = draft.items[index] ?? emptyItem()
      const heading = (question.header ?? question.question ?? '').trim()
      const content = hasItemContent(item)
        ? composeItem(item)
        : pick(DRAFT_PANEL_UNANSWERED_ZH, DRAFT_PANEL_UNANSWERED_EN)
      return (heading === '' ? '' : heading + '\n') + content
    })
    body.textContent = blocks.length === 0 ? pick(DRAFT_PANEL_EMPTY_ZH, DRAFT_PANEL_EMPTY_EN) : blocks.join('\n\n')
    const actions = document.createElement('div')
    actions.className = 'dqtp-draft-actions'
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'dqtp-draft-close'
    close.textContent = pick(DRAFT_PANEL_CLOSE_ZH, DRAFT_PANEL_CLOSE_EN)
    close.addEventListener('click', closeDraftPanel)
    actions.appendChild(close)
    card.appendChild(title)
    card.appendChild(note)
    card.appendChild(body)
    card.appendChild(actions)
    root.appendChild(card)
    document.body.appendChild(root)
    panel = root
    panelAnchor = anchor
    placePanel(root, anchor)
    window.addEventListener('scroll', repositionPanel, true)
    window.addEventListener('resize', repositionPanel)
    document.addEventListener('keydown', onPanelKeyDown, true)
    document.addEventListener('pointerdown', onPanelPointerDown, true)
  }

  /* 从工具调用行向上取 callId */
  const resolveCallId = (row: HTMLElement): string | undefined => {
    const host = row.closest(TOOL_CALL_ID_SELECTOR)
    if (!(host instanceof HTMLElement)) return undefined
    const value = host.getAttribute(TOOL_CALL_ID_ATTRIBUTE)
    return value === null || value === '' ? undefined : value
  }

  /* 在提问工具调用行确保「提问标识气泡」存在 */
  const ensureBubble = (row: HTMLElement): HTMLElement | undefined => {
    const found = row.querySelector('button.' + BUBBLE_BUTTON_CLASS)
    if (found instanceof HTMLElement) return found
    const button = document.createElement('button')
    button.type = 'button'
    button.className = BUBBLE_BUTTON_CLASS
    const anchor = row.querySelector(PANEL_BUTTON_SELECTOR)
    if (anchor instanceof HTMLElement && anchor.parentElement !== null) {
      anchor.parentElement.insertBefore(button, anchor.nextSibling)
    } else {
      row.appendChild(button)
    }
    return button
  }

  /* 超时后隐藏宿主「回答」按钮, 去掉重新打开问答框的入口 */
  const hideHostReopen = (row: HTMLElement): void => {
    for (const button of Array.from(row.querySelectorAll(CARD_BUTTON_SELECTOR))) {
      if (button.classList.contains(BUBBLE_BUTTON_CLASS)) continue
      const label = (button.getAttribute('aria-label') ?? button.getAttribute('title') ?? '').trim()
      const text = (button.textContent ?? '').trim()
      if (ASK_REOPEN_LABELS.includes(label) || ASK_REOPEN_LABELS.includes(text)) {
        button.classList.add(HIDDEN_CONTROL_CLASS)
      }
    }
  }

  /*
   * 装饰一行提问工具调用: 只有记录了超时草稿才出现插件气泡, 未超时或已正常作答的行
   * 交给宿主自己的「回答 / 查看回答」入口, 避免两个功能重复的气泡并存。
   */
  const decorateRow = (row: HTMLElement): void => {
    const callId = resolveCallId(row)
    if (callId === undefined) return
    const button = ensureBubble(row)
    if (button === undefined) return
    /* 草稿为空的超时交还宿主, 插件气泡不出现, 宿主「回答」入口保持可见 */
    if (passive.has(callId)) {
      button.classList.add(HIDDEN_CONTROL_CLASS)
      return
    }
    const draft = drafts.get(callId)
    const hidden = draft === undefined
    button.classList.toggle(HIDDEN_CONTROL_CLASS, hidden)
    if (draft === undefined) {
      if (timedOut.has(callId)) hideHostReopen(row)
      return
    }
    const label = pick(BUBBLE_DRAFT_LABEL_ZH, BUBBLE_DRAFT_LABEL_EN)
    if (button.textContent !== label) button.textContent = label
    if (button.getAttribute(BUBBLE_STATE_ATTRIBUTE) !== BUBBLE_STATE_DRAFT)
      button.setAttribute(BUBBLE_STATE_ATTRIBUTE, BUBBLE_STATE_DRAFT)
    if (timedOut.has(callId)) hideHostReopen(row)
  }

  /* 超时后的统一收尾: 锁定并收起卡片, 不产生任何提交 */
  const closeCardAfterTimeout = (identity: CardIdentity): void => {
    const card = findCard(identity)
    if (card === undefined) return
    lockCard(card)
    hideCard(card)
  }

  /* 评估一行 continued 投影: 按题收集草稿, 按兜底范围提交或收起卡片 */
  const evaluateRow = (identity: CardIdentity, row: ProjectionRow): void => {
    const card = findCard(identity)
    /*
     * 已经提交过草稿的行: 观察窗口内等宿主结算, 不重复注入也不锁卡;
     * 超过窗口仍在等待说明回复被丢弃或没送到模型, 必须把卡片还给用户并留下日志。
     *
     * 这段必须排在"已处理"判定之前: 注入成功的调用同时也在已处理集合里,
     * 若先被已处理判定挡回去, 观察窗口就永远走不到, 卡片会一直被收起而用户看不到提示。
     */
    const injectedAt = recentInjections.get(row.callId)
    if (injectedAt !== undefined) {
      if (Date.now() - injectedAt < INJECTION_WATCH_MS) return
      recentInjections.delete(row.callId)
      handled.delete(row.callId)
      passive.add(row.callId)
      timedOut.delete(row.callId)
      if (card !== undefined) restoreCard(card)
      console.warn('[question-timeout-protection] 超时草稿提交后该提问仍在等待, 已恢复卡片交给用户处理')
      return
    }
    if (handled.has(row.callId)) return
    const stored = lastDrafts.get(row.callId)
    /* 卡片还没挂载也没有历史记录时先挂起, 等扫描到卡片再评估, 避免丢失卡里已填内容 */
    if (card === undefined && stored === undefined) {
      deferred.set(row.callId, row)
      return
    }
    handled.add(row.callId)
    deferred.delete(row.callId)
    const count = row.questions.length
    const liveIndex = card === undefined ? undefined : readProgress(card)?.index
    const items = mergeDrafts(readHostDrafts(identity, count) ?? stored, readLiveDrafts(card, count), count, liveIndex)
    lastDrafts.set(row.callId, items)
    const current = options()
    /*
     * 接管条件只有两条: 超时草稿兜底开启, 且草稿非空; 另外「无限等待」上报失败时让路,
     * 因为通道不可用还照常提交会违背用户意图。其余情形一律接管, 不让宿主把超时问题继续挂着。
     */
    /*
     * 只有两种情况可以退让: 兜底关闭, 或「无限等待」通道不可用。
     * 草稿非空就必须接管 —— 否则用户会看到宿主那句「已继续工作, 仍可回答」,
     * 等于超时了还把问题挂着, 与插件存在的意义相反。
     */
    const takeover =
      current.draftFallback && !syncUnavailable.has(row.callId) && items.some(hasItemContent)
    if (!takeover) {
      passive.add(row.callId)
      timedOut.delete(row.callId)
      drafts.delete(row.callId)
      if (card !== undefined) restoreCard(card)
      return
    }
    timedOut.add(row.callId)
    if (card !== undefined) lockCard(card)
    /* 走到这里说明已接管, 草稿兜底开关必然为真, 直接记快照即可 */
    drafts.set(row.callId, { sessionId: identity.sessionId, callId: row.callId, questions: row.questions, items })
    pruneDrafts()
    /* 注入开启且至少一题有内容时走宿主官方晚回复通道, 提交成功后卡片随结算被宿主移除 */
    const shouldInject = injectsContext(current.fallback)
    if (shouldInject) {
      submitting.add(row.callId)
      void injectAnswer(ctx, identity, row.questions, items)
        .then((accepted) => {
          submitting.delete(row.callId)
          if (accepted) {
            recentInjections.set(row.callId, Date.now())
            return
          }
          closeCardAfterTimeout(identity)
        })
        .catch(() => {
          submitting.delete(row.callId)
          closeCardAfterTimeout(identity)
        })
      return
    }
    closeCardAfterTimeout(identity)
  }

  /* 评估一个会话的提问投影 */
  const evaluateProjection = (sessionId: string, snapshot: unknown): void => {
    if (typeof snapshot !== 'object' || snapshot === null) return
    const active = (snapshot as { active?: unknown }).active
    if (!Array.isArray(active)) return
    /* 所有仍在 active 的行都保留状态, 只有真正离开 active 才算结算 */
    const live = new Set<string>()
    for (const row of active as ProjectionRow[]) {
      if (typeof row.callId !== 'string') continue
      live.add(row.callId)
      if (row.state !== 'continued') continue
      if (!Array.isArray(row.questions)) continue
      evaluateRow({ sessionId, callId: row.callId }, row)
    }
    /*
     * 该行一旦离开 active 就说明已经结算(无论是插件提交, 用户自己提交, 还是宿主处理),
     * 这里统一回收状态, 不再依赖"点了提交按钮"这一条路径。
     */
    for (const callId of knownCallIds()) {
      if (live.has(callId)) continue
      forgetCall(callId)
    }
  }

  /*
   * 订阅失败按会话去重告警, 避免每次扫描都刷一条同样的 warn;
   * 宿主若只给快照不给订阅, 就登记进轮询兜底, 否则投影停在 open 就再也不会触发超时分支。
   */
  const subscribeWarned = new Set<string>()
  const polledSessions = new Map<string, () => void>()
  /* 各会话最近一次在界面上出现的时间, 用于限制订阅数量 */
  const subscriptionSeen = new Map<string, number>()

  /* 为会话订阅提问投影 */
  const ensureSubscription = (sessionId: string): void => {
    if (subscriptions.has(sessionId) || polledSessions.has(sessionId)) return
    /*
     * 直接读 ctx.sessions 在未注入时会被框架抛错(cannot get property without inject),
     * 因此这里先读属性再退回 ctx.get, 缺该服务时只失去投影订阅而不是整个适配器。
     */
    const face = resolveProjectionFace(ctx, sessionId)
    if (face === undefined) {
      /*
       * 这条链路宿主侧任何一环改名都会让它返回 undefined, 而三条超时分支全靠它驱动,
       * 静默失效会让整个兜底能力凭空消失, 因此失败必须留下一条可追的日志。
       */
      if (!subscribeWarned.has(sessionId)) {
        subscribeWarned.add(sessionId)
        console.warn('[question-timeout-protection] 无法订阅提问投影, 该会话的超时兜底不会生效')
      }
      return
    }
    const evaluate = (): void => {
      evaluateProjection(sessionId, face.getSnapshot?.())
    }
    if (typeof face.subscribe !== 'function') {
      polledSessions.set(sessionId, evaluate)
      if (!subscribeWarned.has(sessionId)) {
        subscribeWarned.add(sessionId)
        console.warn('[question-timeout-protection] 提问投影不支持订阅, 改用轮询兜底')
      }
      evaluate()
      return
    }
    subscriptions.set(sessionId, face.subscribe(evaluate))
    subscriptionSeen.set(sessionId, Date.now())
    /* 页面里会不断打开新会话, 订阅只增不减会一直累积, 这里按最近出现时间淘汰最旧的一条 */
    while (subscriptions.size > MAX_SESSION_SUBSCRIPTIONS) {
      let oldestSession: string | undefined
      let oldestAt = Number.POSITIVE_INFINITY
      for (const [id, seenAt] of subscriptionSeen) {
        if (seenAt < oldestAt) {
          oldestAt = seenAt
          oldestSession = id
        }
      }
      if (oldestSession === undefined) break
      subscriptions.get(oldestSession)?.()
      subscriptions.delete(oldestSession)
      subscriptionSeen.delete(oldestSession)
    }
    evaluate()
  }

  /*
   * 委托监听插件自绘控件与提交按钮:
   * 宿主会在收起/展开时复用同一批按钮节点, 所以每次点击都按当时的类名与文案判定。
   */
  const onDocumentClick = (event: Event): void => {
    const target = event.target
    if (!(target instanceof Element)) return
    const button = target.closest(CARD_BUTTON_SELECTOR)
    if (!(button instanceof HTMLElement)) return

    if (button.classList.contains(INFINITE_BUTTON_CLASS)) {
      event.preventDefault()
      event.stopPropagation()
      const card = button.closest(QUESTION_CARD_SELECTOR)
      const identity = parseCardKey(card instanceof HTMLElement ? card.getAttribute('data-question-key') : null)
      if (card instanceof HTMLElement && identity !== undefined) pauseCountdown(card, identity)
      return
    }

    if (button.classList.contains(BUBBLE_BUTTON_CLASS)) {
      event.preventDefault()
      event.stopPropagation()
      const row = button.closest(ASK_ROW_SELECTOR)
      if (!(row instanceof HTMLElement)) return
      const callId = resolveCallId(row)
      if (callId === undefined) return
      const draft = drafts.get(callId)
      if (draft === undefined) return
      if (panel !== undefined && panelAnchor === button) closeDraftPanel()
      else openDraftPanel(draft, button)
      return
    }

    /* 用户提交后本次问答结束, 暂停状态随之解除 */
    if (button.closest(CARD_FOOTER_ACTIONS_SELECTOR) === null) return
    if (!SUBMIT_TEXTS.includes(button.textContent?.trim() ?? '')) return
    const card = button.closest(QUESTION_CARD_SELECTOR)
    const identity = parseCardKey(card instanceof HTMLElement ? card.getAttribute('data-question-key') : null)
    if (identity === undefined) return
    paused.delete(identity.callId)
    deadlines.delete(identity.callId)
    lastDrafts.delete(identity.callId)
  }
  document.addEventListener('click', onDocumentClick, true)

  /* 扫描受管卡片与提问工具行 */
  const scan = (): void => {
    for (const evaluate of polledSessions.values()) evaluate()
    for (const element of Array.from(document.querySelectorAll(QUESTION_CARD_SELECTOR))) {
      if (!(element instanceof HTMLElement)) continue
      const identity = parseCardKey(element.getAttribute('data-question-key'))
      if (identity === undefined) continue
      /* 超时兜底不依赖界面开关, 因此延迟评估必须在开关之外执行 */
      const pending = deferred.get(identity.callId)
      if (pending !== undefined) {
        deferred.delete(identity.callId)
        evaluateRow(identity, pending)
      }
      if (options().cardEnhancements) {
        const previous = lastDrafts.get(identity.callId)
        const progress = readProgress(element)
        const count = Math.max(progress?.count ?? 1, previous?.length ?? 1)
        /* 参数顺序必须与 evaluateRow 一致: 前者是更可信的来源, 后者只做兜底 */
        lastDrafts.set(identity.callId, mergeDrafts(previous, readLiveDrafts(element, count), count, progress?.index))
        decorateCard(element, identity)
      }
      subscriptionSeen.set(identity.sessionId, Date.now())
      ensureSubscription(identity.sessionId)
    }
    if (!options().cardEnhancements) return
    for (const row of Array.from(document.querySelectorAll(ASK_ROW_SELECTOR))) {
      if (row instanceof HTMLElement) decorateRow(row)
    }
    repositionPanel()
  }

  /*
   * 流式输出时 mutation 会按帧触发, 直接全量重扫代价过高:
   * 用一次 120ms 的延迟合并同一批变更, 定时扫描只作为兜底。
   */
  let scanTimer: number | undefined
  const scheduleScan = (): void => {
    if (scanTimer !== undefined) return
    scanTimer = window.setTimeout(() => {
      scanTimer = undefined
      scan()
    }, SCAN_DEBOUNCE_MS)
  }
  const observer = new MutationObserver(scheduleScan)
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  const timer = window.setInterval(scan, SCAN_INTERVAL_MS)
  scan()

  return () => {
    observer.disconnect()
    window.clearInterval(timer)
    if (scanTimer !== undefined) window.clearTimeout(scanTimer)
    document.removeEventListener('click', onDocumentClick, true)
    closeDraftPanel()
    for (const off of subscriptions.values()) off()
    subscriptions.clear()
    /* 卸载时把插件加过的东西全部撤掉, 不让隐藏类与自绘节点留在宿主界面上 */
    for (const element of Array.from(document.querySelectorAll(QUESTION_CARD_SELECTOR))) {
      if (element instanceof HTMLElement) restoreCard(element)
    }
    for (const element of Array.from(
      document.querySelectorAll(
        '[' + COUNTDOWN_ATTRIBUTE + '], button.' + INFINITE_BUTTON_CLASS + ', button.' + BUBBLE_BUTTON_CLASS,
      ),
    )) {
      element.remove()
    }
    for (const element of Array.from(document.querySelectorAll('.' + HIDDEN_CONTROL_CLASS))) {
      element.classList.remove(HIDDEN_CONTROL_CLASS)
    }
    document.getElementById(COUNTDOWN_STYLE_ID)?.remove()
    syncUnavailable.clear()
  }
}
