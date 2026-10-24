/*
 * 客户端提问超时适配器
 *
 * 只增强宿主已有的提问卡片: 自己维护截止时间渲染倒计时、最后数秒红字闪烁、
 * 隐藏收起开关、把「慢慢回答」更名为「无限等待」、超时后锁定卡片。
 * 超时兜底走宿主官方通道 userQuestions.answer(把回复 steer 成一条用户消息),
 * 不自己渲染任何历史 UI —— 上下文展示交给原版工具返回值。
 * 作者: JularDepick
 */

import {
  CLOSE_PANEL_LABELS,
  COLLAPSE_CONTROL_LABELS,
  COUNTDOWN_PATTERNS,
  COUNTDOWN_STYLE_ID,
  COUNTDOWN_WARNING_CLASS,
  DRAFT_INJECTION_FOOTER,
  DRAFT_INJECTION_HEADER,
  HIDDEN_CONTROL_CLASS,
  NEXT_QUESTION_TEXTS,
  QUESTION_CARD_SELECTOR,
  SKIP_QUESTION_TEXTS,
  SUBMIT_TEXTS,
  SYNC_PATH,
  SYNC_PORT,
  TAKE_TIME_LABELS,
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

/** 卡片里已填写的答案 */
interface CardAnswer {
  /** 已选中的选项文案, 按出现顺序 */
  selected: string[]
  /** 自由输入框里的文本 */
  custom: string
}

/* 闪烁样式与选中标号的配色; 仅非动画偏好下启用动画 */
const WARNING_STYLE = `
@keyframes dqtp-countdown-blink {
  0%, 100% { color: #e5484d; opacity: 1; }
  50% { color: #e5484d; opacity: 0.35; }
}
.${COUNTDOWN_WARNING_CLASS} {
  color: #e5484d !important;
  font-weight: 600;
  animation: dqtp-countdown-blink 1s ease-in-out infinite;
}
.${HIDDEN_CONTROL_CLASS} {
  display: none !important;
}
/* 单选题选中后, 标号方块复用多选题复选框的实心底色 */
${QUESTION_CARD_SELECTOR} button[role="radio"][aria-checked="true"] > span:first-child {
  background: var(--dsw-alias-label-primary);
  color: var(--dsw-alias-label-primary-foreground);
}
@media (prefers-reduced-motion: reduce) {
  .${COUNTDOWN_WARNING_CLASS} { animation: none; }
}
`

/* 宿主「会一直等你回答」的文案, 意味着进入不超时状态 */
const HELD_PATTERN = /会一直等你回答|Waiting until you answer/
/* 宿主原文与插件改名后的「无限等待」文案 */
const TAKE_TIME_TEXTS: readonly string[] = ['慢慢回答', '无限等待', 'Take time', 'Wait indefinitely']

/* 从卡片 key 解析会话与调用标识 */
function parseCardKey(key: string | null): CardIdentity | undefined {
  if (key === null) return undefined
  const marker = 'question:'
  if (!key.startsWith(marker)) return undefined
  const rest = key.slice(marker.length)
  const split = rest.lastIndexOf(':')
  if (split <= 0) return undefined
  return { sessionId: rest.slice(0, split), callId: rest.slice(split + 1) }
}

/* 转义属性选择器中的值 */
function escapeAttributeValue(value: string): string {
  return value.replace(/["\\]/g, '\\$&')
}

/* 按 key 定位提问卡片 */
function findCard(identity: CardIdentity): HTMLElement | undefined {
  const selector = `[data-question-key="${escapeAttributeValue(`question:${identity.sessionId}:${identity.callId}`)}"]`
  const element = document.querySelector(selector)
  return element instanceof HTMLElement ? element : undefined
}

/* 读取倒计时文本中的剩余秒数 */
function parseRemainingSeconds(text: string): number | undefined {
  for (const pattern of COUNTDOWN_PATTERNS) {
    const matched = pattern.exec(text)
    if (matched !== null) return Number(matched[1])
  }
  return undefined
}

/* 界面语言是否中文, 用于写倒计时文案(不能靠解析旧文案判断) */
function uiUsesChinese(): boolean {
  const lang = (typeof document === 'undefined' ? '' : document.documentElement.lang) || (typeof navigator === 'undefined' ? '' : navigator.language)
  return lang.toLowerCase().startsWith('zh')
}

/* 注入样式,重复安装时跳过 */
function ensureStyle(): void {
  if (document.getElementById(COUNTDOWN_STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = COUNTDOWN_STYLE_ID
  style.textContent = WARNING_STYLE
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
  const field = card.querySelector('textarea')
  return field instanceof HTMLTextAreaElement ? field.value : ''
}

/* 读取卡片里当前的答案 */
function readAnswer(card: HTMLElement): CardAnswer {
  return { selected: readSelected(card), custom: readCustom(card) }
}

/* 是否存在可注入的内容 */
function hasAnswer(answer: CardAnswer): boolean {
  return answer.selected.length > 0 || answer.custom.trim() !== ''
}

/* 把答案拼成一条可读的说明, 交给模型自行决定是否重新提问 */
function composeBody(answer: CardAnswer): string {
  const parts: string[] = []
  if (answer.selected.length > 0) parts.push(`已选: ${answer.selected.join(' / ')}`)
  const custom = answer.custom.trim()
  if (custom !== '') parts.push(`补充: ${custom}`)
  return parts.join('\n\n')
}

/* 按剩余秒数切换倒计时警示样式 */
function applyWarning(card: HTMLElement, warningSeconds: number): void {
  for (const element of Array.from(card.querySelectorAll(WAIT_STATUS_SELECTOR))) {
    if (!(element instanceof HTMLElement)) continue
    const seconds = parseRemainingSeconds(element.textContent ?? '')
    const warn = seconds !== undefined && seconds <= warningSeconds
    element.classList.toggle(COUNTDOWN_WARNING_CLASS, warn)
  }
}

/* 隐藏宿主的收起/展开开关: 卡片不提供收起 */
function hideHostControls(card: HTMLElement): void {
  for (const element of Array.from(card.querySelectorAll('button'))) {
    const label = element.getAttribute('aria-label') ?? element.getAttribute('title') ?? ''
    if (COLLAPSE_CONTROL_LABELS.includes(label)) element.classList.add(HIDDEN_CONTROL_CLASS)
  }
}

/* 把宿主的「慢慢回答」按钮改名为「无限等待」, 关闭该功能时隐藏按钮 */
function renameTakeTimeControl(card: HTMLElement, enabled: boolean): void {
  for (const element of Array.from(card.querySelectorAll('button'))) {
    const label = element.textContent?.trim() ?? ''
    const renamed = TAKE_TIME_LABELS[label]
    if (renamed === undefined) continue
    if (!enabled) {
      element.classList.add(HIDDEN_CONTROL_CLASS)
      continue
    }
    const first = element.firstChild
    if (first !== null && first.nodeType === Node.TEXT_NODE && element.childNodes.length === 1) {
      if (first.nodeValue !== renamed) first.nodeValue = renamed
      continue
    }
    if (element.textContent !== renamed) element.textContent = renamed
  }
}

/* 收起问答面板: 面板隐藏后宿主仍保留该提问的作答状态 */
function closeCardPanel(card: HTMLElement): void {
  for (const element of Array.from(card.querySelectorAll('button'))) {
    const label = element.getAttribute('aria-label') ?? element.getAttribute('title') ?? ''
    if (!CLOSE_PANEL_LABELS.includes(label)) continue
    element.click()
    return
  }
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
  const message = `${DRAFT_INJECTION_HEADER}\n\n${body}\n\n${DRAFT_INJECTION_FOOTER}`
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

/* 把「无限等待」的点击状态同步给服务端 */
function reportInfiniteWait(identity: CardIdentity): void {
  void fetch(`http://127.0.0.1:${SYNC_PORT}${SYNC_PATH}`, {
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

  const handled = new Set<string>()
  const timedOut = new Set<string>()
  const subscriptions = new Map<string, () => void>()
  const infiniteCards = new Set<string>()
  /* 每个调用最近一次填写内容, 卡片被重渲染或收起后仍可用于兜底 */
  const lastAnswers = new Map<string, CardAnswer>()
  /* 每个调用的截止时间, 按 callId 而非元素记录, 卡片重渲染后仍延续 */
  const deadlines = new Map<string, number>()

  /* 用插件自己的截止时间渲染倒计时, 宿主暂停时也继续走 */
  const applyCountdown = (card: HTMLElement, identity: CardIdentity | undefined): void => {
    const useZh = uiUsesChinese()
    for (const element of Array.from(card.querySelectorAll(WAIT_STATUS_SELECTOR))) {
      if (!(element instanceof HTMLElement)) continue
      const text = element.textContent?.trim() ?? ''
      const held = HELD_PATTERN.test(text)
      const total = parseRemainingSeconds(text)
      const callId = identity?.callId
      if (total !== undefined && callId !== undefined && !deadlines.has(callId)) deadlines.set(callId, Date.now() + total * 1000)
      if (held && callId !== undefined && infiniteCards.has(callId)) continue
      if (!held && total === undefined) continue
      const deadline = callId === undefined ? undefined : deadlines.get(callId)
      if (deadline === undefined) continue
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
      const next = useZh ? `${remaining}秒后超时` : `Timeout in ${remaining}s`
      if (text !== next) element.textContent = next
    }
  }

  /* 超时后禁止继续在卡片里回答 */
  const lockedCards = new WeakSet<HTMLElement>()
  const lockCard = (card: HTMLElement): void => {
    if (lockedCards.has(card)) return
    lockedCards.add(card)
    for (const field of Array.from(card.querySelectorAll('textarea, input'))) {
      if (field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement) field.disabled = true
    }
    for (const button of Array.from(card.querySelectorAll('button'))) {
      const text = button.textContent?.trim() ?? ''
      if (SUBMIT_TEXTS.includes(text) || NEXT_QUESTION_TEXTS.includes(text) || SKIP_QUESTION_TEXTS.includes(text)) {
        button.disabled = true
      }
    }
  }

  /*
   * 评估一行 continued 投影: 超时后不留问答框。
   * ui 范围只收起面板; context/both 把已选选项与草稿经官方通道送回模型。
   */
  const evaluateRow = (identity: CardIdentity, row: ProjectionRow): void => {
    if (handled.has(row.callId)) return
    if (!options.draftFallback) return
    const card = findCard(identity)
    const answer = (card === undefined ? undefined : readAnswer(card)) ?? lastAnswers.get(row.callId) ?? { selected: [], custom: '' }
    handled.add(row.callId)
    if (!injectsContext(options.fallback) || !hasAnswer(answer)) {
      if (card !== undefined) closeCardPanel(card)
      return
    }
    void injectAnswer(ctx, identity, row.questions, composeBody(answer))
  }

  /* 评估一个会话的提问投影 */
  const evaluateProjection = (sessionId: string, snapshot: unknown): void => {
    if (typeof snapshot !== 'object' || snapshot === null) return
    const active = (snapshot as { active?: unknown }).active
    if (!Array.isArray(active)) return
    for (const row of active as ProjectionRow[]) {
      if (row.state !== 'continued' || typeof row.callId !== 'string') continue
      timedOut.add(row.callId)
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
   * 委托监听「无限等待」点击: 宿主会在收起/展开时复用同一个按钮节点,
   * 按节点绑定监听会把收起误判成无限等待, 所以每次点击都按当时的文案判定。
   */
  const onDocumentClick = (event: Event): void => {
    const target = event.target
    if (!(target instanceof Element)) return
    const button = target.closest('button')
    if (button === null) return
    if (!TAKE_TIME_TEXTS.includes(button.textContent?.trim() ?? '')) return
    const card = button.closest(QUESTION_CARD_SELECTOR)
    const identity = parseCardKey(card instanceof HTMLElement ? card.getAttribute('data-question-key') : null)
    if (identity === undefined) return
    infiniteCards.add(identity.callId)
    reportInfiniteWait(identity)
  }
  document.addEventListener('click', onDocumentClick, true)

  /* 扫描所有受管卡片: 记录作答、切换警示样式,并确保所属会话已订阅 */
  const scan = (): void => {
    if (!options.cardEnhancements) return
    for (const element of Array.from(document.querySelectorAll(QUESTION_CARD_SELECTOR))) {
      if (!(element instanceof HTMLElement)) continue
      const identity = parseCardKey(element.getAttribute('data-question-key'))
      applyCountdown(element, identity)
      applyWarning(element, options.warningSeconds)
      renameTakeTimeControl(element, options.infiniteWait)
      hideHostControls(element)
      if (identity === undefined) continue
      const answer = readAnswer(element)
      if (hasAnswer(answer)) lastAnswers.set(identity.callId, answer)
      if (timedOut.has(identity.callId)) lockCard(element)
      ensureSubscription(identity.sessionId)
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
    for (const off of subscriptions.values()) off()
    subscriptions.clear()
  }
}
