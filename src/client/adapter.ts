/*
 * 客户端提问超时适配器
 *
 * 复用宿主提问卡片: 读取倒计时文本,在剩余秒数进入警示区间时附加闪烁样式;
 * 超时后问题进入 continued 态时,若兜底范围包含上下文,则把卡片里已输入的
 * 草稿经宿主既有的晚回复通道(userQuestions.answer)送回模型,并提示重新提问。
 * 作者: JularDepick
 */

import {
  COUNTDOWN_PATTERNS,
  COUNTDOWN_STYLE_ID,
  COUNTDOWN_WARNING_CLASS,
  DRAFT_INJECTION_FOOTER,
  DRAFT_INJECTION_HEADER,
  QUESTION_CARD_SELECTOR,
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

/* 闪烁样式: 仅在非动画偏好下启用动画 */
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
@media (prefers-reduced-motion: reduce) {
  .${COUNTDOWN_WARNING_CLASS} { animation: none; }
}
`

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
  const selector = `[${'data-question-key'}="${escapeAttributeValue(`question:${identity.sessionId}:${identity.callId}`)}"]`
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

/* 注入闪烁样式,重复安装时跳过 */
function ensureStyle(): void {
  if (document.getElementById(COUNTDOWN_STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = COUNTDOWN_STYLE_ID
  style.textContent = WARNING_STYLE
  document.head.appendChild(style)
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

/* 读取卡片中当前可见编辑框里的草稿 */
function readDraft(card: HTMLElement): string {
  const field = card.querySelector('textarea')
  return field instanceof HTMLTextAreaElement ? field.value.trim() : ''
}

/* 拼装注入上下文的草稿说明 */
function draftMessage(draft: string): string {
  return `${DRAFT_INJECTION_HEADER}\n\n${draft}\n\n${DRAFT_INJECTION_FOOTER}`
}

/* 把草稿作为晚回复答案送出,首个问题承载说明,其余问题记为跳过 */
async function submitDraft(
  ctx: AdapterContext,
  identity: CardIdentity,
  rows: ReadonlyArray<{ id: string }>,
  draft: string,
): Promise<boolean> {
  const answer = ctx.remote?.userQuestions?.answer
  if (answer === undefined || rows.length === 0) return false
  const message = draftMessage(draft)
  const answers: AnswerItem[] = rows.map((row, index) => ({
    id: row.id,
    selected: [],
    ...(index === 0 ? { custom: message } : {}),
  }))
  try {
    const result = await answer.call(ctx.remote?.userQuestions, identity.sessionId, identity.callId, { answers })
    return result.ok === true && result.value !== false
  } catch {
    return false
  }
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
  const subscriptions = new Map<string, () => void>()

  /* 评估一行 continued 投影: 有草稿且允许注入时把它送回模型 */
  const evaluateRow = (identity: CardIdentity, row: ProjectionRow): void => {
    if (handled.has(row.callId)) return
    const card = findCard(identity)
    if (card === undefined) return
    const draft = readDraft(card)
    if (draft === '') return
    handled.add(row.callId)
    void submitDraft(ctx, identity, row.questions, draft).then((sent) => {
      if (!sent) handled.delete(row.callId)
    })
  }

  /* 评估一个会话的提问投影 */
  const evaluateProjection = (sessionId: string, snapshot: unknown): void => {
    if (!injectsContext(options.fallback)) return
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

  /* 扫描所有受管卡片: 切换警示样式,并确保所属会话已订阅 */
  const scan = (): void => {
    for (const element of Array.from(document.querySelectorAll(QUESTION_CARD_SELECTOR))) {
      if (!(element instanceof HTMLElement)) continue
      applyWarning(element, options.warningSeconds)
      if (!injectsContext(options.fallback)) continue
      const identity = parseCardKey(element.getAttribute('data-question-key'))
      if (identity !== undefined) ensureSubscription(identity.sessionId)
    }
  }

  const observer = new MutationObserver(scan)
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  const timer = window.setInterval(scan, 1000)
  scan()

  return () => {
    observer.disconnect()
    window.clearInterval(timer)
    for (const off of subscriptions.values()) off()
    subscriptions.clear()
  }
}
