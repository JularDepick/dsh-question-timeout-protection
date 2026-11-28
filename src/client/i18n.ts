/*
 * 客户端文案
 *
 * 客户端半身的可见文案按浏览器语言选择中英文, 与翻译文件保持同一套措辞。
 * 作者: JularDepick
 */

const ZH = {
  settingsSummary: '提问超时保护',
  fallbackSection: '超时处理',
  fallbackNote: '提问超时后谁还能作答, 以及已经输入的内容怎么处理',
  injectLabel: '注入到上下文',
  injectDesc: '超时前把草稿快照交给服务端, 到期时随工具结果按题带回模型上下文, 由模型自行决定是否重新提问',
  lateAnswerLabel: '超时后仍可回答',
  lateAnswerDesc: '超时后保留宿主的「回答」入口与等待提示, 你之后补交的答复会作为一条用户消息送达模型; 取消勾选则收起卡片并隐藏入口, 这一轮不再接受作答',
  fixedSection: '固定特性',
  fixedNote: '随插件启用状态生效, 本页不提供开关',
  fixedKeepLabel: '界面保留草稿',
  fixedKeepDesc: '超时后把已选选项与已输入内容记入提问行的气泡; 宿主的「回答」入口不可用时可点开只读查看',
  cardEnhancementsLabel: '卡片增强',
  cardEnhancementsDesc: '右上角倒计时与警示闪烁, 单选选项的方形标号填充底色, 提问标识气泡; 只影响界面装饰',
  infiniteWaitLabel: '无限等待',
  infiniteWaitDesc: '倒计时右侧新增「无限等待」按钮, 点击后本次问答倒计时暂停, 直到用户提交',
  draftFallbackLabel: '超时草稿兜底',
  draftFallbackDesc: '超时后按上面的兜底范围处理已输入的内容',
  rejected: '保存被拒绝, 已重新读取宿主配置',
  loading: '正在读取配置',
  unavailable: '当前部署未暴露该配置',
} as const

const EN: Record<keyof typeof ZH, string> = {
  settingsSummary: 'Question timeout protection',
  fallbackSection: 'Timeout handling',
  fallbackNote: 'Who may still answer once the wait expires, and what happens to what you already typed',
  injectLabel: 'Inject into context',
  injectDesc: 'The draft snapshot is sent to the server before the timeout; on expiry it comes back with the tool result per question and enters the model context, so the model can decide whether to ask again',
  lateAnswerLabel: 'Answer after timeout',
  lateAnswerDesc: 'Keeps the host "Answer" entry and its waiting note after a timeout, so a reply sent later arrives as a user message; clearing it withdraws the card and hides the entry, and the round can no longer be answered',
  fixedSection: 'Fixed features',
  fixedNote: "Follows the plugin's enabled state; this page offers no switch",
  fixedKeepLabel: 'Keep the draft in the UI',
  fixedKeepDesc: "At timeout, records the selected options and typed text into the question row's bubble; open it for a read-only view when the host's own Answer entry is unavailable",
  cardEnhancementsLabel: 'Card enhancements',
  cardEnhancementsDesc: 'Top-right countdown with warning flash, a background fill on the square marker of the selected single-choice option, and the question bubble; affects decoration only',
  infiniteWaitLabel: 'Wait indefinitely',
  infiniteWaitDesc: 'Adds a "Wait indefinitely" button next to the countdown; clicking it pauses the countdown of this question until the user submits',
  draftFallbackLabel: 'Draft fallback at timeout',
  draftFallbackDesc: 'Handles what was typed once the wait expires, per the fallback above',
  rejected: 'The save was rejected, so the host configuration was re-read',
  loading: 'Reading the configuration',
  unavailable: 'This deployment does not expose the setting',
}

import { uiUsesChinese } from './locale'

export type ClientTextKey = keyof typeof ZH

/** 按界面语言返回文案(判定与卡片控件共用) */
export function clientText(key: ClientTextKey): string {
  return uiUsesChinese() ? ZH[key] : EN[key]
}

/** 配置页的文案字典(供宿主 locale 注册) */
export const SETTINGS_DICTIONARY = { zh: ZH, en: EN }
