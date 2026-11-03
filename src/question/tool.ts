/*
 * ask_user_question 工具定义
 *
 * 以同名工具就近遮蔽宿主的阻塞式提问: 本定义走 ctx.userQuestions.askTimed,
 * 前台等待到期后返回 pending 结果,该次提问随之结束,模型可以继续独立工作。
 * 作者: JularDepick
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-user-questions'
import type { Config } from '../config'
import { configValue } from '../config-value'
import {
  awaitDraft,
  callQuestionOrder,
  clearCallDeadline,
  clearCallQuestions,
  clearDraft,
  clearInfiniteWait,
  hasSyncChannel,
  isInfiniteWait,
  markCallSettled,
  registerCallDeadline,
  registerCallQuestions,
} from '../sync/server'
import {
  ASK_USER_TOOL_NAME,
  DEFAULT_FALLBACK_MODE,
  DEFAULT_TIMEOUT_SECONDS,
  DRAFT_GRACE_MS,
  injectsContext,
  MAX_TIMEOUT_SECONDS,
  MIN_TIMEOUT_SECONDS,
  TIMED_TIMEOUT_PARAMETER,
  TIMEOUT_PENDING_DRAFT_NOTICE,
  TIMEOUT_PENDING_NOTICE,
} from '../constants'

/* 模型侧工具说明 */
const TOOL_DESCRIPTION =
  'Ask brief, direct, self-contained questions about missing information, preferences, or decisions. Use user-facing terms; assume no knowledge of background work or internal names. Use distinct stable question IDs. A timed call that expires before an answer batch returns a pending result: that question batch is closed and the user cannot answer it any more, so decide yourself whether to ask again.'

/* 模型侧问题数组说明 */
const QUESTIONS_DESCRIPTION = 'Questions to ask the user.'

/*
 * 判定并规范化本次调用的等待秒数;允许 -1 表示必答(回到阻塞等待)。
 * 模型漏传时用配置里的等待时长兜底而不是报错: 宿主判定 timed 只看工具 schema 是否声明该参数,
 * 因此缺省值同样会进入 timed 等待, 插件自己的计时也能照常生效。
 */
function resolveTimeout(requested: number | undefined, fallback: number): number {
  const raw = requested ?? fallback
  if (raw === -1) return -1
  /* 取整贴合真实等待时长, 不因 90.5 让提问整体报错 */
  const value = Number.isFinite(raw) ? Math.round(raw) : raw
  if (!Number.isInteger(value) || value < MIN_TIMEOUT_SECONDS || value > MAX_TIMEOUT_SECONDS) {
    throw new Error(
      `timeout must be -1 or an integer between ${String(MIN_TIMEOUT_SECONDS)} and ${String(MAX_TIMEOUT_SECONDS)} seconds`,
    )
  }
  return value
}

/*
 * 合并两个中止信号: 任意一个中止, 合并结果就中止。
 */
function linkSignals(first: AbortSignal | undefined, second: AbortSignal): AbortSignal {
  const controller = new AbortController()
  const abort = (): void => {
    if (!controller.signal.aborted) controller.abort()
  }
  if (first?.aborted === true) abort()
  else first?.addEventListener('abort', abort, { once: true })
  if (second.aborted) abort()
  else second.addEventListener('abort', abort, { once: true })
  return controller.signal
}

/* 题目数组不能为空, 空数组没有可等待的内容 */
function assertQuestionsPresent(questions: ReadonlyArray<unknown>): void {
  if (questions.length === 0) throw new Error('questions must contain at least one question')
}

/* 同一调用内的问题 id 必须唯一且非空,否则回答无法定位 */
function assertUniqueQuestionIds(questions: ReadonlyArray<{ id: string }>): void {
  const seen = new Set<string>()
  for (const question of questions) {
    const id = question.id.trim()
    if (id === '') throw new Error('question id must not be empty')
    if (seen.has(id)) throw new Error(`question id ${JSON.stringify(id)} must be unique within this call`)
    seen.add(id)
  }
}

/**
 * 创建本插件的提问工具定义。
 * @param ctx 注册工具的上下文(逐 agent 作用域)
 * @param config 插件配置,提供缺省等待时长
 * @returns 可直接注册到工具注册表的定义
 */
export function createAskUserQuestionTool(ctx: Context, config: Config) {
  return defineTool({
    name: ASK_USER_TOOL_NAME,
    description: TOOL_DESCRIPTION,
    parameters: {
      questions: {
        type: 'array',
        required: true,
        description: QUESTIONS_DESCRIPTION,
        items: {
          type: 'object',
          additionalProperties: true,
          properties: {
            id: {
              type: 'string',
              required: true,
              description: 'Stable id for this question; it is echoed in the answer.',
            },
            question: {
              type: 'string',
              required: true,
              description: 'The specific question to ask the user.',
            },
            header: {
              type: 'string',
              description: 'Optional short heading for the question, such as "Confirm" or "Choose Mode".',
            },
            detail: {
              type: 'string',
              description:
                'Optional supporting detail rendered with the question but kept out of the option labels, such as a plan or a long explanation.',
            },
            intent: {
              type: 'object',
              additionalProperties: true,
              description:
                'Optional presentation intent for capable UIs. Currently the only tag is plan-review, which needs approve (the option label that accepts it); a UI that does not know the tag renders the generic option list.',
              properties: {
                kind: {
                  type: 'string',
                  required: true,
                  description: 'Intent tag. Currently only "plan-review".',
                },
                approve: {
                  type: 'string',
                  description: 'For plan-review: the option label that approves the plan; every other option declines it.',
                },
                callId: {
                  type: 'string',
                  description: 'For plan-review: the logged tool call whose arguments contain the reviewed plan.',
                },
              },
            },
            options: {
              type: 'array',
              description:
                'Optional choices to show the user. If you recommend one, put it first and append "(Recommended)" to that label.',
              items: {
                type: 'object',
                additionalProperties: true,
                properties: {
                  label: {
                    type: 'string',
                    required: true,
                    description: 'Short user-facing option label.',
                  },
                  description: {
                    type: 'string',
                    description: 'One sentence explaining the tradeoff or impact.',
                  },
                },
              },
            },
            multi_select: {
              type: 'boolean',
              description: 'Whether the user may select more than one option. Defaults to false.',
            },
          },
        },
      },
      [TIMED_TIMEOUT_PARAMETER]: {
        type: 'integer',
        description: `Wait seconds for the entire question batch (default ${String(configValue(config.timeoutSeconds) ?? DEFAULT_TIMEOUT_SECONDS)}). Pass -1 only when an answer is required before proceeding.`,
      },
    },
    output: {
      schema: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              pending: {
                type: 'boolean',
                enum: [true],
                required: true,
                description: 'True when the foreground wait expired before the user submitted an answer batch.',
              },
              callId: {
                type: 'string',
                required: true,
                description: 'Tool call whose unanswered questions remain pending.',
              },
              message: {
                type: 'string',
                required: true,
                description: 'How to continue while the questions stay answerable.',
              },
              draft: {
                type: 'array',
                description:
                  'Unsubmitted draft the user had entered when the wait expired; one item per question, empty when there was no draft.',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    id: {
                      type: 'string',
                      required: true,
                      description: 'Stable question id echoed from the request.',
                    },
                    selected: {
                      type: 'array',
                      required: true,
                      items: { type: 'string' },
                      description: 'Option labels the user had selected; empty with no custom means the question was left blank.',
                    },
                    custom: {
                      type: 'string',
                      description: 'Free-form text the user had typed for this question.',
                    },
                  },
                },
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              answers: {
                type: 'array',
                required: true,
                description: 'Submitted answer batch with one item per question.',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    id: {
                      type: 'string',
                      required: true,
                      description: 'Stable question id echoed from the request.',
                    },
                    selected: {
                      type: 'array',
                      required: true,
                      items: { type: 'string' },
                      description: 'Selected option labels; empty with no custom means the question was skipped.',
                    },
                    custom: {
                      type: 'string',
                      description: 'Optional free-form answer; omitted for a skipped question.',
                    },
                  },
                },
              },
            },
          },
        ],
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const timeoutSeconds = resolveTimeout(args.timeout, configValue(config.timeoutSeconds) ?? DEFAULT_TIMEOUT_SECONDS)
      const infiniteEnabled = configValue(config.infiniteWait) ?? true
      /*
       * 草稿是否进入模型上下文由配置决定: 兜底范围为 ui 时只把草稿留在界面里回看,
       * 不随工具返回值交给模型, 免得绕过用户在配置页关掉的「注入到上下文」。
       */
      const injectsDraft = injectsContext(configValue(config.fallback) ?? DEFAULT_FALLBACK_MODE)
      assertQuestionsPresent(args.questions)
      assertUniqueQuestionIds(args.questions)
      /*
       * 逐字段映射而不是整体透传: 宿主用 multiSelect, 模型侧写的是 multi_select。
       * detail 与 intent 是宿主支持的展示字段, 同名遮蔽后若不透传就静默丢失。
       * intent 收窄成宿主认识的那个标签: 不认识的标签宿主会当普通选项列表渲染,
       * 但类型上只接受 plan-review, 因此只在这一种情形透传。
       */
      /*
       * 只透传 approve: intent.callId 在宿主侧是品牌化的工具调用标识,
       * 模型侧给的是普通字符串, 强行透传会在类型上失真; 该字段本来就是可选的记录用途。
       */
      const toIntent = (
        value: { kind?: string; approve?: string } | undefined,
      ): { kind: 'plan-review'; approve: string } | undefined => {
        if (value === undefined || value.kind !== 'plan-review') return undefined
        if (typeof value.approve !== 'string' || value.approve === '') return undefined
        return { kind: 'plan-review', approve: value.approve }
      }
      const questions = args.questions.map((question) => {
        const intent = toIntent(question.intent)
        return {
          id: question.id,
          question: question.question,
          ...(question.header === undefined ? {} : { header: question.header }),
          ...(question.detail === undefined ? {} : { detail: question.detail }),
          ...(question.options === undefined
            ? {}
            : { options: question.options.map((option) => ({ ...option })) }),
          ...(question.multi_select === undefined ? {} : { multiSelect: question.multi_select }),
          ...(intent === undefined ? {} : { intent }),
        }
      })
      if (timeoutSeconds === -1) {
        /*
         * 必答阻塞等待: 这里不走超时结算, 因此不登记到期时刻、也不读草稿快照。
         * 结束时清一次残留登记, 免得调用异常退出后留下没人认领的条目。
         */
        try {
          const answers = await ctx.userQuestions.ask({
            questions,
            ...(exec.agent === undefined ? {} : { agent: exec.agent }),
            signal: exec.signal,
            wait: { callId: exec.callId },
          })
          return {
            answers: answers.answers.map((answer) => ({
              id: answer.id,
              selected: [...answer.selected],
              ...(answer.custom === undefined ? {} : { custom: answer.custom }),
            })),
          }
        } finally {
          clearDraft(exec.callId)
          clearCallQuestions(exec.callId)
          markCallSettled(exec.callId)
        }
      }
      if (exec.agent === undefined) throw new Error('timed questions require a live agent')
      const timeoutMs = timeoutSeconds * 1000
      /*
       * 把本轮提问的权威到期时刻登记到状态通道: 客户端在到期瞬间上报的「无限等待」
       * 要按这个时刻判定是否已经过期, 不能用客户端自报的时刻。
       */
      registerCallDeadline(exec.callId, Date.now() + timeoutMs)
      registerCallQuestions(exec.callId, questions.map((question) => question.id))
      /*
       * 单独用一个控制器包住宿主等待: 工具结算后要把这次等待释放掉,
       * 否则宿主那边的等待会一直挂着, 用户稍后提交的答案落到无人监听的承诺上,
       * 这次调用也会长期占住宿主的前台等待名额。
       */
      const waitController = new AbortController()
      /*
       * 合并两个中止信号: 任意一个中止, 合并结果就中止。
       * 不用 AbortSignal.any, 它在 Node.js 20.3 之前不存在, 而插件声明的下限是 Node.js 20。
       */
      const waitSignal = linkSignals(exec.signal, waitController.signal)
      const wait = ctx.userQuestions.askTimed(
        {
          questions,
          agent: exec.agent,
          signal: waitSignal,
        },
        exec.callId,
        timeoutMs,
      )
      /*
       * 宿主等待在工具结算后被中止时会拒绝, 这里先挂一个拒绝处理,
       * 免得这条承诺变成无人接手的未处理拒绝。
       */
      void wait.catch(() => undefined)
      /*
       * 宿主在客户端接管等待后会暂停自己的定时器, 正在编辑的回答还会让卡片取消倒计时;
       * 这里用插件自己的计时器与宿主等待赛跑, 保证到期一定返回 pending 并进入兜底流程。
       */
      let timer: ReturnType<typeof setTimeout> | undefined
      const expired = new Promise<{ pending: true; callId: string }>((resolve) => {
        timer = setTimeout(() => resolve({ pending: true, callId: exec.callId }), timeoutMs)
      })
      const toAnswers = (result: { answers: ReadonlyArray<{ id: string; selected: readonly string[]; custom?: string }> }) => ({
        answers: result.answers.map((answer) => ({
          id: answer.id,
          selected: [...answer.selected],
          ...(answer.custom === undefined ? {} : { custom: answer.custom }),
        })),
      })
      /*
       * 超时结果: 客户端在用户编辑卡片时就把草稿快照持续上报到状态通道,
       * 到期时在这里取回最新的一份, 随 pending 结果一起交给模型 ——
       * 草稿因此走的是工具返回值这条通道, 不再依赖事后的晚回复注入。
       */
      /*
       * 到期结果的生成。
       * 先等一小段宽限时间, 等客户端把草稿快照送上来; 宽限期内如果「无限等待」的
       * 状态到达了(用户在到期瞬间点了无限等待), 说明这一轮提问其实还想继续等,
       * 这时不能按超时结算, 返回 null 让调用方继续阻塞等待。
       */
      /*
       * 草稿只能取一次: 到期结果可能同时被竞态的两条臂生成, 而 awaitDraft 取走即删除,
       * 第二条臂会拿到 undefined, 于是模型收到的超时结果里没有草稿。
       * 这里按 callId 缓存同一个承诺, 多条臂共享同一份结果。
       */
      const draftCache = new Map<string, Promise<Awaited<ReturnType<typeof awaitDraft>>>>()
      const loadDraft = (callId: string): Promise<Awaited<ReturnType<typeof awaitDraft>>> => {
        const cached = draftCache.get(callId)
        if (cached !== undefined) return cached
        const created = awaitDraft(callId, DRAFT_GRACE_MS)
        draftCache.set(callId, created)
        return created
      }
      const pendingResult = async (
        callId: string,
        checkInfinite: boolean,
      ): Promise<{
        pending: true
        callId: string
        message: string
        draft?: Array<{ id: string; selected: string[]; custom?: string }>
      } | null> => {
        /*
         * 「无限等待」的判定要先做: 它只查状态通道, 不需要等草稿快照。
         */
        if (checkInfinite && infiniteEnabled && isInfiniteWait(callId)) return null
        /*
         * 兜底范围为 ui 时草稿不进模型上下文, 客户端也不会上报快照,
         * 这时不必等宽限期, 直接按超时结算, 免得每次超时都白等几秒。
         */
        if (!injectsDraft) {
          return { pending: true, callId, message: TIMEOUT_PENDING_NOTICE }
        }
        /*
         * 没有网页客户端的部署(纯命令行 profile)根本没有页面上报草稿,
         * 这时等满宽限期也没有意义, 直接按无草稿结算。
         */
        if (!hasSyncChannel()) {
          return { pending: true, callId, message: TIMEOUT_PENDING_NOTICE }
        }
        /*
         * draft 为 undefined 表示宽限期内没有等到任何上报, 按无草稿结算;
         * 空数组表示客户端明确上报过"确实没有草稿", 同样按无草稿结算, 但不必再等。
         */
        const draft = await loadDraft(callId)
        /*
         * 宽限期内到达的「无限等待」也要认: 用户是在到期那一刻点的,
         * 界面已经冻结成「已暂停」, 这时再按超时结算会让界面与模型状态对不上。
         * 这里返回 null 表示不结算, 调用方会回到等待里。
         */
        if (checkInfinite && infiniteEnabled && isInfiniteWait(callId)) return null
        if (draft === undefined || draft.length === 0) {
          return { pending: true, callId, message: TIMEOUT_PENDING_NOTICE }
        }
        /*
         * 客户端按顺序上报草稿(它不知道题目的 id), 这里按提问顺序把序号对应回 id,
         * 顺序之外的条目直接丢弃, 免得给模型一份对不上的草稿。
         */
        /*
         * 客户端只按序号上报草稿, 这里按权威题目顺序映射回 id;
         * 两边顺序不一致时立刻说明, 免得把草稿挂到错的题目上却看不出问题。
         */
        const authority = callQuestionOrder(callId)
        if (authority !== undefined && draft.some((item) => item.index >= authority.length)) {
          console.warn(
            '[question-timeout-protection] 草稿的题目序号超出本次提问的题目数, 多余的部分已丢弃',
          )
        }
        const mapped: Array<{ id: string; selected: string[]; custom?: string }> = []
        let dropped = 0
        for (const item of draft) {
          const question = questions[item.index]
          if (question === undefined) {
            dropped += 1
            continue
          }
          /*
           * 某一题既没选中项也没有补充内容时不算草稿:
           * 客户端每轮都会上报全量分题快照, 空条目只是"这题没写",
           * 把它当成草稿交给模型, 会让模型以为用户"作答了但什么都没选"。
           */
          const custom = item.custom?.trim() ?? ''
          if (item.selected.length === 0 && custom === '') continue
          mapped.push({
            id: question.id,
            selected: [...item.selected],
            ...(custom === '' ? {} : { custom }),
          })
        }
        if (dropped > 0) {
          console.warn(
            '[question-timeout-protection] 有 ' + String(dropped) + ' 条草稿对不上本次提问的题目, 已丢弃',
          )
        }
        if (mapped.length === 0) return { pending: true, callId, message: TIMEOUT_PENDING_NOTICE }
        return {
          pending: true,
          callId,
          message: TIMEOUT_PENDING_DRAFT_NOTICE,
          draft: mapped,
        }
      }
      try {
        /*
         * 第一臂必须区分两种结束: 宿主明确拒绝(CALLER_NOT_LIVE / DELEGATED_CALLER /
         * BAD_TIMEOUT / DUPLICATE_WAIT)与等待被中止。前者要让模型看到真实原因,
         * 后者才按超时结算 —— 一律当成超时会把"用户根本没看到提问"说成"用户没提交"。
         */
        const first = await Promise.race([
          wait.then(
            (value) => ({ kind: 'value' as const, value }),
            (error: unknown) => ({ kind: 'error' as const, error }),
          ),
          expired.then((value) => ({ kind: 'expired' as const, value })),
        ])
        if (first.kind === 'error') {
          /*
           * 宿主等待被中止或明确拒绝时原样抛出, 与宿主自带的阻塞提问保持一致:
           * 这两种都不是"用户超时没提交", 伪装成超时会让模型收到与事实相反的结论,
           * 客户端还会把一张其实没人作答的卡片锁死收起。
           */
          throw first.error
        }
        const result = first.value
        if (!('pending' in result)) return toAnswers(result)
        /*
         * 客户端已点击「无限等待」时, 状态同步通道会先登记该调用;
         * 此时不返回 pending, 继续等待用户提交, 模型工作被阻塞。
         */
        if (infiniteEnabled && isInfiniteWait(exec.callId)) {
          const settled = await wait
          if (!('pending' in settled)) return toAnswers(settled)
          /*
           * 宿主自己也已经把这批问题结算成超时了, 无可再等;
           * 这时按超时出结果, 不再因为「无限等待」继续挂着。
           */
          /*
           * 宿主自己已经把这批问题结算成超时了, 这时再查一次「无限等待」:
           * 用户若在到期瞬间点了无限等待, 而上报刚好在这个时刻到达, 就按继续等待处理,
           * 否则界面显示「已暂停」而模型这边已经超时, 两边对不上。
           */
          if (infiniteEnabled && isInfiniteWait(exec.callId)) {
            const stillWaiting = await wait
            if (!('pending' in stillWaiting)) return toAnswers(stillWaiting)
            return { pending: true, callId: settled.callId, message: TIMEOUT_PENDING_NOTICE }
          }
          const settledPending = await pendingResult(settled.callId, false)
          return settledPending ?? { pending: true, callId: settled.callId, message: TIMEOUT_PENDING_NOTICE }
        }
        /*
         * 到期时先等一小段宽限时间, 等客户端把草稿快照送上来;
         * 宽限期内若到达「无限等待」, 说明用户是在到期瞬间点的, 这一轮还想继续等,
         * 这时回到等待里, 不按超时结算, 否则界面显示「已暂停」而模型这边已经超时, 两边对不上。
         */
        /*
         * 宽限期内用户的真实提交优先: 宿主在用户编辑回答时会暂停自己的定时器,
         * 所以"插件计时器到期而宿主仍在等待"正是填表时的常态。
         * 这里让宿主等待与到期结果并行, 谁先给出答案就按谁的结果走,
         * 不再把用户已经提交的答案丢在一边。
         */
        const settled = await Promise.race([
          /*
           * 宿主等待被中止时会拒绝, 这里把它当成一种结果而不是让整条竞态链跟着失败,
           * 否则 finally 里释放等待的动作会变成一条未处理的拒绝。
           */
          wait.then(
            (value) => ({ kind: 'answer' as const, value }),
            /* 拒绝先收成结果, 免得另一条臂胜出时这里留下未处理的拒绝 */
            (error: unknown) => ({ kind: 'error' as const, value: error }),
          ),
          pendingResult(result.callId, true).then((value) => ({ kind: 'pending' as const, value })),
        ])
        if (settled.kind === 'error') {
          /* 中止或宿主拒绝同样原样抛出, 不伪装成超时 */
          throw settled.value
        }
        if (settled.kind === 'answer') {
          if (!('pending' in settled.value)) return toAnswers(settled.value)
        } else if (settled.value !== null) {
          return settled.value
        }
        /*
         * 到期结果没有产出(宽限期内到达了「无限等待」): 回到宿主等待里继续等。
         */
        const again = await wait
        if (!('pending' in again)) return toAnswers(again)
        const second = await pendingResult(again.callId, false)
        return second ?? { pending: true, callId: again.callId, message: TIMEOUT_PENDING_NOTICE }
      } finally {
        /* 释放宿主那边还没结算的前台等待 */
        waitController.abort()
        clearInfiniteWait(exec.callId)
        clearCallDeadline(exec.callId)
        clearCallQuestions(exec.callId)
        /* 草稿快照随这次调用结束而失效, 不留在服务端等下一轮复用 */
        clearDraft(exec.callId)
        /*
         * 留一条结算标记: 结算之后到达的「无限等待」要按过期处理。
         * 没有它的话, 权威到期时刻已经清掉, 晚到的上报会退回客户端自报的时刻并被当成有效,
         * 结果就是界面显示「已暂停」而模型已经拿到超时结果。
         */
        markCallSettled(exec.callId)
        if (timer !== undefined) clearTimeout(timer)
      }
    },
  })
}
