/*
 * 客户端提问超时适配器
 *
 * 复用宿主提问卡片: 读取倒计时文本,在剩余秒数进入警示区间时附加闪烁样式;
 * 超时后问题进入 continued 态时,若兜底范围包含上下文,则把卡片里已输入的
 * 草稿经宿主既有的晚回复通道(userQuestions.answer)送回模型,由模型自行决定是否重新提问或跳过。
 * 作者: JularDepick
 */

import {
  ASK_PENDING_TEXTS,
  ASK_REOPEN_TEXTS,
  CLOSE_PANEL_LABELS,
  COLLAPSE_CONTROL_LABELS,
  COUNTDOWN_PATTERNS,
  DRAFT_PANEL_ID,
  DRAFT_STORAGE_PREFIX,
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
  TIMED_OUT_INJECTED_MARKER,
  TIMED_OUT_MARKER,
  TIMED_OUT_UI_MARKER,
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
.${HIDDEN_CONTROL_CLASS} {
  display: none !important;
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

/* 隐藏宿主的收起/展开开关: 卡片不提供收起 */
function hideHostControls(card: HTMLElement): void {
  for (const element of Array.from(card.querySelectorAll('button'))) {
    const label = element.getAttribute('aria-label') ?? element.getAttribute('title') ?? ''
    if (COLLAPSE_CONTROL_LABELS.includes(label)) element.classList.add(HIDDEN_CONTROL_CLASS)
  }
}

/* 把宿主的「慢慢回答」按钮改名为「无限等待」 */
function renameTakeTimeControl(card: HTMLElement): void {
  for (const element of Array.from(card.querySelectorAll('button'))) {
    const label = element.textContent?.trim() ?? ''
    const renamed = TAKE_TIME_LABELS[label]
    if (renamed === undefined) continue
    const first = element.firstChild
    if (first !== null && first.nodeType === Node.TEXT_NODE && element.childNodes.length === 1) {
      if (first.nodeValue !== renamed) first.nodeValue = renamed
      continue
    }
    if (element.textContent !== renamed) element.textContent = renamed
  }
}

/* 收起问答面板: 面板隐藏后草稿仍留在该提问的浏览器草稿里 */
function closeCardPanel(card: HTMLElement): void {
  for (const element of Array.from(card.querySelectorAll('button'))) {
    const label = element.getAttribute('aria-label') ?? element.getAttribute('title') ?? ''
    if (!CLOSE_PANEL_LABELS.includes(label)) continue
    element.click()
    return
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

/* 一条超时草稿的本地存储内容 */
interface StoredDraft {
  draft: string
  sessionId: string
  injected: boolean
}

/* 把超时草稿写入浏览器本地存储, 重启后仍可查看 */
function storeDraft(callId: string, sessionId: string, injected: boolean, draft: string): void {
  if (draft === '') return
  try {
    window.localStorage.setItem(`${DRAFT_STORAGE_PREFIX}${callId}`, JSON.stringify({ draft, sessionId, injected }))
  } catch {
    /* 隐私模式等场景写入失败时忽略 */
  }
}

/* 读取某个调用的超时草稿 */
function readStoredDraft(callId: string): StoredDraft | undefined {
  try {
    const raw = window.localStorage.getItem(`${DRAFT_STORAGE_PREFIX}${callId}`)
    if (raw === null) return undefined
    const parsed = JSON.parse(raw) as Partial<StoredDraft>
    if (typeof parsed.draft !== 'string') return undefined
    return {
      draft: parsed.draft,
      sessionId: typeof parsed.sessionId === 'string' ? parsed.sessionId : '',
      injected: parsed.injected === true,
    }
  } catch {
    return undefined
  }
}

/* 把草稿填进卡片输入框并走宿主原版提交流程 */
async function submitViaCard(card: HTMLElement, message: string): Promise<boolean> {
  const field = card.querySelector('textarea')
  if (!(field instanceof HTMLTextAreaElement)) return false
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  if (setter === undefined) return false
  setter.call(field, message)
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 0))
  const findButton = (texts: readonly string[]): HTMLButtonElement | undefined =>
    Array.from(card.querySelectorAll('button')).find((button) => texts.includes(button.textContent?.trim() ?? ''))
  for (let step = 0; step < 12; step += 1) {
    const submit = findButton(SUBMIT_TEXTS)
    if (submit !== undefined) {
      submit.click()
      return true
    }
    const next = findButton(NEXT_QUESTION_TEXTS)
    if (next !== undefined) {
      next.click()
    } else {
      const skip = findButton(SKIP_QUESTION_TEXTS)
      if (skip === undefined) return false
      skip.click()
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return false
}

/* 从元素所在行里找已保存的草稿 */
function findDraftNear(element: Element): StoredDraft | undefined {
  let node: Element | null = element
  for (let depth = 0; depth < 10 && node !== null; depth += 1) {
    for (const attribute of Array.from(node.attributes)) {
      const stored = readStoredDraft(attribute.value)
      if (stored !== undefined) return stored
    }
    node = node.parentElement
  }
  return undefined
}

/* 只读查看超时草稿的面板 */
function showDraftPanel(label: string, draft: string): void {
  document.getElementById(DRAFT_PANEL_ID)?.remove()
  const panel = document.createElement('div')
  panel.id = DRAFT_PANEL_ID
  panel.style.cssText =
    'position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.35);padding:24px;'
  const card = document.createElement('div')
  card.style.cssText =
    'max-width:680px;width:100%;max-height:70vh;overflow:auto;background:#ffffff;color:#1f2328;border-radius:12px;padding:16px 18px;box-shadow:0 12px 40px rgba(0,0,0,.25);font:14px/1.6 system-ui,sans-serif;'
  const title = document.createElement('div')
  title.textContent = label
  title.style.cssText = 'font-weight:600;margin-bottom:8px;'
  const body = document.createElement('div')
  body.style.cssText = 'white-space:pre-wrap;word-break:break-word;'
  body.textContent = draft
  const close = document.createElement('button')
  close.type = 'button'
  close.textContent = '关闭'
  close.style.cssText = 'margin-top:12px;padding:6px 14px;border-radius:8px;border:1px solid #d0d7de;background:#f6f8fa;cursor:pointer;'
  close.addEventListener('click', () => panel.remove())
  card.append(title, body, close)
  panel.append(card)
  panel.addEventListener('click', (event) => {
    if (event.target === panel) panel.remove()
  })
  document.body.append(panel)
}

/* 「无限等待」按钮的文案(宿主原文与插件改名后的文案) */
const TAKE_TIME_TEXTS: readonly string[] = ['慢慢回答', '无限等待', 'Take time', 'Wait indefinitely']

/* 把「无限等待」的点击状态同步给服务端 */
function reportInfiniteWait(identity: CardIdentity): void {
  void fetch(`http://127.0.0.1:${SYNC_PORT}${SYNC_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ callId: identity.callId, infinite: true }),
  }).catch(() => {})
}

/* 监听「无限等待」按钮, 点击时上报状态 */
function watchInfiniteControl(
  card: HTMLElement,
  identity: CardIdentity,
  bound: WeakSet<HTMLButtonElement>,
  onInfinite: () => void,
): void {
  for (const element of Array.from(card.querySelectorAll('button'))) {
    if (!(element instanceof HTMLButtonElement) || bound.has(element)) continue
    if (!TAKE_TIME_TEXTS.includes(element.textContent?.trim() ?? '')) continue
    bound.add(element)
    element.addEventListener('click', onInfinite)
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
  const timedOut = new Set<string>()
  const subscriptions = new Map<string, () => void>()

  /*
   * 评估一行 continued 投影: 超时后不留问答框。
   * ui 范围只收起面板, 草稿留在该提问的浏览器草稿里; context/both 把草稿作为晚回复送出。
   */
  const evaluateRow = (identity: CardIdentity, row: ProjectionRow): void => {
    if (handled.has(row.callId)) return
    const card = findCard(identity)
    if (card === undefined) return
    const draft = readDraft(card)
    if (draft !== '') storeDraft(row.callId, identity.sessionId, injectsContext(options.fallback), draft)
    handled.add(row.callId)
    if (!injectsContext(options.fallback) || draft === '') {
      closeCardPanel(card)
      return
    }
    void submitViaCard(card, draftMessage(draft)).then(async (submitted) => {
      if (submitted) return
      const sent = await submitDraft(ctx, identity, row.questions, draft)
      if (!sent) handled.delete(row.callId)
    })
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

  /* 每张卡片的首个截止时间; 输入或聚焦都不影响它 */
  const deadlines = new WeakMap<HTMLElement, number>()
  const infiniteCards = new Set<string>()

  /* 用插件自己的截止时间渲染倒计时, 宿主隐藏或暂停时也继续走 */
  const applyCountdown = (card: HTMLElement, identity: CardIdentity | undefined): void => {
    for (const element of Array.from(card.querySelectorAll(WAIT_STATUS_SELECTOR))) {
      if (!(element instanceof HTMLElement)) continue
      const text = element.textContent?.trim() ?? ''
      const held = /会一直等你回答|Waiting until you answer/.test(text)
      const match =
        /(\d+)\s*秒后(?:继续工作|超时|继续)/.exec(text) ??
        /(?:Continuing in|Timeout in) (\d+)s/.exec(text) ??
        /Paused · (\d+)s remaining/.exec(text)
      if (match !== null && !deadlines.has(card)) deadlines.set(card, Date.now() + Number(match[1]) * 1000)
      if (held && identity !== undefined && infiniteCards.has(identity.callId)) continue
      if (!held && match === null) continue
      const deadline = deadlines.get(card)
      if (deadline === undefined) continue
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
      const next = /秒/.test(text) ? `${remaining}秒后超时` : `Timeout in ${remaining}s`
      if (text !== next) element.textContent = next
    }
  }

  /* 已绑定点击上报的按钮 */
  const boundButtons = new WeakSet<HTMLButtonElement>()

  /* 已装饰过的历史气泡 */
  const decoratedBubbles = new WeakSet<Element>()

  /* 给存有草稿的历史气泡换标签, 并让点击打开只读草稿 */
  const decorateReplyBubbles = (): void => {
    for (const element of Array.from(document.querySelectorAll('[data-question-reply]'))) {
      const callId = element.getAttribute('data-question-reply')
      if (callId === null) continue
      const stored = readStoredDraft(callId)
      if (stored === undefined) continue
      const marker = stored.injected ? TIMED_OUT_INJECTED_MARKER : TIMED_OUT_UI_MARKER
      const labelNode = Array.from(element.querySelectorAll('span')).find((node) => /(^|\s)[\w-]*_label(\s|$)/.test(node.className))
      if (labelNode !== undefined && labelNode.textContent !== marker) labelNode.textContent = marker
      if (decoratedBubbles.has(element)) continue
      decoratedBubbles.add(element)
      element.addEventListener(
        'click',
        (event) => {
          const target = event.target
          if (!(target instanceof Element)) return
          if (target.closest('button[aria-expanded]') === null) return
          event.preventDefault()
          event.stopPropagation()
          showDraftPanel(marker, stored.draft)
        },
        true,
      )
    }
  }

  /* 已绑定的工具行「回答」按钮 */
  const boundReopen = new WeakSet<HTMLButtonElement>()

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

  /* 把工具调用行里「回答」按钮改成只读标记, 点击只查看草稿 */
  const decorateAskReopenButtons = (): void => {
    for (const button of Array.from(document.querySelectorAll('button'))) {
      if (!(button instanceof HTMLButtonElement)) continue
      if (!ASK_REOPEN_TEXTS.includes(button.textContent?.trim() ?? '')) continue
      let node: Element | null = button
      let pending = false
      for (let depth = 0; depth < 6 && node !== null; depth += 1) {
        if (ASK_PENDING_TEXTS.some((text) => node?.textContent?.includes(text) === true)) {
          pending = true
          break
        }
        node = node.parentElement
      }
      if (!pending) continue
      const stored = findDraftNear(button)
      const marker = stored === undefined ? TIMED_OUT_MARKER : stored.injected ? TIMED_OUT_INJECTED_MARKER : TIMED_OUT_UI_MARKER
      if (button.textContent !== marker) button.textContent = marker
      if (boundReopen.has(button)) continue
      boundReopen.add(button)
      button.addEventListener(
        'click',
        (event) => {
          event.preventDefault()
          event.stopPropagation()
          if (stored !== undefined) showDraftPanel(marker, stored.draft)
        },
        true,
      )
    }
  }

  /* 扫描所有受管卡片: 切换警示样式,并确保所属会话已订阅 */
  const scan = (): void => {
    for (const element of Array.from(document.querySelectorAll(QUESTION_CARD_SELECTOR))) {
      if (!(element instanceof HTMLElement)) continue
      const identity = parseCardKey(element.getAttribute('data-question-key'))
      applyCountdown(element, identity)
      applyWarning(element, options.warningSeconds)
      renameTakeTimeControl(element)
      hideHostControls(element)
      if (identity !== undefined) {
        if (timedOut.has(identity.callId)) lockCard(element)
        watchInfiniteControl(element, identity, boundButtons, () => {
          infiniteCards.add(identity.callId)
          reportInfiniteWait(identity)
        })
        ensureSubscription(identity.sessionId)
      }
    }
    decorateReplyBubbles()
    decorateAskReopenButtons()
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
