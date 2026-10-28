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
import { awaitDraft, clearDraft, clearInfiniteWait, isInfiniteWait } from '../sync/server'
import {
  ASK_USER_TOOL_NAME,
  DEFAULT_TIMEOUT_SECONDS,
  DRAFT_GRACE_MS,
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
      assertQuestionsPresent(args.questions)
      assertUniqueQuestionIds(args.questions)
      const questions = args.questions.map((question) => ({
        id: question.id,
        question: question.question,
        ...(question.header === undefined ? {} : { header: question.header }),
        ...(question.options === undefined
          ? {}
          : { options: question.options.map((option) => ({ ...option })) }),
        ...(question.multi_select === undefined ? {} : { multiSelect: question.multi_select }),
      }))
      if (timeoutSeconds === -1) {
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
      }
      if (exec.agent === undefined) throw new Error('timed questions require a live agent')
      const timeoutMs = timeoutSeconds * 1000
      const wait = ctx.userQuestions.askTimed(
        {
          questions,
          agent: exec.agent,
          signal: exec.signal,
        },
        exec.callId,
        timeoutMs,
      )
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
      const pendingResult = async (
        callId: string,
        checkInfinite: boolean,
      ): Promise<{
        pending: true
        callId: string
        message: string
        draft?: Array<{ id: string; selected: string[]; custom?: string }>
      } | null> => {
        const draft = await awaitDraft(callId, DRAFT_GRACE_MS)
        if (checkInfinite && infiniteEnabled && isInfiniteWait(callId)) return null
        /*
         * draft 为 undefined 表示宽限期内没有等到任何上报, 按无草稿结算;
         * 空数组表示客户端明确上报过"确实没有草稿", 同样按无草稿结算, 但不必再等。
         */
        if (draft === undefined || draft.length === 0) {
          return { pending: true, callId, message: TIMEOUT_PENDING_NOTICE }
        }
        /*
         * 客户端按顺序上报草稿(它不知道题目的 id), 这里按提问顺序把序号对应回 id,
         * 顺序之外的条目直接丢弃, 免得给模型一份对不上的草稿。
         */
        const mapped: Array<{ id: string; selected: string[]; custom?: string }> = []
        for (const item of draft) {
          const question = questions[item.index]
          if (question === undefined) continue
          mapped.push({
            id: question.id,
            selected: [...item.selected],
            ...(item.custom === undefined ? {} : { custom: item.custom }),
          })
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
        const result = await Promise.race([wait, expired])
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
          const settledPending = await pendingResult(settled.callId, false)
          return settledPending ?? { pending: true, callId: settled.callId, message: TIMEOUT_PENDING_NOTICE }
        }
        /*
         * 到期时先等一小段宽限时间, 等客户端把草稿快照送上来;
         * 宽限期内若到达「无限等待」, 说明用户是在到期瞬间点的, 这一轮还想继续等,
         * 这时回到等待里, 不按超时结算, 否则界面显示「已暂停」而模型这边已经超时, 两边对不上。
         */
        const pending = await pendingResult(result.callId, true)
        if (pending !== null) return pending
        const again = await wait
        if (!('pending' in again)) return toAnswers(again)
        const second = await pendingResult(again.callId, false)
        return second ?? { pending: true, callId: again.callId, message: TIMEOUT_PENDING_NOTICE }
      } finally {
        clearInfiniteWait(exec.callId)
        /* 草稿快照随这次调用结束而失效, 不留在服务端等下一轮复用 */
        clearDraft(exec.callId)
        if (timer !== undefined) clearTimeout(timer)
      }
    },
  })
}
