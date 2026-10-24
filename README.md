<div align="center">

# dsh-question-timeout-protection

[![Version](https://img.shields.io/badge/Version-0.1.0-green)](https://github.com/JularDepick/dsh-question-timeout-protection/tree/v0.1.0)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue)](./LICENSE)

[English](./README_en-US.md)
| [简体中文]

</div>

一旦 ask_user_question 超时, 您输入的内容将保留在 UI 或模型上下文中。

## 功能

- 超时可见: 提问卡片显示剩余等待时间,并随剩余时间递减
- 临近超时警示: 剩余时间进入警示秒数(默认 5 秒)时红字闪烁
- 超时兜底: 提问超时后问题保持可回答,卡片中的草稿不会被清空
- 上下文注入: 兜底范围包含上下文时,超时瞬间自动把草稿送入模型并请模型据此重新提问
- 兜底范围可选: 仅保留到界面、仅注入上下文、界面与上下文同时处理

## 机制

- 宿主默认使用阻塞式提问,提问不会超时;本插件在 agent 作用域注册同名的 `ask_user_question`,以就近遮蔽接管提问等待,不需要改动你的预设
- 工具走宿主的 timed 等待: 卡片倒计时、聚焦或编辑时冻结倒计时、超时后问题转为可继续回答,均由宿主界面提供
- 客户端适配器读取卡片倒计时文本,在最后数秒附加红字闪烁;超时后读取卡片中的草稿,按兜底范围决定是否经晚回复通道送回模型

## 兼容性

- dsh: `0.2.1-rc.2`
- 运行时: Node.js >= 20

## 安装

尚未发布到 npm;可从本仓库构建后以包目录或 tarball 安装:

```
dsh plugin --profile <profile> add <包名或 tarball>
```

## 配置

| 配置项 | 取值 | 默认值 | 说明 |
|:---:|:---:|:---:|:---|
| `fallback` | `ui` / `context` / `both` | `ui` | 超时草稿的处理范围:仅留界面、仅注入上下文、两者 |
| `warningSeconds` | 数字 | 5 | 进入红字闪烁警示的剩余秒数 |
| `timeoutSeconds` | 数字 | 120 | 提问等待时长(秒);工具调用也可用 `timeout` 参数单次覆盖 |

> `fallback` 为 `ui` 时草稿只留在提问卡片,不进入模型上下文;`context` 与 `both` 模式下,超时瞬间用户已输入的内容会作为一条说明消息送回模型,并要求模型据此重新提问。

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
