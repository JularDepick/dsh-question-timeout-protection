/*
 * 客户端入口
 *
 * 客户端半身只做宿主提问卡片之外的一层适配: 倒计时、无限等待、超时草稿与气泡,
 * 提问卡片本身仍由宿主 dsh-client-ui-user-questions 渲染。
 * 配置不随客户端模块下发, 因此这里从宿主的 configForms 服务读取实时值,
 * 让配置页的改动立即影响超时行为; 服务缺失或快照瞬时为空时沿用最近一次成功读到的取值,
 * 一次都读不到才回退 schema 默认值。
 * 作者: JularDepick
 */

import type { Config as ConfigModel } from '../config'
import { configValue } from '../config-value'
import {
  DEFAULT_CARD_ENHANCEMENTS,
  DEFAULT_DRAFT_FALLBACK,
  DEFAULT_INFINITE_WAIT,
  DEFAULT_LATE_ANSWER,
  DEFAULT_WARNING_SECONDS,
  LATE_ANSWER_MODES,
  SETTINGS_NAMESPACE,
} from '../constants'
import type { LateAnswerMode } from '../constants'
import { installQuestionTimeoutAdapter } from './adapter'
import type { AdapterContext, AdapterOptions, AdapterOptionsSource } from './adapter'
import { readClientService, registerSettingsPage } from './settings'
import type { ConfigFormLike, FormsLike, SettingsContext } from './settings'

export const name = 'dsh-question-timeout-protection/client'

/**
 * 只硬注入插槽: 适配器真正需要的是插槽能否注册, 会话绑定、状态上报通道、文案与配置表单
 * 一律软取。硬注入任何一项缺失都会让整个客户端 apply 不执行, 连倒计时都会一起消失,
 * 而这些能力缺失时插件本可以降级工作。
 */
export const inject = ['slots']

/* 客户端上下文除适配器需要的面以外,只要求 effect 生命周期钩子与配置页服务 */
type ClientContext = AdapterContext & SettingsContext & {
  effect?: (install: () => () => void) => void
}

/* 把配置归一成适配器选项, 缺失时使用 schema 默认值 */
function resolveOptions(config: Partial<ConfigModel> | undefined): AdapterOptions {
  return {
    warningSeconds: configValue(config?.warningSeconds) ?? DEFAULT_WARNING_SECONDS,
    cardEnhancements: configValue(config?.cardEnhancements) ?? DEFAULT_CARD_ENHANCEMENTS,
    infiniteWait: configValue(config?.infiniteWait) ?? DEFAULT_INFINITE_WAIT,
    draftFallback: configValue(config?.draftFallback) ?? DEFAULT_DRAFT_FALLBACK,
    lateAnswer: configValue(config?.lateAnswer) ?? DEFAULT_LATE_ANSWER,
  }
}

/* 只接受登记过的取值: 快照里的脏值按默认值处理 */
function readLateAnswer(value: unknown): LateAnswerMode | undefined {
  return LATE_ANSWER_MODES.find((mode) => mode === value)
}

/**
 * 构造实时配置来源。
 * 客户端模块不会收到插件配置, 因此以宿主 configForms 的快照为准;
 * 服务缺失或尚未就绪时沿用最近一次成功读到的取值, 一次都读不到才用启动时的默认值。
 */
function createOptionsSource(ctx: ClientContext, base: AdapterOptions): AdapterOptionsSource {
  let form: ConfigFormLike | undefined
  let warnedMissing = false
  const startedAt = Date.now()
  /*
   * 读不到宿主配置时沿用最近一次成功读到的值, 一次都读不到才是 schema 默认值。
   * 直接回退默认值会在快照瞬时为空(配置写入那一轮)或服务短暂不可用时,
   * 悄悄把用户选的 block 换成默认的 allow, 表现为已锁定的卡片被临时还原。
   * 草稿是否进上下文由服务端按它自己的配置决定, 客户端不再据此推算。
   */
  let last: AdapterOptions = { ...base }
  return {
    getOptions(): AdapterOptions {
      try {
        if (form === undefined) {
          form = readClientService<FormsLike>(ctx, 'configForms')?.get(SETTINGS_NAMESPACE)
        }
        const value = form?.getSnapshot()?.value
        if (value === undefined) {
          /*
           * 配置服务可能只是还没就绪, 因此只在装载一段时间后仍然读不到时才提示,
           * 避免开屏那一次误报。
           */
          if (!warnedMissing && Date.now() - startedAt > 5000) {
            warnedMissing = true
            console.warn('[question-timeout-protection] 读不到宿主配置, 本次沿用最近一次读到的取值')
          }
          return last
        }
        /*
         * 只有真的读到布尔值才采用: 快照里的字段可能是半截值或脏值,
         * 退回默认值才不会把卡片增强或无限等待误判成关闭。
         */
        /*
         * 逐字段兜底同样用上一次成功读到的值, 不用 schema 默认值:
         * 半截或脏快照(某个字段缺失/类型变了)若退回默认, 用户选的 block 会瞬间变回 allow。
         */
        last = {
          warningSeconds: typeof value.warningSeconds === 'number' ? value.warningSeconds : last.warningSeconds,
          cardEnhancements:
            typeof value.cardEnhancements === 'boolean' ? value.cardEnhancements : last.cardEnhancements,
          infiniteWait: typeof value.infiniteWait === 'boolean' ? value.infiniteWait : last.infiniteWait,
          draftFallback: typeof value.draftFallback === 'boolean' ? value.draftFallback : last.draftFallback,
          lateAnswer: readLateAnswer(value.lateAnswer) ?? last.lateAnswer,
        }
        return last
      } catch {
        return last
      }
    },
  }
}

export function apply(rawCtx: unknown, config?: Partial<ConfigModel>): void {
  const ctx = rawCtx as ClientContext
  let disposeAdapter: () => void = () => {}
  let disposeSettings: () => void = () => {}
  try {
    disposeAdapter = installQuestionTimeoutAdapter(ctx, createOptionsSource(ctx, resolveOptions(config)))
  } catch (error) {
    console.error('[question-timeout-protection] 卡片适配器安装失败', error)
  }
  try {
    disposeSettings = registerSettingsPage(ctx)
  } catch (error) {
    console.error('[question-timeout-protection] 配置页注册失败', error)
  }
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => disposeAdapter)
    ctx.effect(() => disposeSettings)
  } else {
    /*
     * 拿不到生命周期钩子时保留实例: 立即卸载等于让插件在这个部署里完全失效,
     * 而且没有任何提示, 不如让它继续工作并留下一条可追的日志。
     */
    console.warn('[question-timeout-protection] 客户端缺少 effect 生命周期钩子, 适配器将在页面存续期间常驻')
  }
}
