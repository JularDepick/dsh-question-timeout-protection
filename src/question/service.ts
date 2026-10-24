/*
 * 提问超时保护服务
 *
 * 负责在每个 agent 的作用域里注册本插件的 ask_user_question 工具。
 * 工具注册按作用域分层、就近遮蔽: 预设里宿主的阻塞式提问注册在预设作用域,
 * 注册到 agent.ctx 的同名工具会遮蔽它,因此插件无须改动用户预设。
 * 作者: JularDepick
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Config } from '../config'
import { createAskUserQuestionTool } from './tool'

/* 注册到各 agent 作用域的工具清理函数 */
type Disposer = () => void

export class QuestionTimeoutService {
  private readonly disposers: Disposer[] = []

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
    while (this.disposers.length > 0) {
      const dispose = this.disposers.pop()
      if (dispose !== undefined) dispose()
    }
  }

  /** 在一个 agent 的作用域注册同名提问工具 */
  private registerFor(agent: Agent): void {
    try {
      this.disposers.push(agent.ctx.tools.register(createAskUserQuestionTool(this.ctx, this.config)))
    } catch (error) {
      this.ctx.logger.warn(
        `question-timeout-protection: failed to register the timed ask tool for agent ${String(agent.id)}: ${String(error)}`,
      )
    }
  }
}
