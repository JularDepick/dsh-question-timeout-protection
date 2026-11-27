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

/**
 * 超时后是否保留再次回答的入口:
 * allow 保留宿主原生的「回答」入口与等待提示, 用户可以在超时后补交答复;
 * block 锁定并收起卡片, 同时隐藏宿主入口与等待文案, 这一轮不再接受作答。
 */
export const LATE_ANSWER_MODES = ['allow', 'block'] as const

/** 再次回答的取值类型 */
export type LateAnswerMode = (typeof LATE_ANSWER_MODES)[number]

/** 再次回答的默认值: 保留宿主入口, 超时不让用户彻底失去作答机会 */
export const DEFAULT_LATE_ANSWER: LateAnswerMode = 'allow'

/** 是否保留超时后的再次回答入口 */
export function allowsLateAnswer(mode: LateAnswerMode): boolean {
  return mode === 'allow'
}

/** 倒计时进入警示态的剩余秒数默认值(最后数秒红字闪烁) */
export const DEFAULT_WARNING_SECONDS = 5

/** 警示秒数下限 */
export const MIN_WARNING_SECONDS = 1

/** 警示秒数上限 */
export const MAX_WARNING_SECONDS = 60

/** 提问等待时长默认值(秒);仅在本插件接管提问等待时生效 */
export const DEFAULT_TIMEOUT_SECONDS = 120

/** 默认启用卡片增强(倒计时、无限等待按钮、单选底色、提问气泡、隐藏宿主控件); 超时后的锁卡与收尾由超时草稿兜底驱动 */
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
 * 语义要点: 只说明本轮提问已超时、用户没有正式提交, 不对草稿做任何断言 ——
 * 草稿为空时不该告诉模型"草稿保留了下来"; 有草稿时草稿走 draft 字段随本结果一起回来。
 */
export const TIMEOUT_PENDING_NOTICE = '该轮提问已超时,用户没有正式提交; '

/*
 * 超时后的作答状态说明, 由工具按配置里的 lateAnswer 择一拼接:
 * allow 时宿主仍保留「回答」入口, 答复会作为一条用户消息送达;
 * block 时卡片已被插件关掉并锁定, 不能再引导用户回去作答。
 */
export const TIMEOUT_PENDING_ANSWERABLE_NOTICE =
  '界面可能已经收起这张卡片, 也可能仍可作答 —— 用户之后补交的答复会作为一条用户消息送达, 请勿把超时本身或草稿当成用户的确认; '

/** 不保留再次回答入口时的对应说明 */
export const TIMEOUT_PENDING_SEALED_NOTICE =
  '本轮提问的卡片已由插件关闭并锁定, 界面不再提供再次作答的入口, 用户若要补充内容会另行发送消息, 请不要提示用户回去补答; '

/** 超时说明的收尾: 两种作答状态共用 */
export const TIMEOUT_PENDING_CLOSING = '请在回复末尾告知用户这次提问已超时。'

/**
 * 没有收到任何草稿快照时的说明。
 * 与「收到空草稿」不同: 后者表示用户确实没写, 前者是快照没送达, 模型不能据此断定用户没输入。
 */
export const TIMEOUT_PENDING_MISSING_NOTICE =
  '该轮提问已超时,本轮没有收到草稿快照(草稿通道不可达或页面未打开), 因此拿不到超时前的输入内容, 请不要据此断言用户没有输入; '

/**
 * 有草稿时随 pending 结果返回给模型的说明。
 * 草稿本身放在 pending 结果的 draft 字段里, 这里只说明它的存在与用法,
 * 避免模型把整段说明当成草稿内容。
 */
export const TIMEOUT_PENDING_DRAFT_NOTICE =
  '该轮提问已超时。用户未正式提交，但留下了一份草稿，详见 draft 字段。请自行判断草稿完整度、决定下一步事项。判断过程不得告知用户，在下一步事项之后总结报告对本次问答的决策结果。'

/**
 * 草稿快照超过通道上限时的提示。
 * 与「草稿无法送达」不同: 那条说的是通道不可用, 这条说的是内容本身太大, 用户需要知道该删减。
 */
export const DRAFT_TOO_LARGE_TEXT_ZH = '草稿过长, 未送达'
export const DRAFT_TOO_LARGE_TEXT_EN = 'Draft too large; not delivered'

/** 草稿文本里已选选项行的前缀 */
export const DRAFT_SELECTED_LABEL_ZH = '已选: {items}'
export const DRAFT_SELECTED_LABEL_EN = 'Selected: {items}'

/** 草稿文本里自由输入行的前缀 */
export const DRAFT_CUSTOM_LABEL_ZH = '补充: {text}'
export const DRAFT_CUSTOM_LABEL_EN = 'Additional: {text}'

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

/** 宿主单选题的自定义回答行(类名带构建哈希, 按后缀匹配) */
export const CUSTOM_ROW_SELECTOR = '[class*="_customRow"]'

/** 插件自绘「自定义回答」单选按钮的类名 */
export const CUSTOM_RADIO_CLASS = 'dqtp-custom-radio'

/** 插件自绘「已保留自定义内容」提示按钮的类名 */
export const CUSTOM_HINT_CLASS = 'dqtp-custom-hint'

/** 选中自定义回答时挂在卡片上的类名: 用它压掉宿主预设选项的选中底色 */
export const CUSTOM_CHOICE_CLASS = 'dqtp-custom-choice'

/** 单选题自定义回答的输入内容与选中状态在 localStorage 里的键 */
export const CUSTOM_STATE_STORAGE_KEY = 'dqtp-custom-choice.v1'

/** 自定义回答状态最多保留多少个调用, 超出按插入顺序淘汰 */
export const MAX_CUSTOM_STATE_CALLS = 64

/** 「自定义回答」单选按钮的文案(中文/英文) */
export const CUSTOM_RADIO_LABEL_ZH = '自定义回答'
export const CUSTOM_RADIO_LABEL_EN = 'Custom answer'

/** 自定义内容已保留但当前未选中时的提示(中文/英文), {text} 替换为内容 */
export const CUSTOM_HINT_ZH = '已保留自定义内容: {text}(点这里选用)'
export const CUSTOM_HINT_EN = 'Custom answer kept: {text} (click to use it)'

/** 卡片输入框选择器 */
export const CARD_INPUT_SELECTOR = 'textarea, input'

/** 卡片内可点击的控件 */
export const CARD_BUTTON_SELECTOR = 'button'

/** 宿主倒计时与等待状态文本所在元素的选择器(类名带构建哈希,按后缀匹配) */
export const WAIT_STATUS_SELECTOR = '[class*="_waitStatus"]'

/**
 * 宿主等待状态文案的识别子串: 宿主可能把「会一直等你回答」「已继续工作」渲染在别的容器里。
 * 卡片侧与工具行侧是两套文案(工具行取自宿主会话包里的 ask.pending), 中英文都要覆盖;
 * 取值由 scripts/check-translation.mjs 的 HOST_LABEL_BASELINE 逐字核对, 改动时同步那张表。
 */
export const HOST_WAIT_PATTERNS: readonly string[] = [
  '会一直等你回答',
  '已继续工作',
  'Waiting until you answer',
  'Work continued',
  'continued; answer still available',
]

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

/** 判定宿主是否停在暂停态的文案特征: 暂停态下的剩余秒数不是真实到期时间 */
export const PAUSED_TEXT_PATTERNS: readonly RegExp[] = [/已暂停/, /Paused/]

/**
 * 宿主「已经停表」的等待文案: 用户点过「慢慢回答」或开始编辑回答后,
 * 宿主自己的定时器已经停下, 卡片只显示这句提示, 不再渲染倒计时与暂停控件。
 * 与 HOST_WAIT_PATTERNS 分开: 后者还含「已继续工作」这类已结算文案。
 */
export const HOST_HELD_PATTERNS: readonly string[] = ['会一直等你回答', 'Waiting until you answer']

/** 「问答自动无限等待」常开开关的文案(中文与英文): 中文侧带「自动」, 与英文的 Auto 对齐 */
export const AUTO_INFINITE_LABEL_ZH = '问答自动无限等待'
export const AUTO_INFINITE_LABEL_EN = 'Auto wait indefinitely'

/** 常开开关的开启与关闭状态文案(中文与英文) */
export const AUTO_INFINITE_ON_TEXT_ZH = '开'
export const AUTO_INFINITE_ON_TEXT_EN = 'On'
export const AUTO_INFINITE_OFF_TEXT_ZH = '关'
export const AUTO_INFINITE_OFF_TEXT_EN = 'Off'

/** 常开开关的悬停提示(中文与英文) */
export const AUTO_INFINITE_TITLE_ZH = '开启后每次提问都自动进入无限等待, 关闭后回到插件的计时行为'
export const AUTO_INFINITE_TITLE_EN =
  'When on, every question enters indefinite wait automatically; when off, the plugin countdown applies'

/** 常开开关按钮的类名与状态属性 */
export const AUTO_INFINITE_BUTTON_CLASS = 'dqtp-auto-infinite'
export const AUTO_INFINITE_STATE_ATTRIBUTE = 'data-dqtp-auto-infinite'
export const AUTO_INFINITE_STATE_ON = 'on'
export const AUTO_INFINITE_STATE_OFF = 'off'

/** 常开开关的持久化键: 开关状态跨刷新保留 */
export const AUTO_INFINITE_STORAGE_KEY = 'dsh.question-timeout-protection.auto-infinite'

/*
 * 定位宿主模型选择控件: 只按无障碍标签识别, 类名带构建哈希。
 * 取值不改: 宿主 0.2.2-rc.1 至 0.2.2-rc.3 的 trigger.aria 都是「选择模型，当前 {model}」与「Select model, current {model}」,
 * 前缀匹配成立; scripts/check-translation.mjs 对这两个前缀与宿主标签有显式断言, 改动时同步那处登记。
 */
export const MODEL_SELECTOR_BUTTON = 'button[aria-label^="选择模型"], button[aria-label^="Select model"]'

/** 模型选择控件所在的工具栏容器(类名后缀) */
export const COMPOSER_CONTROLS_SELECTOR = '[class*="standardControls"]'

/** 草稿快照保留上限, 超出后丢弃最早的一条 */
export const MAX_KEPT_DRAFTS = 200

/** 扫描去抖时长(毫秒): 流式输出时 mutation 会按帧触发, 合并同一批变更 */
export const SCAN_DEBOUNCE_MS = 120

/** 兜底扫描间隔(毫秒), 防止漏掉宿主未触发 mutation 的更新 */
export const SCAN_INTERVAL_MS = 1000

/** 同时保持的会话投影订阅上限, 超出后淘汰最久没在界面上出现的会话 */
export const MAX_SESSION_SUBSCRIPTIONS = 8

/*
 * 会话离开界面多久后释放它的投影订阅(毫秒)。
 * 按时间而不是按扫描轮次: 扫描同时被 DOM 变更按帧触发, 轮次计数会让实际时长缩到一两分钟。
 */
export const SUBSCRIPTION_IDLE_RELEASE_MS = 10 * 60 * 1000

/* 客户端调用状态容量: 每个调用会留下若干登记, 超出后按最近使用时间淘汰最旧的 */
export const MAX_CLIENT_CALL_STATES = 512

/* 客户端调用状态的存活时长: 超过这个时间没有出现在投影或界面上的登记视为残留 */
export const CALL_STATE_TTL_MS = 30 * 60 * 1000

/** 工具到期后等待客户端上报草稿的宽限时长(毫秒) */
export const DRAFT_GRACE_MS = 3000

/** 单次状态通道请求(取令牌与上报)的超时: 请求挂起时不能让整页通道一直 pending */
export const SYNC_REQUEST_TIMEOUT_MS = 8000

/**
 * 草稿连续上报失败多少次后判定通道不可用。
 * 通道不可用时插件不能按超时收走卡片, 必须把卡片交还宿主, 让用户仍能作答。
 */
export const DRAFT_SYNC_FAILURE_THRESHOLD = 3

/**
 * 草稿超出通道上限后的重试间隔。
 * 用户删减内容后要能恢复上报, 但持续超限时不能每轮都重发一遍同样的长文。
 */
export const DRAFT_TOO_LARGE_RETRY_MS = 5000

/** 草稿无法送达时在卡片上给出的可见提示 */
export const DRAFT_SYNC_FAILED_TEXT_ZH = '草稿无法送达'
export const DRAFT_SYNC_FAILED_TEXT_EN = 'Draft cannot be delivered'

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

/**
 * 收起卡片时点宿主关闭按钮的重试上限。
 * 宿主在提交在途时禁用该按钮, 界面语言文案不符或卡片结构改版时也可能点不到;
 * 重试用尽后把这轮交还宿主, 卡片保持可作答, 不能座位还占着却把卡片藏起来。
 */
export const CARD_DISMISS_ATTEMPTS = 5

/**
 * 两次撤座尝试之间的最小间隔(毫秒), 同时是一次点击后观察宿主是否卸载卡片的窗口。
 * 扫描会被 DOM 变更按帧触发, 没有这个窗口时重试次数会被一口气用光。
 */
export const DISMISS_VERIFY_MS = 500

/*
 * 宿主提问工具行「回答」按钮的文案(中文与英文), 超时后隐藏以免重新打开问答框;
 * 结算后同一按钮变成「查看回答」, 恢复入口时也要认它。
 * ja 的 ask.reopen 与中文同形, 结算后的 ask.review 变成「回答を表示」:
 * 补这条只是让 showHostReopen 认回被隐藏的入口, 不是让装饰链在 ja 界面启用。
 */
export const ASK_REOPEN_LABELS: readonly string[] = ['回答', 'Answer', '查看回答', 'View answers', '回答を表示']

/** 草稿悬浮卡片与气泡之间的间距(px) */
export const DRAFT_PANEL_OFFSET = 8

/** 草稿悬浮卡片与视口边缘的最小间距(px) */
export const DRAFT_PANEL_MARGIN = 8

/** 隐藏宿主控件时附加的类名 */
export const HIDDEN_CONTROL_CLASS = 'dqtp-host-control-hidden'

/**
 * 被插件按文案隐藏的宿主节点标记。
 * 还原时只认这个标记, 不再复判当前文案: 宿主复用同一节点改写文案时也能还原。
 */
export const HIDDEN_WAIT_ATTRIBUTE = 'data-dqtp-host-wait'

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

/*
 * 卡片增强生效时挂在 documentElement 上的类名。
 * 单选选中底色写在静态样式里, 只有挂上这个类才匹配;
 * 关闭卡片增强后连底色也不再出现, 与其它装饰保持同一开关。
 */
export const CARD_ENHANCEMENTS_CLASS = 'dqtp-card-enhancements'

/** 注入样式所用 style 元素的 id */
export const COUNTDOWN_STYLE_ID = 'dqtp-countdown-warning-style'

/** 只读草稿面板的元素 id */
export const DRAFT_PANEL_ID = 'dqtp-draft-panel'

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

/** 状态同步通道不可达时替代倒计时的提示文案(中文) */
export const SYNC_UNAVAILABLE_TEXT_ZH = '无法无限等待'

/** 状态同步通道不可达时替代倒计时的提示文案(英文) */
export const SYNC_UNAVAILABLE_TEXT_EN = 'Cannot wait indefinitely'

/** 「无限等待」按钮文案(英文) */
export const INFINITE_WAIT_LABEL_EN = 'Wait indefinitely'

/** 「提问标识气泡」文案(中文),已记录超时草稿时显示 */
export const BUBBLE_DRAFT_LABEL_ZH = '提问·超时草稿'

/** 「提问标识气泡」文案(英文),已记录超时草稿时显示 */
export const BUBBLE_DRAFT_LABEL_EN = 'Question · timed-out draft'

/** 只读草稿面板标题(中文) */
export const DRAFT_PANEL_TITLE_ZH = '超时草稿'

/** 只读草稿面板标题(英文) */
export const DRAFT_PANEL_TITLE_EN = 'Timed-out draft'

/** 只读草稿面板的说明(中文),提示这一轮提问已结束 */
export const DRAFT_PANEL_NOTE_ZH = '这一轮提问已超时结束; 以下只是超时时的草稿内容'

/** 只读草稿面板的说明(英文) */
export const DRAFT_PANEL_NOTE_EN = 'This round of questions timed out; the content below is only the draft as it stood at the timeout'

/** 只读草稿面板没有可展示内容时的提示(中文) */
export const DRAFT_PANEL_EMPTY_ZH = '超时那一刻没有已选选项或已输入内容'

/** 只读草稿面板没有可展示内容时的提示(英文) */
export const DRAFT_PANEL_EMPTY_EN = 'No option was selected and no text had been entered at the timeout'

/** 只读草稿面板里某题没有作答时的提示(中文) */
export const DRAFT_PANEL_UNANSWERED_ZH = '未作答'

/** 只读草稿面板里某题没有作答时的提示(英文) */
export const DRAFT_PANEL_UNANSWERED_EN = 'Not answered'

/*
 * PTC 模式外层程序的工具名。
 * 该工具的 elapsed-time budget 到期会硬停程序并中止在途的子调用,
 * 因此本插件在子调用里必须把等待收敛到外层剩余预算之内。
 */
export const PTC_RUN_TOOL_NAME = 'run_code'

/** 外层程序未显式声明预算时的兜底值(毫秒), 与宿主 run_code 的缺省预算一致 */
export const DEFAULT_PTC_BUDGET_MS = 120000

/** 在外层预算到期前预留的收尾时间(毫秒): 覆盖最多两次取草稿的宽限期(DRAFT_GRACE_MS)与结算竞态 */
export const PTC_BUDGET_MARGIN_MS = 8000

/** 收敛后的等待时长小于该值时不再开卡片(毫秒): 直接按预算不足结算 */
export const PTC_MIN_WAIT_MS = 2000

/** 外层预算登记的容量上限 */
export const MAX_RUN_BUDGETS = 512

/** 外层预算登记的存活时长: 超过这个时间仍未结算的登记视为残留 */
export const RUN_BUDGET_TTL_MS = 30 * 60 * 1000

/**
 * 外层预算不足以等待作答时的说明(模型侧)。
 * 这一轮没有真正等待, 用户也没看到问题, 因此必须让模型知道重试时要放宽外层预算。
 * 该说明随工具错误返回, 不随 pending 结果: pending 会让宿主投影把调用转成可作答,
 * 与"没有开始等待"矛盾。
 */
export const TIMEOUT_PENDING_BUDGET_NOTICE =
  '外层 run_code 的剩余执行预算不足以等待用户作答, 这次提问没有开始等待, 用户也没有看到问题; 需要提问时请把 run_code 的 timeoutMs 设为大于提问等待时长后重试。'

/**
 * 注入给模型的草稿文本上限(字符): 单题与整轮。
 * 草稿随工具结果进入上下文, 宿主可能带工具结果裁剪(如 PTC 预设的 8192 字符阈值),
 * 超长的草稿会被整段吃掉, 因此插件自己先按上限截断并说明。
 */
export const MAX_DRAFT_QUESTION_CHARS = 1200

/** 整轮草稿的注入上限(字符) */
export const MAX_DRAFT_TOTAL_CHARS = 6000

/** 草稿因上限被截断时的补充说明(模型侧) */
export const TIMEOUT_PENDING_DRAFT_TRUNCATED_NOTICE = '草稿过长, 超过上限的部分已截断。'

/** 工具行根节点的状态属性(宿主 ToolRow 的 data-state) */
export const TOOL_ROW_STATE_ATTRIBUTE = 'data-state'

/** 视为提问已被中断的宿主工具行状态: 失败与中止都不再有可作答的卡片 */
export const TOOL_ROW_FAILED_STATES: readonly string[] = ['error', 'stopped']

