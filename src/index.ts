/*
 * 插件入口
 *
 * 导出 name、inject、apply,装配提问超时保护模块: 在每个 agent 作用域注册
 * 带超时的 ask_user_question,以就近遮蔽宿主的阻塞式提问。
 * 作者: JularDepick
 */

import type { Context } from '@deepseek-ai/cordis'
import { Config } from './config'
import { DEFAULT_PTC_BUDGET_MS, PLUGIN_NAME } from './constants'
import { installRunBudgetTracking } from './ptc/budget'
import { QuestionTimeoutService } from './question/service'
import { registerQuestionSyncRoute, stopQuestionSync } from './sync/server'

export const name = PLUGIN_NAME

export const inject = ['tools', 'userQuestions', 'agents']

export { Config }
export { QuestionTimeoutService } from './question/service'
export { TranslationManager, translation } from './translation'
export type { FallbackMode } from './constants'

/** 插件装配入口 */
export function apply(ctx: Context, config: Config): void {
  const service = new QuestionTimeoutService(ctx, config)
  service.start()
  /*
   * PTC 外层预算感知: run_code 的 elapsed-time budget 到期会中止在途的提问子调用,
   * 因此把每次 run_code 的预算记下来, 让提问工具在子调用里收敛等待时长。
   * 缺省预算优先取宿主 PTC 运行时公布的值, 取不到时用与宿主一致的常量兜底。
   */
  let ptcDefaultBudgetMs = DEFAULT_PTC_BUDGET_MS
  ctx.inject(['ptcRuntime'], (scoped?: Context) => {
    const holder = (scoped ?? ctx) as unknown as { ptcRuntime?: { timeout?: { defaultMs?: unknown } } }
    const value = holder.ptcRuntime?.timeout?.defaultMs
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) ptcDefaultBudgetMs = value
  })
  ctx.effect(() => installRunBudgetTracking(ctx, () => ptcDefaultBudgetMs))
  let syncStarted = false
  /*
   * 状态通道挂在宿主自带的 HTTP 服务上: 同源、免 CORS, 也不会与另一个实例抢端口。
   * 只有网页客户端的部署才有这个服务 —— 宿主自己的客户端模块服务也依赖它,
   * 因此拿不到 webServer 就等于没有网页客户端, 通道随即可用。
   */
  ctx.inject(['webServer'], (scoped?: Context) => {
    /* 回调的入参在不同宿主版本里可能为空, 因此以回调上下文优先、外层 ctx 兜底 */
    const holder = (scoped ?? ctx) as unknown as {
      webServer?: Parameters<typeof registerQuestionSyncRoute>[0]
      effect?: (install: () => () => void) => void
    }
    const webServer = holder.webServer
    if (webServer === undefined) return
    try {
      const off = registerQuestionSyncRoute(webServer)
      syncStarted = true
      holder.effect?.(() => off)
    } catch (error) {
      /* 路由冲突或宿主拒绝注册时降级: 通道不可用, 但插件其余部分照常工作 */
      console.warn(
        '[question-timeout-protection] 状态同步路由注册失败, 「无限等待」与草稿上报在本部署不可用',
        error,
      )
    }
  })
  /*
   * inject 在依赖缺席时只会让回调永不执行, 本身不留痕迹; 若该服务名与目标构建不符,
   * 「无限等待」会在所有部署里静默失效, 因此这里留一条可追的日志。
   */
  const syncProbe = setTimeout(() => {
    if (syncStarted) return
    console.warn(
      '[question-timeout-protection] 未检测到宿主 HTTP 服务, 状态同步通道未启动, 「无限等待」与草稿上报在本部署不可用',
    )
  }, 5000)
  syncProbe.unref?.()
  ctx.effect(() => () => {
    clearTimeout(syncProbe)
    service.dispose()
    stopQuestionSync()
  })
}
