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
import { clearInfiniteWait, isInfiniteWait } from '../sync/server'
import {
  ASK_USER_TOOL_NAME,
  DEFAULT_TIMEOUT_SECONDS,
  MAX_TIMEOUT_SECONDS,
  MIN_TIMEOUT_SECONDS,
  TIMED_TIMEOUT_PARAMETER,
  TIMEOUT_PENDING_NOTICE,
} from '../constants'

/* 模型侧工具说明 */
const TOOL_DESCRIPTION =
  'Ask brief, direct, self-contained questions about missing information, preferences, or decisions. Use user-facing terms; assume no knowledge of background work or internal names. Use distinct stable question IDs. A timed call that expires before an answer batch returns a pending result: that question batch is closed and the user cannot answer it any more, so decide yourself whether to ask again.'

/* 模型侧问题数组说明 */
const QUESTIONS_DESCRIPTION = 'Questions to ask the user.'

/* 判定并规范化本次调用的等待秒数;允许 -1 表示必答(回到阻塞等待) */
function resolveTimeout(requested: number | undefined, fallback: number): number {
  if (requested === undefined) {
    throw new Error(
      `timeout is required: pass the wait seconds explicitly (for example ${String(fallback)}), or -1 when an answer must arrive before you continue`,
    )
  }
  const raw = requested
  if (raw === -1) return -1
  /* 配置里的 timeoutSeconds 允许小数, 这里取整贴合真实等待时长, 不因 90.5 让提问整体报错 */
  const value = Number.isFinite(raw) ? Math.round(raw) : raw
  if (!Number.isInteger(value) || value < MIN_TIMEOUT_SECONDS || value > MAX_TIMEOUT_SECONDS) {
    throw new Error(
      `timeout must be -1 or an integer between ${String(MIN_TIMEOUT_SECONDS)} and ${String(MAX_TIMEOUT_SECONDS)} seconds`,
    )
  }
  return value
}

/* 同一调用内的问题 id 必须唯一,否则回答无法定位 */
function assertUniqueQuestionIds(questions: ReadonlyArray<{ id: string }>): void {
  const seen = new Set<string>()
  for (const question of questions) {
    if (seen.has(question.id)) throw new Error(`question id ${JSON.stringify(question.id)} must be unique within this call`)
    seen.add(question.id)
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
        required: true,
        description: `Required. Wait seconds for the entire question batch; always pass it explicitly (default ${String(configValue(config.timeoutSeconds) ?? DEFAULT_TIMEOUT_SECONDS)} when you have no better value). Pass -1 only when an answer is required before proceeding. Omitting it makes the host treat the batch as a blocking wait and the timeout protection cannot apply.`,
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
      try {
        const result = await Promise.race([wait, expired])
        if ('pending' in result) {
          /*
           * 客户端已点击「无限等待」时, 状态同步通道会先登记该调用;
           * 此时不返回 pending, 继续等待用户提交, 模型工作被阻塞。
           */
          if (infiniteEnabled && isInfiniteWait(exec.callId)) {
            const settled = await wait
            if ('pending' in settled) {
              return { pending: true as const, callId: settled.callId, message: TIMEOUT_PENDING_NOTICE }
            }
            return toAnswers(settled)
          }
          return { pending: true as const, callId: result.callId, message: TIMEOUT_PENDING_NOTICE }
        }
        return toAnswers(result)
      } finally {
        clearInfiniteWait(exec.callId)
        if (timer !== undefined) clearTimeout(timer)
      }
    },
  })
}
