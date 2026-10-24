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
- 上下文注入: 兜底范围包含上下文时,超时后把已输入内容作为晚回复送出,由模型自行决定是否重新提问或暂时跳过
- 卡片适配: 倒计时文案改为「x秒后超时」,「慢慢回答」按钮更名为「无限等待」,并隐藏问答卡片的收起/展开开关
- 状态同步: 点击「无限等待」后客户端把状态上报给服务端,服务端改为继续阻塞等待
- 历史只读标记: 超时问题在历史里的气泡改为「回答超时·已注入上下文」(`ui` 模式为「回答超时·草稿已保留」),点击可只读查看超时前的草稿,草稿存浏览器本地存储,重启不丢失
- 兜底范围可选: 仅收起问答框并保留草稿到界面、仅把草稿送进上下文、两者同时处理

## 机制

- 宿主默认使用阻塞式提问,提问不会超时;本插件在 agent 作用域注册同名的 `ask_user_question`,以就近遮蔽接管提问等待,不需要改动你的预设
- 超时由插件自己计时: 宿主卡片在客户端接管或开始编辑回答时会暂停自己的定时器,插件用同一时长再赛跑一次,保证到期一定返回 pending 并进入兜底流程
- 工具走宿主的 timed 等待: 卡片倒计时、聚焦或编辑时冻结倒计时、超时后问题转为可继续回答,均由宿主界面提供
- 客户端适配器读取卡片倒计时文本,在最后数秒附加红字闪烁;超时后按兜底范围收起问答框(ui)或把草稿经晚回复通道送回模型(context 与 both)

## 兼容性

- dsh: `0.2.1-rc.2`
- 运行时: Node.js >= 20

## 安装

尚未发布到 npm;可从本仓库构建后以包目录或 tarball 安装:

```
pnpm pack
dsh plugin --profile <profile> add release/dsh-question-timeout-protection-<版本>.tgz
```

`pnpm pack` 会先构建,打包完成后 tarball 自动移入 `release/` 目录。

## 配置

| 配置项 | 取值 | 默认值 | 说明 |
|:---:|:---:|:---:|:---|
| `fallback` | `ui` / `context` / `both` | `ui` | 超时草稿的处理范围: `ui` 只收起问答框,草稿留在该提问的浏览器草稿里,可从对话历史重新打开; `context` 与 `both` 把草稿作为晚回复送进上下文 |
| `warningSeconds` | 数字 | 5 | 进入红字闪烁警示的剩余秒数 |
| `timeoutSeconds` | 数字 | 120 | 提问等待时长(秒);工具调用也可用 `timeout` 参数单次覆盖 |

> `fallback` 为 `ui` 时草稿只留在该提问的浏览器草稿里,不进入模型上下文;`context` 与 `both` 模式下,超时后已输入的内容会作为一条消息送回模型,由模型自行决定是否重新提问或暂时跳过相关问答。

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
