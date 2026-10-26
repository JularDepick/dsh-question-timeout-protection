/*
 * 提问超时保护服务
 *
 * 负责在每个 agent 的作用域里注册本插件的 ask_user_question 工具。
 * 工具注册按作用域分层、就近遮蔽: 预设里宿主的阻塞式提问注册在预设作用域,
 * 注册到 agent.ctx 的同名工具会遮蔽它,因此插件无须改动用户预设。
 * 补注册与 agent/created 监听会同时命中同一个 agent, 因此按 agent 去重。
 * 作者: JularDepick
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Config } from '../config'
import { createAskUserQuestionTool } from './tool'

export class QuestionTimeoutService {
  /* 每个 agent 对应的工具清理函数, 按 agent id 去重 */
  private readonly perAgent = new Map<string, () => void>()

  constructor(
    private readonly ctx: Context,
    private readonly config: Config,
  ) {}

  /** 建立 agent 创建监听,并为已存在的 agent 补齐工具注册 */
  start(): void {
    this.ctx.effect(() => {
      const offCreated = this.ctx.on(
        'agent/created',
        ({ agent }) => {
          this.registerFor(agent)
          return undefined
        },
        { global: true },
      )
      for (const agent of this.ctx.agents.list()) this.registerFor(agent)
      return () => {
        offCreated()
        this.dispose()
      }
    }, 'question-timeout-protection: per-agent tool')
  }

  /** 释放插件持有的全部工具注册 */
  dispose(): void {
    for (const dispose of this.perAgent.values()) {
      try {
        dispose()
      } catch {
        /* 宿主可能已经先行释放该作用域, 忽略即可 */
      }
    }
    this.perAgent.clear()
  }

  /** 在一个 agent 的作用域注册同名提问工具, 同一 agent 只注册一次 */
  private registerFor(agent: Agent): void {
    const key = String(agent.id)
    if (this.perAgent.has(key)) return
    try {
      this.perAgent.set(key, agent.ctx.tools.register(createAskUserQuestionTool(this.ctx, this.config)))
    } catch (error) {
      this.ctx.logger.warn(
        `question-timeout-protection: failed to register the timed ask tool for agent ${key}: ${String(error)}`,
      )
    }
  }
}
