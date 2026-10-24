/*
 * 全局常量与设计细节
 *
 * 可个性化修改但不影响核心功能的设计细节统一在此处隔离存放,
 * 具体索引同步登记于 AGENTS.md 设计细节段。
 * 作者: JularDepick
 */

/** 插件包名 */
export const PLUGIN_NAME = 'dsh-question-timeout-protection'

/** 默认语言(翻译回退与初始语言) */
export const DEFAULT_LANGUAGE = 'zh-CN'

/** 回退语言,翻译未命中时使用 */
export const FALLBACK_LANGUAGE = 'zh-CN'

/** 翻译文件目录,相对插件包根目录 */
export const TRANSLATION_DIR = 'src/translation'

/**
 * 提问超时后的兜底范围:
 * ui 仅保留到界面;context 仅注入到对话上下文;both 两者同时做。
 */
export const FALLBACK_MODES = ['ui', 'context', 'both'] as const

/** 兜底范围类型 */
export type FallbackMode = (typeof FALLBACK_MODES)[number]

/** 兜底范围默认值(仅保留到界面,不向模型上下文注入内容) */
export const DEFAULT_FALLBACK_MODE: FallbackMode = 'ui'

/** 倒计时进入警示态的剩余秒数默认值(最后数秒红字闪烁) */
export const DEFAULT_WARNING_SECONDS = 5

/** 警示秒数下限 */
export const MIN_WARNING_SECONDS = 1

/** 警示秒数上限 */
export const MAX_WARNING_SECONDS = 60

/** 提问等待时长默认值(秒);仅在本插件接管提问等待时生效 */
export const DEFAULT_TIMEOUT_SECONDS = 120

/** 提问等待时长下限(秒) */
export const MIN_TIMEOUT_SECONDS = 1

/** 提问等待时长上限(秒,与宿主平台定时器上限对齐) */
export const MAX_TIMEOUT_SECONDS = 2147483

/** 本插件接管的工具名,与宿主提问工具同名以就近遮蔽 */
export const ASK_USER_TOOL_NAME = 'ask_user_question'

/**
 * timed 提问的工具参数名。
 * 宿主提问投影依据记录的工具参数中是否存在该字段判定调用为 timed,
 * 因此本插件定义的工具必须声明它,否则超时后的问题不会进入 continued 态。
 */
export const TIMED_TIMEOUT_PARAMETER = 'timeout'

/**
 * 超时后随 pending 结果返回给模型的说明。
 * 语义要点: 这是 pending 而不是跳过;问题仍可回答;随后可能收到用户在超时前
 * 已输入的草稿,应按草稿重新提问而不是当作最终答复。
 */
export const TIMEOUT_PENDING_NOTICE =
  'The question wait expired before an answer batch arrived. This is pending, not a skipped answer: the questions remain answerable and the user may still reply. If a later user message carries text the user had typed before the wait expired, treat that text as the input to ask again with, not as a final answer.'

/** 超时草稿注入消息的前缀(客户端拼装后经晚回复通道送入上下文) */
export const DRAFT_INJECTION_HEADER = '提问等待已超时,以下是我在超时前已经输入但尚未提交的内容:'

/** 超时草稿注入消息的后缀,提示模型按草稿重新提问 */
export const DRAFT_INJECTION_FOOTER = '这不是我对提问的最终答复,请根据以上内容重新向我提问。'

/** 是否把超时草稿注入对话上下文 */
export function injectsContext(mode: FallbackMode): boolean {
  return mode === 'context' || mode === 'both'
}

/** 宿主提问卡片的容器选择器 */
export const QUESTION_CARD_SELECTOR = '[data-question-key]'

/** 宿主提问卡片内等待状态文本所在元素的选择器(类名带构建哈希,按后缀匹配) */
export const WAIT_STATUS_SELECTOR = '[class*="_waitStatus"]'

/** 进入警示态时给倒计时文本附加的类名 */
export const COUNTDOWN_WARNING_CLASS = 'dqtp-countdown-warning'

/** 注入闪烁样式所用 style 元素的 id */
export const COUNTDOWN_STYLE_ID = 'dqtp-countdown-warning-style'

/** 宿主倒计时文案的解析规则(中文与英文两套) */
export const COUNTDOWN_PATTERNS: readonly RegExp[] = [/(\d+)\s*秒后继续工作/, /Continuing in (\d+)s/]

/** 宿主倒计时暂停文案的解析规则(中文与英文两套) */
export const COUNTDOWN_PAUSED_PATTERNS: readonly RegExp[] = [/(\d+)\s*秒后继续/, /Paused · (\d+)s remaining/]
