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

/** 兜底范围默认值(界面保留草稿并把超时草稿注入上下文) */
export const DEFAULT_FALLBACK_MODE: FallbackMode = 'both'

/** 倒计时进入警示态的剩余秒数默认值(最后数秒红字闪烁) */
export const DEFAULT_WARNING_SECONDS = 5

/** 警示秒数下限 */
export const MIN_WARNING_SECONDS = 1

/** 警示秒数上限 */
export const MAX_WARNING_SECONDS = 60

/** 提问等待时长默认值(秒);仅在本插件接管提问等待时生效 */
export const DEFAULT_TIMEOUT_SECONDS = 120

/** 默认启用卡片增强(倒计时、无限等待按钮、单选底色、提问气泡、超时锁定) */
export const DEFAULT_CARD_ENHANCEMENTS = true

/** 默认启用「无限等待」按钮与点击后的暂停行为 */
export const DEFAULT_INFINITE_WAIT = true

/** 默认启用超时草稿兜底 */
export const DEFAULT_DRAFT_FALLBACK = true

/** 配置区块的插槽名: 插件级(插件详情页顶部), 不落在「包含的组件」的行里 */
export const SETTINGS_SLOT = 'plugins.bundle.config'

/** 插件配置的设置命名空间, 等于 cordis.patch.yml 里的行 id, 两处必须保持一致 */
export const SETTINGS_NAMESPACE = 'question-timeout-protection'

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
 * 语义要点: 本轮提问已超时、用户没有正式提交, 但输入草稿保留了下来;
 * 草稿足够完整时可以据此继续任务, 最后必须告知用户出现过超时以及对该草稿的处理与决策。
 */
export const TIMEOUT_PENDING_NOTICE =
  '该轮提问已超时,用户没有正式提交,但输入草稿保留了下来。如果草稿足够完整可以继续任务,但是最后一定要告知用户出现过提问超时以及你对该超时携带的草稿的处理和决策。'

/** 草稿文本里已选选项行的前缀 */
export const DRAFT_SELECTED_LABEL_ZH = '已选: '
export const DRAFT_SELECTED_LABEL_EN = 'Selected: '

/** 草稿文本里自由输入行的前缀 */
export const DRAFT_CUSTOM_LABEL_ZH = '补充: '
export const DRAFT_CUSTOM_LABEL_EN = 'Additional: '

/** 是否把超时草稿注入对话上下文 */
export function injectsContext(mode: FallbackMode): boolean {
  return mode === 'context' || mode === 'both'
}

/** 宿主提问卡片的容器选择器(容器带 data-question-key) */
export const QUESTION_CARD_SELECTOR = '[data-question-key]'

/** 卡片 key 前缀,宿主形如 question:<sessionId>:<callId> */
export const QUESTION_CARD_KEY_PREFIX = 'question:'

/** 宿主提问卡片右上角操作区(类名带构建哈希,按后缀匹配) */
export const HEADER_ACTIONS_SELECTOR = '[class*="_headerActions"]'

/** 宿主提问卡片底部按钮区(提交/下一题/跳过) */
export const CARD_FOOTER_ACTIONS_SELECTOR = '[class*="_footerActions"]'

/** 宿主提问卡片的选项容器 */
export const CARD_OPTIONS_SELECTOR = '[class*="_options"]'

/** 宿主提问卡片内的输入控件 */
export const CARD_INPUT_SELECTOR = 'textarea, input'

/** 卡片内可点击的控件 */
export const CARD_BUTTON_SELECTOR = 'button'

/** 宿主倒计时与等待状态文本所在元素的选择器(类名带构建哈希,按后缀匹配) */
export const WAIT_STATUS_SELECTOR = '[class*="_waitStatus"]'

/**
 * 宿主倒计时文案的解析规则: 运行态与暂停态并列, 中文与英文并列。
 * 宿主在用户交互(选中选项等)后会切到暂停态文案, 两套都要能读出剩余秒数。
 */
export const COUNTDOWN_PATTERNS: readonly RegExp[] = [
  /(\d+)\s*秒后(?:继续工作|超时|继续)/,
  /剩余\s*(\d+)\s*秒/,
  /(?:Continuing in|Timeout in) (\d+)s/,
  /Paused · (\d+)s remaining/,
]

/** 宿主「会一直等你回答」的等待文案, 中文与英文 */
export const HELD_PATTERN = /会一直等你回答|Waiting until you answer/

/** 宿主「已继续工作, 仍可回答」的晚回复文案, 中文与英文 */
export const CONTINUED_PATTERN = /已继续工作|Work continued/

/** 宿主「慢慢回答」控件的文案(中文与英文), 用于隐藏该控件 */
export const TAKE_TIME_TEXTS: readonly string[] = ['慢慢回答', 'Take time']

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

/** 宿主提问工具行「回答」按钮的文案(中文与英文),超时后隐藏以免重新打开问答框 */
export const ASK_REOPEN_LABELS: readonly string[] = ['回答', 'Answer']

/** 草稿悬浮卡片与气泡之间的间距(px) */
export const DRAFT_PANEL_OFFSET = 8

/** 草稿悬浮卡片与视口边缘的最小间距(px) */
export const DRAFT_PANEL_MARGIN = 8

/** 隐藏宿主控件时附加的类名 */
export const HIDDEN_CONTROL_CLASS = 'dqtp-host-control-hidden'

/** 提问工具调用行的选择器(宿主 tool 行根节点) */
export const ASK_ROW_SELECTOR = 'div[data-tool="ask_user_question"]'

/** 工具调用行的 callId 属性(宿主 ToolCall 包裹层) */
export const TOOL_CALL_ID_ATTRIBUTE = 'data-chat-call-id'

/** 工具调用行的 callId 选择器 */
export const TOOL_CALL_ID_SELECTOR = '[data-chat-call-id]'

/** 宿主工具行里打开提问面板的气泡按钮(类名带构建哈希,按后缀匹配) */
export const PANEL_BUTTON_SELECTOR = 'button[class*="_panelButton"]'

/** 插件自绘倒计时的属性名(值形如 question:<sessionId>:<callId>) */
export const COUNTDOWN_ATTRIBUTE = 'data-dqtp-countdown'

/** 插件自绘「无限等待」按钮的类名 */
export const INFINITE_BUTTON_CLASS = 'dqtp-infinite-wait'

/** 插件自绘「提问标识气泡」的类名 */
export const BUBBLE_BUTTON_CLASS = 'dqtp-question-bubble'

/** 插件自绘「提问标识气泡」的选择器 */
export const BUBBLE_BUTTON_SELECTOR = 'button.' + BUBBLE_BUTTON_CLASS

/** 「提问标识气泡」的状态属性: 仅在已记录超时草稿时出现 */
export const BUBBLE_STATE_ATTRIBUTE = 'data-dqtp-bubble'

/** 气泡草稿态取值 */
export const BUBBLE_STATE_DRAFT = 'draft'


/** 进入警示态时给倒计时附加的类名 */
export const COUNTDOWN_WARNING_CLASS = 'dqtp-countdown-warning'

/** 「无限等待」暂停态给倒计时附加的类名 */
export const COUNTDOWN_PAUSED_CLASS = 'dqtp-countdown-paused'

/** 超时锁定卡片时附加的类名 */
export const CARD_LOCKED_CLASS = 'dqtp-card-locked'

/** 注入样式所用 style 元素的 id */
export const COUNTDOWN_STYLE_ID = 'dqtp-countdown-warning-style'

/** 只读草稿面板的元素 id */
export const DRAFT_PANEL_ID = 'dqtp-draft-panel'

/** 客户端状态同步端点端口(只监听回环地址) */
export const SYNC_PORT = 47831

/** 客户端状态同步端点路径 */
export const SYNC_PATH = '/question-timeout-protection/state'

/** 宿主保存分题草稿的 localStorage 键前缀(其后拼会话 id) */
export const HOST_DRAFT_STORAGE_PREFIX = 'dsh.user-questions.drafts.v1'

/** 卡片底部提交按钮的文案(中文与英文) */
export const SUBMIT_TEXTS: readonly string[] = ['提交', 'Submit']

/** 卡片底部下一题按钮的文案(中文与英文) */
export const NEXT_QUESTION_TEXTS: readonly string[] = ['下一题', 'Next']

/** 卡片底部跳过按钮的文案(中文与英文) */
export const SKIP_QUESTION_TEXTS: readonly string[] = ['跳过', 'Skip']

/** 倒计时文案模板,{seconds} 由剩余秒数替换 */
export const COUNTDOWN_TEXT_ZH = '{seconds}秒后超时'

/** 倒计时文案模板(英文) */
export const COUNTDOWN_TEXT_EN = 'Timeout in {seconds}s'

/** 「无限等待」暂停后的倒计时文案(中文) */
export const COUNTDOWN_PAUSED_TEXT_ZH = '已暂停'

/** 「无限等待」暂停后的倒计时文案(英文) */
export const COUNTDOWN_PAUSED_TEXT_EN = 'Paused'

/** 「无限等待」按钮文案(中文) */
export const INFINITE_WAIT_LABEL_ZH = '无限等待'

/** 「无限等待」按钮文案(英文) */
export const INFINITE_WAIT_LABEL_EN = 'Wait indefinitely'



/** 「提问标识气泡」文案(中文),已记录超时草稿时显示 */
export const BUBBLE_DRAFT_LABEL_ZH = '提问·超时草稿'

/** 「提问标识气泡」文案(英文),已记录超时草稿时显示 */
export const BUBBLE_DRAFT_LABEL_EN = 'Question · timed-out draft'

/** 只读草稿面板标题(中文) */
export const DRAFT_PANEL_TITLE_ZH = '超时草稿(只读)'

/** 只读草稿面板标题(英文) */
export const DRAFT_PANEL_TITLE_EN = 'Timed-out draft (read only)'

/** 只读草稿面板的说明(中文),提示该次提问已结束 */
export const DRAFT_PANEL_NOTE_ZH = '该次提问已超时结束, 不能继续回答; 以下只是超时时的草稿内容。'

/** 只读草稿面板的说明(英文) */
export const DRAFT_PANEL_NOTE_EN =
  'This question batch expired and can no longer be answered; the content below is only the draft as it stood at the timeout.'

/** 只读草稿面板没有可展示内容时的提示(中文) */
export const DRAFT_PANEL_EMPTY_ZH = '超时那一刻没有已选选项或已输入内容。'

/** 只读草稿面板没有可展示内容时的提示(英文) */
export const DRAFT_PANEL_EMPTY_EN = 'No option was selected and no text had been entered at the timeout.'

/** 只读草稿面板的关闭按钮文案(中文) */
export const DRAFT_PANEL_CLOSE_ZH = '关闭'

/** 只读草稿面板的关闭按钮文案(英文) */
export const DRAFT_PANEL_CLOSE_EN = 'Close'

/** 只读草稿面板里某题没有作答时的提示(中文) */
export const DRAFT_PANEL_UNANSWERED_ZH = '未作答'

/** 只读草稿面板里某题没有作答时的提示(英文) */
export const DRAFT_PANEL_UNANSWERED_EN = 'Not answered'
