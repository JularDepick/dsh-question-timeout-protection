# 0.2.2-rc.2 增量说明

本目录正文仍为官方仓库 `docs/user/develop` 在标签 `dsh-v0.2.1-rc.1` 的原文, 覆盖本项目支持的 dsh `0.2.1-rc.1` 至 `0.2.2-rc.2`. 已按同一路径核对标签 `dsh-v0.2.2-rc.2` 的正文(取自 npm 包 `@deepseek-ai/dsh@0.2.2-rc.2` 随附的 `docs/user/develop`, 自该版本起 npm 包与桌面端随附源码和文档): 20 个上游正文文件中 14 个与收录原文逐字一致, 6 个有变化, 变化集中在 3 篇正文的中英各一份. 本文件只记录 0.2.2-rc.2 的差异; 更早一轮的差异见 `CHANGES-0.2.2-rc.1.md`.

## 与 0.2.1-rc.1 的差异

- `framework/events.md` 与 `framework/events.zh.md` 第 104 行: 事件示例列表删去 `agent/request`, 现为 `agent/pre-step`, `agent/request-error`, `tools/result`, `session/event`. `agent/request` 自 0.2.2-rc.1 起弃用, 插件不应再依赖它改路由.
- `practice/dynamic-cordis.md` 与 `practice/dynamic-cordis.zh.md` 第 5 行: 原文「创造模式提供 Plugin Manager 与只读运行时检查」改为「标准模式和创造模式提供 Plugin Manager; 创造模式另提供只读运行时检查」.
- `practice/llm-adapter.md` 与 `practice/llm-adapter.zh.md` 第 156 行与紧随的示例块: 错误处理一节新增约束 —— `new LlmError` 只接受 `LLM_FAILURE_CODES` 里的内置 code, 适配器自定义 code 必须经 `LlmError.fromFailure({ message, code, status })` 抛出; 示例代码同步改写. 该条自 0.2.2-rc.2 起出现, 与发行说明里的「工具失败提供更明确的错误类型与代码」属同一批改动.

## 与 0.2.2-rc.1 的差异

- 仅 `practice/llm-adapter.md` 与 `practice/llm-adapter.zh.md` 变化. `framework/events.*` 与 `practice/dynamic-cordis.*` 在 0.2.2-rc.2 与 0.2.2-rc.1 相同, 即上一轮记录的两处文案差异没有继续变动.
- 判断依据: 上一轮已按标签 `dsh-v0.2.2-rc.1` 逐文件核对, 30 个上游文件中只有 `framework/events.*` 与 `practice/dynamic-cordis.*` 两篇正文各 1 句变化, 其余逐字节一致, 因此本轮新出现的 `practice/llm-adapter.*` 差异属于 0.2.2-rc.2 的改动.

## 未变更范围

- `basic/` 全部 12 个文件, `framework/index.*`, `framework/service.*`, `practice/index.*` 与 0.2.1-rc.1 的收录原文逐字一致.
- 本目录另收录的 `index.agent.md` 与 `index.zh.md` 是本项目的速查表, 不对应上游文件.

## 维护约定

- 本目录不随每个 dsh 补丁版本复制整份文档; 只有上游出现实际内容变更时才新增或追加记录, 文件名带产生该记录时的 dsh 版本号.
- 上游文档缺位时优先从 npm 包 `@deepseek-ai/dsh` 解出 `package/docs/user/develop` 再核对, 不必依赖 GitHub 直连.
