# 0.2.2-rc.1 增量说明

本目录正文仍为官方仓库 `docs/user/develop` 在标签 `dsh-v0.2.1-rc.1` 的原文, 覆盖本项目支持的 dsh `0.2.1-rc.1` 至 `0.2.2-rc.1`. 已按同一路径核对标签 `dsh-v0.2.2-rc.1`: 30 个上游文件中 24 个字节一致, 6 个有变化(2 篇正文各 1 句文案, 中英各一份, 另有 2 份 `.i18n.yaml` 只同步哈希). 正文差异如下. 原文件保持收录时的原样, 差异只记录在本文件. 更晚一轮(0.2.2-rc.2)的差异另见同目录的 `CHANGES-0.2.2-rc.2.md`.

## 与 0.2.1-rc.1 的差异

- `framework/events.md` 与 `framework/events.zh.md` 第 104 行: 事件示例列表删去 `agent/request`, 现为 `agent/pre-step`, `agent/request-error`, `tools/result`, `session/event`. `agent/request` 自 0.2.2-rc.1 起弃用, 插件不应再依赖它改路由.
- `practice/dynamic-cordis.md` 与 `practice/dynamic-cordis.zh.md` 第 5 行: 原文「创造模式提供 Plugin Manager 与只读运行时检查」改为「标准模式和创造模式提供 Plugin Manager; 创造模式另提供只读运行时检查」.

## 未变更范围

- `basic/` 全部 12 个文件, `framework/index.*`, `framework/service.*`, `practice/index.*`, `practice/llm-adapter.*` 与 0.2.1-rc.1 逐字节一致.
- 两份 `.i18n.yaml` 只更新了对应分节的哈希, 其余内容不变.

## 维护约定

- 本目录不随每个 dsh 补丁版本复制整份文档; 只有上游出现实际内容变更时才在此追加记录.
- 若某个版本出现较大改动, 再按 `docs/dsh-dev-docs/<版本>/` 新建目录.
