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

/** 默认启用卡片增强(倒计时文案、隐藏收起/展开、超时锁定等) */
export const DEFAULT_CARD_ENHANCEMENTS = true

/** 默认启用「无限等待」与点击后的阻塞行为 */
export const DEFAULT_INFINITE_WAIT = true

/** 默认启用超时草稿兜底 */
export const DEFAULT_DRAFT_FALLBACK = true

/** 插件配置页的插槽名 */
export const SETTINGS_SLOT = 'plugins.row.config'

/** 插件配置页的条目 id */
export const SETTINGS_ENTRY_ID = 'dsh-question-timeout-protection#question-timeout-protection'

/** 插件配置页的文案命名空间 */
export const SETTINGS_LOCALE = 'questionTimeoutProtection'

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
 * 已输入的草稿,由模型自行决定是否重新提问或暂时跳过。
 */
export const TIMEOUT_PENDING_NOTICE =
  'The user did not answer before the wait expired. This is pending, not a skipped answer: the user may still reply. If a later user message carries the content the user had entered before the timeout, decide yourself whether to ask again or to skip these questions for now.'

/** 超时草稿注入消息的前缀(客户端拼装后经晚回复通道送入上下文) */
export const DRAFT_INJECTION_HEADER = '用户回答超时,超时后已输入的内容为如下:'

/** 超时草稿注入消息的后缀,把是否重新提问或跳过的决定权交给模型 */
export const DRAFT_INJECTION_FOOTER = '请自行决定是否重新提问或暂时跳过相关问答'

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

/** 倒计时文案的解析规则(宿主原文与插件改名后的文案, 中文与英文) */
export const COUNTDOWN_PATTERNS: readonly RegExp[] = [/(\d+)\s*秒后(?:继续工作|超时)/, /(?:Continuing in|Timeout in) (\d+)s/]

/** 宿主倒计时暂停文案的解析规则(中文与英文两套) */
export const COUNTDOWN_PAUSED_PATTERNS: readonly RegExp[] = [/(\d+)\s*秒后继续/, /Paused · (\d+)s remaining/]

/** 宿主「慢慢回答」控件的文案到「无限等待」的映射(中文与英文) */
export const TAKE_TIME_LABELS: Readonly<Record<string, string>> = {
  '慢慢回答': '无限等待',
  'Take time': 'Wait indefinitely',
}

/** 宿主问答卡片收起/展开控件的文案(中文与英文), 用于隐藏该控件 */
export const COLLAPSE_CONTROL_LABELS: readonly string[] = [
  '收起问题卡片',
  '展开问题卡片',
  'Collapse the question card',
  'Expand the question card',
]

/** 宿主的「收起问题面板」按钮文案(中文与英文) */
export const CLOSE_PANEL_LABELS: readonly string[] = [
  '收起问题面板，可从工具调用重新打开',
  'Close the panel — reopen it from the tool call',
]

/** 隐藏宿主控件时附加的类名 */
export const HIDDEN_CONTROL_CLASS = 'dqtp-host-control-hidden'

/** 客户端状态同步端点端口(只监听回环地址) */
export const SYNC_PORT = 47831

/** 客户端状态同步端点路径 */
export const SYNC_PATH = '/question-timeout-protection/state'

/** 历史记录里「可重新回答」按钮的文案(中文与英文) */
export const REPLY_LABEL_TEXTS: readonly string[] = [
  '回答先前等待中的问题',
  'Answer a previously pending question',
]

/** 超时并已注入上下文后, 历史记录里显示的只读标记 */
export const TIMED_OUT_INJECTED_MARKER = '回答超时·已注入上下文'

/** ui 模式超时后, 历史记录里显示草稿已保留的只读标记 */
export const TIMED_OUT_UI_MARKER = '回答超时·草稿已保留'

/** 历史草稿在浏览器本地存储中的键前缀 */
export const DRAFT_STORAGE_PREFIX = 'dqtp:draft:'

/** 草稿查看面板的 DOM id */
export const DRAFT_PANEL_ID = 'dqtp-draft-panel'

/** 宿主卡片提交按钮文案(中文与英文) */
export const SUBMIT_TEXTS: readonly string[] = ['提交', 'Submit']

/** 宿主卡片「下一题」按钮文案(中文与英文) */
export const NEXT_QUESTION_TEXTS: readonly string[] = ['下一题', 'Next']

/** 宿主卡片「跳过」按钮文案(中文与英文) */
export const SKIP_QUESTION_TEXTS: readonly string[] = ['跳过', 'Skip']

/** 工具调用行「回答」按钮的文案(中文与英文) */
export const ASK_REOPEN_TEXTS: readonly string[] = ['回答', 'Answer']

/** 工具调用行里超时问题仍可回答的状态文案(中文与英文) */
export const ASK_PENDING_TEXTS: readonly string[] = ['已继续工作，仍可回答', 'continued; answer still available']

/** 超时且没有草稿时的只读标记 */
export const TIMED_OUT_MARKER = '回答超时'
