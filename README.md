<div align="center">

# dsh-question-timeout-protection

[![Version](https://img.shields.io/badge/Version-0.1.0-green)](https://github.com/JularDepick/dsh-question-timeout-protection/tree/v0.1.0)
[![Copyright](https://img.shields.io/badge/Copyright-JularDepick-0066AA)](./COPYRIGHT)
[![License](https://img.shields.io/badge/License-Apache--2.0-yellow)](./LICENSE)

[English](./README_en-US.md)
| [简体中文]

</div>

一旦 ask_user_question 超时, 您输入的内容将保留在 UI 或模型上下文中。

## 功能

- 超时可见: 提问卡片显示剩余等待时间,并随剩余时间递减
- 临近超时警示: 剩余时间进入警示秒数(默认 5 秒)时红字闪烁
- 超时兜底: 超时后不保留等待中的问答框,已输入的草稿按兜底范围处理
- 上下文注入: 兜底范围包含上下文时,超时后把已选选项与输入内容经宿主官方通道 `userQuestions.answer` 送进对话(它会把回复 steer 成一条用户消息),由模型自行决定是否重新提问或暂时跳过
- 上下文展示交给原版: 注入内容不做任何自定义渲染,对话历史里由原版工具返回值自己展示,气泡展开行为保持宿主原样
- 卡片适配: 倒计时文案改为「x秒后超时」,「慢慢回答」按钮更名为「无限等待」,并隐藏问答卡片的收起/展开开关
- 选中高亮: 单选题选中后, 选项前的标号方块改用多选题复选框的实心底色
- 状态同步: 点击「无限等待」后客户端把状态上报给服务端,服务端改为继续阻塞等待
- 兜底范围可选: 仅收起问答框并保留草稿到界面、把草稿送进上下文、或不注入

## 机制

- 宿主默认使用阻塞式提问,提问不会超时;本插件在 agent 作用域注册同名的 `ask_user_question`,以就近遮蔽接管提问等待,不需要改动你的预设
- 超时由插件自己计时: 宿主卡片在客户端接管或开始编辑回答时会暂停自己的定时器,插件用同一时长再赛跑一次,保证到期一定返回 pending 并进入兜底流程
- 工具走宿主的 timed 等待: 卡片、选项与超时后的可继续回答状态由宿主界面提供;倒计时由插件按自己的截止时间渲染,聚焦或编辑都不会让它暂停
- 客户端适配器读取卡片倒计时文本,在最后数秒附加红字闪烁;超时后按兜底范围收起问答框(ui)或把已选选项与输入内容经 `userQuestions.answer` 送回模型(context 与 both)

## 兼容性

- dsh: `>=0.2.1-rc.1 <=0.2.1-rc.3`
- 运行时: Node.js >= 20

## 安装

尚未发布到 npm;可从本仓库构建后以包目录或 tarball 安装:

```
pnpm pack
dsh plugin --profile <profile> add release/dsh-question-timeout-protection-<版本>.tgz
```

`pnpm pack` 会先构建,打包完成后 tarball 自动移入 `release/` 目录。

## 配置

配置页位于**插件详情页顶部**的插件级配置区块,不在「包含的组件」里;其中只有「注入到上下文」一个勾选可以调整,其余能力随插件启用状态固定生效,列表中只做说明。

| 配置项 | 取值 | 默认值 | 界面 | 说明 |
|:---:|:---:|:---:|:---:|:---|
| `fallback` | `ui` / `context` / `both` | `ui` | 可改一项 | 超时兜底;界面只给「注入到上下文」勾选,勾上写 `both`,不勾写 `ui`。界面保留草稿恒定开启,所以不会再出现 `context` |
| `cardEnhancements` | 布尔 | `true` | 固定特性 | 卡片增强: 倒计时文案、隐藏收起/展开、超时后锁定输入 |
| `infiniteWait` | 布尔 | `true` | 固定特性 | 提供「无限等待」按钮与点击后的阻塞行为 |
| `draftFallback` | 布尔 | `true` | 固定特性 | 超时后保存草稿并按兜底范围处理 |
| `warningSeconds` | 数字 | 5 | 不暴露 | 进入红字闪烁警示的剩余秒数 |
| `timeoutSeconds` | 数字 | 120 | 不暴露 | 提问等待时长(秒),由模型调用工具时的 `timeout` 参数决定;此处只是未传参时的默认值 |

> 界面保留草稿是必选行为: 超时后草稿总留在该提问的本地草稿里,可在工具调用行点开查看。勾上「注入到上下文」后,超时后已输入的内容会作为一条消息送回模型,由模型自行决定是否重新提问或暂时跳过相关问答。

## 开发

```
pnpm install
pnpm build
pnpm typecheck
```

## 许可证

本项目采用 [Apache License 2.0](./LICENSE) 授权,版权声明见 [COPYRIGHT](./COPYRIGHT)。

Copyright (c) 2026 JularDepick

## 相关链接

- dsh 官方仓库: https://github.com/deepseek-ai/deepseek-harness
- dsh 插件开发文档: https://github.com/deepseek-ai/deepseek-harness/tree/main/docs/user/develop
