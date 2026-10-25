/*
 * 客户端提问增强适配器
 *
 * 不接管宿主提问卡片的渲染, 只在其 DOM 上补齐插件要求的三处界面能力:
 * 卡片右上角的插件自绘倒计时与「无限等待」按钮、单选选项选中后的方形底色、
 * 工具调用行的提问标识气泡。超时后把已选选项与已输入内容保存在内存里,
 * 按配置以正常问答提交的方式注入上下文, 并把草稿记入气泡供只读查看;
 * 已超时的提问不再提供继续回答的入口。
 * 作者: JularDepick
 */

import {
  ASK_ROW_SELECTOR,
  BUBBLE_BUTTON_CLASS,
  BUBBLE_DRAFT_LABEL_EN,
  BUBBLE_DRAFT_LABEL_ZH,
  BUBBLE_LABEL_EN,
  BUBBLE_LABEL_ZH,
  BUBBLE_STATE_ATTRIBUTE,
  BUBBLE_STATE_DRAFT,
  BUBBLE_STATE_OPEN,
  CARD_BUTTON_SELECTOR,
  CARD_FOOTER_ACTIONS_SELECTOR,
  CARD_INPUT_SELECTOR,
  CARD_LOCKED_CLASS,
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
  DRAFT_INJECTION_FOOTER,
  DRAFT_INJECTION_HEADER,
  DRAFT_PANEL_CLOSE_EN,
  DRAFT_PANEL_CLOSE_ZH,
  DRAFT_PANEL_EMPTY_EN,
  DRAFT_PANEL_EMPTY_ZH,
  DRAFT_PANEL_ID,
  DRAFT_PANEL_NOTE_EN,
  DRAFT_PANEL_NOTE_ZH,
  DRAFT_PANEL_TITLE_EN,
  DRAFT_PANEL_TITLE_ZH,
  DRAFT_SELECTED_LABEL_EN,
  DRAFT_SELECTED_LABEL_ZH,
  HEADER_ACTIONS_SELECTOR,
  HIDDEN_CONTROL_CLASS,
  INFINITE_BUTTON_CLASS,
  INFINITE_WAIT_LABEL_EN,
  INFINITE_WAIT_LABEL_ZH,
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
  questions: ReadonlyArray<{ id: string }>
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
interface CardAnswer {
  selected: string[]
  custom: string
}

/** 超时后保存在内存里的一次草稿 */
interface StoredDraft {
  sessionId: string
  callId: string
  selected: string[]
  custom: string
  questions: ReadonlyArray<{ id: string }>
}

/* 插件自绘控件的样式: 倒计时、无限等待按钮、提问气泡、只读草稿面板 */
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
  inset: 0;
  z-index: 2147483000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.32);
}
#dqtp-draft-panel .dqtp-draft-card {
  width: min(680px, calc(100vw - 32px));
  max-height: min(70vh, 560px);
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px 20px;
  border-radius: 12px;
  background: var(--dsw-alias-bg-elevated, #fff);
  color: var(--dsw-alias-label-primary, #111);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.24);
}
#dqtp-draft-panel .dqtp-draft-title {
  font-size: 14px;
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
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--dsw-alias-bg-secondary, rgba(0, 0, 0, 0.04));
}
#dqtp-draft-panel .dqtp-draft-close {
  align-self: flex-end;
  height: 28px;
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

/* 界面语言是否中文, 用于写插件自绘控件的文案 */
function uiUsesChinese(): boolean {
  const lang =
    (typeof document === 'undefined' ? '' : document.documentElement.lang) ||
    (typeof navigator === 'undefined' ? '' : navigator.language)
  return lang.toLowerCase().startsWith('zh')
}

/* 按界面语言取中英文之一 */
function pick(zh: string, en: string): string {
  return uiUsesChinese() ? zh : en
}

/* 注入样式,重复安装时跳过 */
function ensureStyle(): void {
  if (document.getElementById(COUNTDOWN_STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = COUNTDOWN_STYLE_ID
  style.textContent = CARD_STYLE
  document.head.appendChild(style)
}

/* 读取卡片里已选的选项文案 */
function readSelected(card: HTMLElement): string[] {
  const selected: string[] = []
  for (const button of Array.from(card.querySelectorAll('button[aria-checked="true"]'))) {
    const label = (button.getAttribute('aria-label') ?? '').trim()
    if (label !== '' && !selected.includes(label)) selected.push(label)
  }
  return selected
}

/* 读取卡片输入框里的自由文本 */
function readCustom(card: HTMLElement): string {
  const field = card.querySelector(CARD_INPUT_SELECTOR)
  if (field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement) return field.value
  return ''
}

/* 读取卡片里当前的作答内容 */
function readAnswer(card: HTMLElement): CardAnswer {
  return { selected: readSelected(card), custom: readCustom(card) }
}

/* 是否存在可记录的内容 */
function hasAnswer(answer: CardAnswer): boolean {
  return answer.selected.length > 0 || answer.custom.trim() !== ''
}

/* 把作答内容拼成一段可读文本, 供草稿气泡与上下文注入共用 */
function composeBody(answer: { selected: readonly string[]; custom: string }): string {
  const parts: string[] = []
  if (answer.selected.length > 0)
    parts.push(pick(DRAFT_SELECTED_LABEL_ZH, DRAFT_SELECTED_LABEL_EN) + answer.selected.join(' / '))
  const custom = answer.custom.trim()
  if (custom !== '') parts.push(pick(DRAFT_CUSTOM_LABEL_ZH, DRAFT_CUSTOM_LABEL_EN) + custom)
  return parts.join('\n\n')
}

/* 把超时草稿经宿主官方通道送回模型: 它会把回复 steer 成一条用户消息 */
async function injectAnswer(
  ctx: AdapterContext,
  identity: CardIdentity,
  questions: ReadonlyArray<{ id: string }>,
  body: string,
): Promise<boolean> {
  const answer = ctx.remote?.userQuestions?.answer
  if (answer === undefined || questions.length === 0) return false
  const message = DRAFT_INJECTION_HEADER + '\n\n' + body + '\n\n' + DRAFT_INJECTION_FOOTER
  const answers: AnswerItem[] = questions.map((question, index) =>
    index === 0 ? { id: question.id, selected: [], custom: message } : { id: question.id, selected: [] },
  )
  try {
    await answer.call(ctx.remote?.userQuestions, identity.sessionId, identity.callId, { answers })
    return true
  } catch (error) {
    console.warn('[question-timeout-protection] 超时草稿注入失败', error)
    return false
  }
}

/* 把「无限等待」的点击状态同步给服务端, 使工具到期后继续阻塞 */
function reportInfiniteWait(identity: CardIdentity): void {
  void fetch('http://127.0.0.1:' + String(SYNC_PORT) + SYNC_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ callId: identity.callId, infinite: true }),
  }).catch(() => {})
}

/**
 * 安装提问超时适配器。
 * @param ctx 客户端上下文
 * @param options 插件配置
 * @returns 卸载函数
 */
export function installQuestionTimeoutAdapter(ctx: AdapterContext, options: AdapterOptions): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {}
  ensureStyle()

  /* 已处理过超时流程的调用 */
  const handled = new Set<string>()
  /* 已超时的调用, 卡片一律锁定 */
  const timedOut = new Set<string>()
  /* 点击「无限等待」后冻结的剩余毫秒 */
  const paused = new Map<string, number>()
  /* 每个调用的截止时间, 按 callId 记, 卡片重渲染后延续 */
  const deadlines = new Map<string, number>()
  /* 超时草稿(内存), 键为 callId */
  const drafts = new Map<string, StoredDraft>()
  /* 每个调用最近一次填写内容, 卡片重渲染后仍可用 */
  const lastAnswers = new Map<string, CardAnswer>()
  /* 会话提问投影订阅 */
  const subscriptions = new Map<string, () => void>()
  /* 已锁定过的卡片节点 */
  const lockedCards = new WeakSet<HTMLElement>()
  /* 当前打开的只读草稿面板 */
  let panel: HTMLElement | undefined

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

  /* 超时后禁止继续在卡片里回答 */
  const lockCard = (card: HTMLElement): void => {
    if (lockedCards.has(card)) return
    lockedCards.add(card)
    card.classList.add(CARD_LOCKED_CLASS)
    for (const field of Array.from(card.querySelectorAll(CARD_INPUT_SELECTOR))) {
      if (field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement) field.disabled = true
    }
    for (const button of Array.from(card.querySelectorAll(CARD_BUTTON_SELECTOR))) {
      const text = button.textContent?.trim() ?? ''
      if (SUBMIT_TEXTS.includes(text) || NEXT_QUESTION_TEXTS.includes(text) || SKIP_QUESTION_TEXTS.includes(text)) {
        button.disabled = true
      }
    }
  }

  /* 装饰一张提问卡片: 倒计时、无限等待按钮、宿主控件隐藏、超时锁定 */
  const decorateCard = (card: HTMLElement, identity: CardIdentity): void => {
    /* 首次读到的剩余时长记为插件自己的截止时间 */
    if (!deadlines.has(identity.callId) && !paused.has(identity.callId)) {
      for (const element of Array.from(card.querySelectorAll(WAIT_STATUS_SELECTOR))) {
        if (!(element instanceof HTMLElement)) continue
        const total = parseRemainingSeconds(element.textContent?.trim() ?? '')
        if (total === undefined) continue
        deadlines.set(identity.callId, Date.now() + total * 1000)
        break
      }
    }
    hideHostWaitStatus(card)
    hideHostControls(card)

    const key = QUESTION_CARD_KEY_PREFIX + identity.sessionId + ':' + identity.callId
    const countdown = ensureCountdown(card, key)
    const frozen = paused.get(identity.callId)
    const deadline = deadlines.get(identity.callId)
    if (countdown !== undefined) {
      let remainingMs: number | undefined
      if (frozen !== undefined) remainingMs = frozen
      else if (deadline !== undefined) remainingMs = Math.max(0, deadline - Date.now())
      if (remainingMs === undefined || timedOut.has(identity.callId)) {
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
          frozen === undefined && seconds <= options.warningSeconds,
        )
        countdown.classList.toggle(COUNTDOWN_PAUSED_CLASS, frozen !== undefined)
      }
    }

    const button = ensureInfiniteButton(card, countdown)
    if (button !== undefined) {
      const hidden = !options.infiniteWait || timedOut.has(identity.callId) || frozen !== undefined
      button.classList.toggle(HIDDEN_CONTROL_CLASS, hidden)
      const label = pick(INFINITE_WAIT_LABEL_ZH, INFINITE_WAIT_LABEL_EN)
      if (button.textContent !== label) button.textContent = label
    }

    if (timedOut.has(identity.callId)) lockCard(card)
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
    reportInfiniteWait(identity)
    decorateCard(card, identity)
  }

  /* 关闭只读草稿面板 */
  const closeDraftPanel = (): void => {
    if (panel === undefined) return
    panel.remove()
    panel = undefined
  }

  /* 打开只读草稿面板: 只展示超时那一刻的内容, 不提供任何作答入口 */
  const openDraftPanel = (draft: StoredDraft): void => {
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
    const composed = composeBody(draft)
    body.textContent = composed === '' ? pick(DRAFT_PANEL_EMPTY_ZH, DRAFT_PANEL_EMPTY_EN) : composed
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'dqtp-draft-close'
    close.textContent = pick(DRAFT_PANEL_CLOSE_ZH, DRAFT_PANEL_CLOSE_EN)
    close.addEventListener('click', closeDraftPanel)
    card.appendChild(title)
    card.appendChild(note)
    card.appendChild(body)
    card.appendChild(close)
    root.appendChild(card)
    root.addEventListener('click', (event) => {
      if (event.target === root) closeDraftPanel()
    })
    document.body.appendChild(root)
    panel = root
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
    button.setAttribute(BUBBLE_STATE_ATTRIBUTE, BUBBLE_STATE_OPEN)
    const anchor = row.querySelector(PANEL_BUTTON_SELECTOR)
    if (anchor instanceof HTMLElement && anchor.parentElement !== null) {
      anchor.parentElement.insertBefore(button, anchor.nextSibling)
    } else {
      row.appendChild(button)
    }
    return button
  }

  /* 装饰一行提问工具调用: 气泡文案随是否记录到草稿切换 */
  const decorateRow = (row: HTMLElement): void => {
    const callId = resolveCallId(row)
    if (callId === undefined) return
    const button = ensureBubble(row)
    if (button === undefined) return
    const draft = drafts.get(callId)
    const label =
      draft === undefined ? pick(BUBBLE_LABEL_ZH, BUBBLE_LABEL_EN) : pick(BUBBLE_DRAFT_LABEL_ZH, BUBBLE_DRAFT_LABEL_EN)
    if (button.textContent !== label) button.textContent = label
    const state = draft === undefined ? BUBBLE_STATE_OPEN : BUBBLE_STATE_DRAFT
    if (button.getAttribute(BUBBLE_STATE_ATTRIBUTE) !== state) button.setAttribute(BUBBLE_STATE_ATTRIBUTE, state)
  }

  /* 评估一行 continued 投影: 记录草稿、锁定卡片, 按配置注入上下文 */
  const evaluateRow = (identity: CardIdentity, row: ProjectionRow): void => {
    if (handled.has(row.callId)) return
    handled.add(row.callId)
    timedOut.add(row.callId)
    const card = findCard(identity)
    if (card !== undefined) lockCard(card)
    if (!options.draftFallback) return
    const answer =
      (card === undefined ? undefined : readAnswer(card)) ?? lastAnswers.get(row.callId) ?? { selected: [], custom: '' }
    drafts.set(row.callId, {
      sessionId: identity.sessionId,
      callId: row.callId,
      selected: answer.selected,
      custom: answer.custom,
      questions: row.questions,
    })
    if (!injectsContext(options.fallback) || !hasAnswer(answer)) return
    void injectAnswer(ctx, identity, row.questions, composeBody(answer))
  }

  /* 评估一个会话的提问投影 */
  const evaluateProjection = (sessionId: string, snapshot: unknown): void => {
    if (typeof snapshot !== 'object' || snapshot === null) return
    const active = (snapshot as { active?: unknown }).active
    if (!Array.isArray(active)) return
    for (const row of active as ProjectionRow[]) {
      if (row.state !== 'continued' || typeof row.callId !== 'string') continue
      if (!Array.isArray(row.questions)) continue
      evaluateRow({ sessionId, callId: row.callId }, row)
    }
  }

  /* 为会话订阅提问投影 */
  const ensureSubscription = (sessionId: string): void => {
    if (subscriptions.has(sessionId)) return
    const face = ctx.sessions?.binding?.(sessionId)?.session?.projections?.faceOf?.('userQuestions')
    if (face === undefined) return
    const evaluate = (): void => {
      evaluateProjection(sessionId, face.getSnapshot?.())
    }
    const off = face.subscribe?.(evaluate) ?? (() => {})
    subscriptions.set(sessionId, off)
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
      if (draft !== undefined) {
        openDraftPanel(draft)
        return
      }
      const anchor = row.querySelector(PANEL_BUTTON_SELECTOR)
      if (anchor instanceof HTMLElement) anchor.click()
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
    lastAnswers.delete(identity.callId)
  }
  document.addEventListener('click', onDocumentClick, true)

  /* 扫描受管卡片与提问工具行 */
  const scan = (): void => {
    for (const element of Array.from(document.querySelectorAll(QUESTION_CARD_SELECTOR))) {
      if (!(element instanceof HTMLElement)) continue
      const identity = parseCardKey(element.getAttribute('data-question-key'))
      if (identity === undefined) continue
      if (options.cardEnhancements) {
        const answer = readAnswer(element)
        if (hasAnswer(answer)) lastAnswers.set(identity.callId, answer)
        decorateCard(element, identity)
      }
      ensureSubscription(identity.sessionId)
    }
    if (!options.cardEnhancements) return
    for (const row of Array.from(document.querySelectorAll(ASK_ROW_SELECTOR))) {
      if (row instanceof HTMLElement) decorateRow(row)
    }
  }

  const observer = new MutationObserver(scan)
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  const timer = window.setInterval(scan, 1000)
  scan()

  return () => {
    observer.disconnect()
    window.clearInterval(timer)
    document.removeEventListener('click', onDocumentClick, true)
    closeDraftPanel()
    for (const off of subscriptions.values()) off()
    subscriptions.clear()
  }
}
