/*
 * 提问卡片的收起状态
 *
 * 宿主的「面板已收起」只存在客户端卡片注册表的内存里: 会话解绑、投影瞬时为空或页面刷新后,
 * 宿主会为仍然 continued 的提问新建卡片并重新发布到 composer 座位, 卡片于是自己弹开。
 * 因此收起状态必须由插件记住, 并在座位选举时压制宿主的重建: 插件在 conversation.composer
 * 以更低的优先级注册条目, 命中收起记录时渲染空组件并调用卡片对象的 dismiss() 撤下座位,
 * 宿主自己的卡片就不会出现; 只有用户点工具行上的「回答」(宿主 reveal 复用同一个卡片对象)
 * 才放行渲染。
 *
 * 两条判据:
 * - 对象身份: 宿主只有 reveal() 会复用同一个卡片对象重新发布, 会话切换与刷新都是新建对象,
 *   因此「先观测到消失、之后同对象再次发布」是用户重开, 「新对象发布」是宿主重建;
 *   没有消失过的同对象再选举只是同一份发布的重复渲染, 仍按重建处理。
 * - closed 字段: 宿主只在 remove() 时置 closed, dismiss() 不置, 因此卡片消失且 closed 为真
 *   说明是宿主移除(结算或解绑), 为假才是用户自己收起。
 *
 * 失败方向一律收敛到「用户仍可作答」: 任何异常都不注册压制; 压制次数用尽、记录过期或
 * 撤座失败都交还宿主, 绝不留下空座位。
 * 作者: JularDepick
 */

import {
  MAX_PANEL_RECORDS,
  PANEL_RECORD_TTL_MS,
  PANEL_STATE_STORAGE_KEY,
  PANEL_SUPPRESS_DEBOUNCE_MS,
  PANEL_SUPPRESS_LIMIT,
  PANEL_SUPPRESS_WINDOW_MS,
  QUESTION_CARD_KEY_PREFIX,
} from '../constants'

/** 收起记录的来源: 插件按 allow 收尾, 插件按 block 收尾, 用户自己收起 */
type PanelMode = 'allow' | 'block' | 'user'

/** 座位选举的结论: 压制(渲染空组件并撤座)或放行(交给宿主原版卡片) */
export type SeatDecision = 'suppress' | 'decline'

/** 宿主的提问卡片对象(只取用得到的公共面) */
export interface HostQuestionCard {
  key: string
  callId: string
  sessionId?: string
  questions: readonly unknown[]
  review?: unknown
  dismiss(): unknown
  getSnapshot?(): unknown
}

/** 一条收起记录 */
interface PanelRecord {
  sessionId: string
  callId: string
  /** 卡片对象身份, 由 WeakMap 分配; 未挂载时为空 */
  objectId?: number
  mode: PanelMode
  /** 记录建立时刻 */
  at: number
  /** 已压制次数 */
  suppressions: number
  /** 上次压制时刻 */
  lastSuppressAt: number
  /** 是否已经真的把座位撤下来过: 交还宿主时据此决定要不要把卡片放回去 */
  dismissed?: boolean
  /** 观测到这张卡片从座位上消失的时刻: 只有消失之后再次出现的同对象才算用户重开 */
  absentSince?: number
}

/** 会话状态存储的最小面(宿主 uiSession.sessionStatus) */
interface SessionStatusLike {
  getSnapshot?: () => unknown
  subscribe?: (listener: () => void) => () => void
}

/** 会话投影面 */
interface ProjectionFace {
  getSnapshot?: () => unknown
}

/** 插件侧上下文的最小面 */
export interface PanelContext {
  sessions?: { binding?: (sessionId: string) => unknown }
  get?: (name: string) => unknown
}

/** 收起状态对外接口 */
export interface PanelState {
  /** 座位选举: 命中收起记录时返回 suppress */
  decide(sessionId: string | undefined, interaction: unknown): SeatDecision
  /** 插件收尾: 记下收起并立刻撤座 */
  collapse(sessionId: string, callId: string, mode: 'allow' | 'block'): void
  /** 交还宿主: 丢弃记录并把卡片放回来 */
  release(sessionId: string, callId: string): void
  /** 空组件挂载时执行的撤座 */
  suppressNow(sessionId: string | undefined, interaction: unknown): void
  /** 卸载 */
  dispose(): void
}

/** 宿主卡片身份判据: key 前缀 + 调用标识 + 题面 + dismiss 方法 */
function isHostQuestionCard(value: unknown): value is HostQuestionCard {
  if (typeof value !== 'object' || value === null) return false
  const card = value as Record<string, unknown>
  if (typeof card.key !== 'string' || !card.key.startsWith(QUESTION_CARD_KEY_PREFIX)) return false
  if (typeof card.callId !== 'string' || card.callId === '') return false
  if (!Array.isArray(card.questions)) return false
  return typeof card.dismiss === 'function'
}

/* 卡片是否已被宿主从注册表移除(remove 才置 closed) */
function cardClosed(card: HostQuestionCard): boolean {
  try {
    const snapshot = card.getSnapshot?.()
    return typeof snapshot === 'object' && snapshot !== null
      && (snapshot as { closed?: unknown }).closed === true
  } catch {
    return false
  }
}

/* 记录键: 会话与调用一起定位, 多会话下不会互相覆盖 */
function recordKey(sessionId: string, callId: string): string {
  return sessionId + '\n' + callId
}

/** 安全读取宿主服务 */
function readService<T>(ctx: PanelContext, name: string): T | undefined {
  try {
    const getter = (ctx as { get?: (key: string) => unknown }).get
    if (typeof getter === 'function') {
      const value = getter.call(ctx, name)
      if (value !== undefined && value !== null) return value as T
    }
  } catch {
    /* 未注入时按缺失处理 */
  }
  try {
    const value = (ctx as Record<string, unknown>)[name]
    if (value !== undefined && value !== null) return value as T
  } catch {
    /* 未注入时按缺失处理 */
  }
  return undefined
}

/** 取会话提问投影面 */
function projectionFace(ctx: PanelContext, sessionId: string): ProjectionFace | undefined {
  const pick = (sessions: unknown): ProjectionFace | undefined => {
    const binding = (sessions as { binding?: (id: string) => unknown } | undefined)?.binding?.(sessionId) as
      | { session?: { projections?: { faceOf?: (name: string) => unknown } } }
      | undefined
    const face = binding?.session?.projections?.faceOf?.('userQuestions')
    return typeof face === 'object' && face !== null ? (face as ProjectionFace) : undefined
  }
  /*
   * 客户端只硬注入 slots, 直接读未注入的服务属性会被框架抛错,
   * 因此先按属性读, 再退回 ctx.get; 两条都拿不到才算投影缺失。
   */
  try {
    const direct = pick(ctx.sessions)
    if (direct !== undefined) return direct
  } catch {
    /* 未注入 sessions 时按缺失处理 */
  }
  try {
    const getter = (ctx as { get?: (name: string) => unknown }).get
    return typeof getter === 'function' ? pick(getter.call(ctx, 'sessions')) : undefined
  } catch {
    return undefined
  }
}

/*
 * 该调用在投影里是否仍是 continued。
 * 三态: yes 仍在等待作答, no 行在但状态已不是 continued, unknown 行缺席或投影读不到。
 * 用户收起的判定只在 yes 时做, 读不到或行缺席时一律不动:
 * 会话重绑与刷新会让 active 瞬时为空, 按已结算处理会把记录删掉, 卡片随即被宿主重建并弹开。
 */
function rowContinued(ctx: PanelContext, sessionId: string, callId: string): 'yes' | 'no' | 'unknown' {
  const face = projectionFace(ctx, sessionId)
  if (face === undefined) return 'unknown'
  let snapshot: unknown
  try {
    snapshot = face.getSnapshot?.()
  } catch {
    return 'unknown'
  }
  if (typeof snapshot !== 'object' || snapshot === null) return 'unknown'
  const active = (snapshot as { active?: unknown }).active
  if (!Array.isArray(active)) return 'unknown'
  for (const row of active) {
    if (typeof row !== 'object' || row === null) continue
    const entry = row as { callId?: unknown; state?: unknown }
    if (entry.callId !== callId) continue
    return entry.state === 'continued' ? 'yes' : 'no'
  }
  /*
   * 行不在 active 里不等于已经结算: 会话重绑或刷新时投影会瞬时给出空 active,
   * 这时按已结算回收记录, 宿主随后重建卡片就没有记录可压制, 卡片会自己弹开。
   * 因此只有"行在但状态不是 continued"才算 no, 行缺席一律按未知处理。
   */
  return 'unknown'
}

/*
 * 该调用是否已经结算。
 * 投影的 settled 是权威信号(结算后仍留在列表里), 与 active 是否瞬时为空无关,
 * 收起记录据此回收, 不必等 TTL。
 */
function rowSettled(ctx: PanelContext, sessionId: string, callId: string): boolean {
  const face = projectionFace(ctx, sessionId)
  if (face === undefined) return false
  let snapshot: unknown
  try {
    snapshot = face.getSnapshot?.()
  } catch {
    return false
  }
  if (typeof snapshot !== 'object' || snapshot === null) return false
  const settled = (snapshot as { settled?: unknown }).settled
  if (!Array.isArray(settled)) return false
  for (const row of settled) {
    if (typeof row !== 'object' || row === null) continue
    if ((row as { callId?: unknown }).callId === callId) return true
  }
  return false
}

/** 读取已持久化的记录 */
function loadRecords(storage: Storage | undefined): PanelRecord[] {
  if (storage === undefined) return []
  try {
    const raw = storage.getItem(PANEL_STATE_STORAGE_KEY)
    if (raw === null || raw === '') return []
    const parsed = JSON.parse(raw) as { records?: unknown }
    if (!Array.isArray(parsed.records)) return []
    const records: PanelRecord[] = []
    for (const entry of parsed.records) {
      if (typeof entry !== 'object' || entry === null) continue
      const item = entry as { s?: unknown; c?: unknown; m?: unknown; t?: unknown }
      if (typeof item.s !== 'string' || item.s === '') continue
      if (typeof item.c !== 'string' || item.c === '') continue
      const mode = item.m === 'block' ? 'block' : item.m === 'user' ? 'user' : 'allow'
      const at = typeof item.t === 'number' && Number.isFinite(item.t) ? item.t : 0
      records.push({ sessionId: item.s, callId: item.c, mode, at, suppressions: 0, lastSuppressAt: 0 })
    }
    return records
  } catch {
    return []
  }
}

/**
 * 安装收起状态。
 * 宿主相关能力缺失时返回一个永远放行的实现, 等于不接管, 不会留下撤不掉的座位。
 */
export function createPanelState(ctx: PanelContext): PanelState {
  const storage = (() => {
    try {
      return typeof localStorage === 'undefined' ? undefined : localStorage
    } catch {
      return undefined
    }
  })()
  const records = new Map<string, PanelRecord>()
  for (const record of loadRecords(storage)) records.set(recordKey(record.sessionId, record.callId), record)

  const objectIds = new WeakMap<object, number>()
  let nextObjectId = 1
  const objectIdOf = (card: HostQuestionCard): number => {
    const existing = objectIds.get(card)
    if (existing !== undefined) return existing
    const assigned = nextObjectId
    nextObjectId += 1
    objectIds.set(card, assigned)
    return assigned
  }

  /* 最近一次观测到的卡片, 用于判断「卡片消失」是宿主移除还是用户收起 */
  const lastSeen = new Map<string, { sessionId: string; callId: string; card: HostQuestionCard }>()
  /* 插件自己发起的撤座时刻, 用来跳过自身动作触发的消失判定 */
  const selfDismissedAt = new Map<string, number>()
  const warned = new Set<string>()

  /*
   * 宿主服务必须按需解析, 不能在这里取一次就存下来:
   * 客户端模块可能早于 dsh-client-ui-session 就绪, 那时 uiSession 还不存在,
   * 取一次的结果会一直是 undefined, 整条对账链路就再也不会启动。
   */
  const statusOf = (): SessionStatusLike | undefined => {
    const ui = readService<{ sessionStatus?: SessionStatusLike }>(ctx, 'uiSession')
    const candidate = ui?.sessionStatus
    return typeof candidate?.getSnapshot === 'function' && typeof candidate.subscribe === 'function'
      ? candidate
      : undefined
  }
  const panelsOf = (): { reveal?: (sessionId: string, callId: string) => unknown } | undefined =>
    readService<{ reveal?: (sessionId: string, callId: string) => unknown }>(ctx, 'userQuestionPanels')

  let status: SessionStatusLike | undefined
  let off: (() => void) | undefined
  let watchStartedAt = 0
  /* 拿到会话状态就订阅并立即对一次账; 服务晚到时也能接上 */
  const ensureWatch = (): SessionStatusLike | undefined => {
    if (status !== undefined) return status
    const resolved = statusOf()
    if (resolved === undefined) {
      if (watchStartedAt === 0) watchStartedAt = now()
      else if (now() - watchStartedAt > 5000) {
        warnOnce('no-session-status', '读不到宿主会话状态, 问答卡片的收起状态不会被保持')
      }
      return undefined
    }
    status = resolved
    off = resolved.subscribe?.(scheduleReconcile)
    scheduleReconcile()
    return status
  }

  let disposed = false
  let reconciling = false
  let reconcileScheduled = false
  let persistTimer: ReturnType<typeof setTimeout> | undefined

  const now = (): number => Date.now()

  const warnOnce = (key: string, message: string): void => {
    if (warned.has(key)) return
    warned.add(key)
    console.warn('[question-timeout-protection] ' + message)
  }

  const writeStorage = (): void => {
    if (storage === undefined) return
    try {
      const list = [...records.values()].map((record) => ({
        s: record.sessionId,
        c: record.callId,
        m: record.mode,
        t: record.at,
      }))
      storage.setItem(PANEL_STATE_STORAGE_KEY, JSON.stringify({ v: 1, records: list }))
    } catch {
      /* 存储不可用时只保留内存态 */
    }
  }

  const persist = (): void => {
    if (storage === undefined || persistTimer !== undefined) return
    persistTimer = setTimeout(() => {
      persistTimer = undefined
      writeStorage()
    }, 200)
  }

  const prune = (): void => {
    const staleMark = now() - PANEL_SUPPRESS_DEBOUNCE_MS
    for (const [key, stamp] of selfDismissedAt) {
      if (stamp < staleMark) selfDismissedAt.delete(key)
    }
    const limit = now() - PANEL_RECORD_TTL_MS
    for (const [key, record] of records) {
      if (record.at < limit) records.delete(key)
    }
    while (records.size > MAX_PANEL_RECORDS) {
      let oldestKey: string | undefined
      let oldestAt = Number.POSITIVE_INFINITY
      for (const [key, record] of records) {
        if (record.at >= oldestAt) continue
        oldestAt = record.at
        oldestKey = key
      }
      if (oldestKey === undefined) break
      records.delete(oldestKey)
    }
  }

  /* 在会话状态里找某调用的卡片对象 */
  const findCard = (sessionId: string, callId: string): HostQuestionCard | undefined => {
    const watch = ensureWatch()
    if (watch === undefined) return undefined
    let snapshot: unknown
    try {
      snapshot = watch.getSnapshot?.()
    } catch {
      return undefined
    }
    if (!(snapshot instanceof Map)) return undefined
    const entry = snapshot.get(sessionId) as { pendingInteraction?: unknown } | undefined
    const interaction = entry?.pendingInteraction
    if (!isHostQuestionCard(interaction)) return undefined
    return interaction.callId === callId ? interaction : undefined
  }

  const releaseRecord = (key: string): void => {
    if (!records.delete(key)) return
    persist()
  }

  /*
   * 交还宿主: 丢掉记录, 并把已经撤下来的卡片放回座位。
   * 撤座失败时也必须走这条: 空组件当选期间 chain 的 fallback 是 display:none,
   * 只删记录不会让座位重新选举, 用户会面对一块没有输入栏的空白。
   */
  const handBack = (sessionId: string, callId: string): void => {
    releaseRecord(recordKey(sessionId, callId))
    try {
      panelsOf()?.reveal?.(sessionId, callId)
    } catch {
      /* 宿主入口不可用时保持原样 */
    }
  }

  const suppressNow = (sessionId: string | undefined, interaction: unknown): void => {
    if (disposed) return
    if (!isHostQuestionCard(interaction)) return
    const owner = sessionId ?? interaction.sessionId
    if (typeof owner !== 'string' || owner === '') return
    const key = recordKey(owner, interaction.callId)
    const record = records.get(key)
    const stamp = now()
    /*
     * 计数只在 decide 里、且只在"换了一张新卡片对象"时增加:
     * 同一份发布的重复选举(渲染被丢弃后重来、同一帧里被调用两次)不该消耗逃生阀。
     */
    /*
     * 登记这一张卡片, 让对账能观测到它随后消失:
     * 组件先于对账撤座时, 不登记就收不到消失事件, absentSince 一直为空,
     * 用户点「回答」的第一次会被当成重复选举而吞掉。
     */
    lastSeen.set(key, { sessionId: owner, callId: interaction.callId, card: interaction })
    selfDismissedAt.set(key, stamp)
    if (record !== undefined) {
      record.dismissed = true
      /* 刚刚又压下一次, 之后的同对象选举都算重复渲染, 直到再次观测到它消失 */
      record.absentSince = undefined
    }
    try {
      const result = interaction.dismiss()
      if (typeof (result as Promise<unknown> | undefined)?.then === 'function') {
        void (result as Promise<unknown>).catch(() => {
          /* 撤座失败即交还宿主, 绝不留空座位 */
          handBack(owner, interaction.callId)
        })
      }
    } catch {
      handBack(owner, interaction.callId)
      warnOnce('dismiss-failed', '无法让宿主撤下问答卡片座位, 这一轮改由宿主原版处理')
    }
  }

  const decide = (sessionId: string | undefined, interaction: unknown): SeatDecision => {
    if (!isHostQuestionCard(interaction)) return 'decline'
    /* 只读回看卡片不参与接管: 它没有作答通道, 撤掉只会让用户失去回看入口 */
    if (interaction.review !== undefined) return 'decline'
    const owner = sessionId ?? interaction.sessionId
    if (typeof owner !== 'string' || owner === '') return 'decline'
    const key = recordKey(owner, interaction.callId)
    const record = records.get(key)
    if (record === undefined) return 'decline'
    if (now() - record.at > PANEL_RECORD_TTL_MS) {
      releaseRecord(key)
      return 'decline'
    }
    const objectId = objectIdOf(interaction)
    /*
     * 只有"换了一张新卡片对象"才算一次宿主重建: 同一份发布的重复选举
     * (并发渲染被丢弃后重来, 同一次渲染里被调用两次)不该消耗逃生阀。
     * 计数按窗口清零, 正常切会话的间隔是分钟级, 不会把配额耗光。
     */
    const noteRebuild = (): void => {
      const stamp = now()
      if (stamp - record.lastSuppressAt > PANEL_SUPPRESS_WINDOW_MS) record.suppressions = 0
      record.suppressions += 1
      record.lastSuppressAt = stamp
      persist()
    }
    const giveUp = (): SeatDecision => {
      releaseRecord(key)
      warnOnce('suppress-limit:' + key, '问答卡片重建次数过多, 已交还宿主, 用户可点「回答」重新打开')
      return 'decline'
    }
    const overLimit = (): boolean => record.suppressions > PANEL_SUPPRESS_LIMIT
    if (record.mode === 'block') {
      if (record.objectId !== objectId) {
        record.objectId = objectId
        noteRebuild()
      }
      return overLimit() ? giveUp() : 'suppress'
    }
    if (record.objectId === undefined) {
      record.objectId = objectId
      noteRebuild()
      return overLimit() ? giveUp() : 'suppress'
    }
    if (record.objectId === objectId) {
      /*
       * 同一个对象再次出现: 只有"先观测到它从座位上消失, 之后又被发布"才是宿主 reveal,
       * 也就是用户点了「回答」。没有消失过就是同一份发布的重复选举,
       * 必须继续压制而不是放行, 否则一次重复选举就会把已经收起的卡片放出来。
       */
      if (record.absentSince === undefined) return 'suppress'
      releaseRecord(key)
      return 'decline'
    }
    record.objectId = objectId
    noteRebuild()
    return overLimit() ? giveUp() : 'suppress'
  }

  const handleDisappeared = (seen: { sessionId: string; callId: string; card: HostQuestionCard }): void => {
    /* 只读回看卡片不参与接管, 它的出现与消失都不该影响收起记录 */
    if (seen.card.review !== undefined) return
    const key = recordKey(seen.sessionId, seen.callId)
    const continued = rowContinued(ctx, seen.sessionId, seen.callId)
    /* 记下消失时刻: 之后同一个对象再被发布才是用户点了「回答」 */
    const tracked = records.get(key)
    if (tracked !== undefined) tracked.absentSince = now()
    if (cardClosed(seen.card)) {
      /*
       * 宿主移除卡片: 已结算就回收记录, 解绑或刷新则保留, 重建时继续压制。
       * 结算与否以投影的 settled 为准, 不看 active: 后者在重绑瞬间会瞬时为空。
       */
      if (rowSettled(ctx, seen.sessionId, seen.callId) || continued === 'no') releaseRecord(key)
      return
    }
    const stamp = selfDismissedAt.get(key)
    if (stamp !== undefined && now() - stamp < PANEL_SUPPRESS_DEBOUNCE_MS) return
    if (continued !== 'yes') return
    if (records.has(key)) return
    /* 用户自己点的关闭: 同样保持收起, 否则切换会话后仍会自动弹开 */
    records.set(key, {
      sessionId: seen.sessionId,
      callId: seen.callId,
      /* 绑定当前对象: 用户点「回答」时宿主会复用同一个对象, 据此一次就能放行 */
      objectId: objectIdOf(seen.card),
      mode: 'user',
      at: now(),
      suppressions: 0,
      lastSuppressAt: 0,
      absentSince: now(),
    })
    prune()
    persist()
  }

  const reconcile = (): void => {
    if (disposed || reconciling) return
    const watch = ensureWatch()
    if (watch === undefined) return
    reconciling = true
    try {
      let snapshot: unknown
      try {
        snapshot = watch.getSnapshot?.()
      } catch {
        return
      }
      if (!(snapshot instanceof Map)) return
      const present = new Set<string>()
      for (const [sessionId, entry] of snapshot as Map<string, { pendingInteraction?: unknown }>) {
        const interaction = entry?.pendingInteraction
        if (!isHostQuestionCard(interaction)) continue
        const key = recordKey(sessionId, interaction.callId)
        present.add(key)
        lastSeen.set(key, { sessionId, callId: interaction.callId, card: interaction })
        if (decide(sessionId, interaction) === 'suppress') suppressNow(sessionId, interaction)
      }
      for (const [key, seen] of lastSeen) {
        if (present.has(key)) continue
        lastSeen.delete(key)
        handleDisappeared(seen)
      }
    } finally {
      reconciling = false
    }
  }

  const scheduleReconcile = (): void => {
    if (disposed || reconcileScheduled) return
    reconcileScheduled = true
    Promise.resolve().then(() => {
      reconcileScheduled = false
      try {
        reconcile()
      } catch (error) {
        warnOnce('reconcile', '整理问答卡片收起状态时出错, 本轮跳过')
        console.warn('[question-timeout-protection] 整理问答卡片收起状态时出错', error)
      }
    })
  }

  /* 冷启动先按 TTL 与容量裁一次: 持久化里的记录可能比当前上限还多 */
  prune()
  /*
   * 另一个标签页改了收起状态时同步内存并重新对账:
   * 记录是跨页共享的, 只读一次会让两个页面各按自己的旧记录压制。
   */
  const onStorage = (event: Event): void => {
    if ((event as StorageEvent).key !== PANEL_STATE_STORAGE_KEY) return
    records.clear()
    for (const record of loadRecords(storage)) records.set(recordKey(record.sessionId, record.callId), record)
    prune()
    scheduleReconcile()
  }
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage)
  /*
   * 装载时先尝试接上会话状态: 拿到就订阅并立刻对一次账(刷新后宿主可能已经把
   * continued 行的卡片重新发布出来了); 还没就绪就交给下一次调用重试。
   */
  ensureWatch()
  scheduleReconcile()

  const state: PanelState = {
    decide,
    collapse(sessionId, callId, mode) {
      const key = recordKey(sessionId, callId)
      const existing = records.get(key)
      const record: PanelRecord = existing ?? {
        sessionId,
        callId,
        mode: mode === 'block' ? 'block' : 'allow',
        at: now(),
        suppressions: 0,
        lastSuppressAt: 0,
      }
      record.mode = mode === 'block' ? 'block' : 'allow'
      record.at = now()
      const card = findCard(sessionId, callId)
      if (card !== undefined) record.objectId = objectIdOf(card)
      records.set(key, record)
      prune()
      /* 收起是低频动作, 直接落盘: 防抖期间刷新页面会把刚建立的记录丢掉 */
      writeStorage()
      if (card !== undefined) suppressNow(sessionId, card)
    },
    release(sessionId, callId) {
      const record = records.get(recordKey(sessionId, callId))
      if (record === undefined) return
      /*
       * 只在真的撤过座时才把卡片放回去: 没撤过的卡片本来就在座位上,
       * 再 reveal 一次会让宿主重新发布同一个对象, 卡片被卸载重挂, 正在填的内容会闪一下。
       */
      if (record.dismissed === true) handBack(sessionId, callId)
      else releaseRecord(recordKey(sessionId, callId))
    },
    suppressNow,
    dispose() {
      disposed = true
      off?.()
      if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage)
      if (persistTimer !== undefined) clearTimeout(persistTimer)
      persistTimer = undefined
      /* 卸载前把内存态落盘: 收起状态要跨刷新保留 */
      writeStorage()
      records.clear()
      lastSeen.clear()
      selfDismissedAt.clear()
    },
  }
  return state
}
