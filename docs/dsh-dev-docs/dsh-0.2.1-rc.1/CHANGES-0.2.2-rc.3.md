# 0.2.2-rc.3 增量说明

本目录正文仍为官方仓库 `docs/user/develop` 在标签 `dsh-v0.2.1-rc.1` 的原文, 覆盖本项目支持的 dsh `0.2.1-rc.1` 至 `<0.2.3-rc.1`. 已按同一路径核对标签 `dsh-v0.2.2-rc.3` 的正文(取自 npm 包 `@deepseek-ai/dsh@0.2.2-rc.3` 随附的 `docs/user/develop`): 与 `0.2.2-rc.2` 逐字节一致, 因此本目录正文无需改动. 本文件记录该轮的核对结论; 更早两轮的差异见 `CHANGES-0.2.2-rc.1.md` 与 `CHANGES-0.2.2-rc.2.md`.

## 与 0.2.2-rc.2 的差异

- `docs/user/develop` 下无差异: 20 个上游正文文件及其 `.i18n.yaml` 全部逐字节一致.
- 该版本随附文档的其他路径有变化, 但不在本目录收录范围: `capability-seams.md` 与中文版各新增一条 `ctx.deepseekChatImport` 服务, `config-catalog.md` 与中文版新增 `@deepseek-ai/dsh-deepseek-chat-import` 的配置目录, `subsystems/persistence.md` 与中文版新增该服务的 Cordis API 段落; 三处内容都只描述新增的实验性会话导入插件.

## 发行说明要点

- 新增实验性「DeepSeek 会话导入」插件, 把 DeepSeek App 或网页版的历史会话导入工作区并继续对话.
- 修复 Windows 桌面版应用内更新可能失败、无法自动重新打开的问题.
- 两项都不涉及提问等待、工具注册、客户端槽位或 webServer 路由的契约.

## 宿主契约核对(与 0.2.2-rc.2 对比)

- 逐个解包并逐文件比对 25 个 dsh 包(含 `dsh-agent`, `dsh-tools`, `dsh-user-questions`, `dsh-client-ui-*`, `dsh-client-locale`, `dsh-client-modules`, `dsh-session`, `dsh-timeout`, `dsh-tool-ask-user`, `dsh-tool-call-timeout-policy`, `dsh-host-webserver`, `dsh-app-boot`, `dsh-base`, `dsh-plugin-manager`, `dsh-cordis-client-runner`, `dsh-web`, `dsh-web-app` 等), CLI 包 `@deepseek-ai/dsh` 单独核对清单与随附文档: 21 个包只有 `package.json` 里的版本号与内部依赖版本变化.
- 4 个包有代码变化, 均与本插件无关: `dsh-client-modules` 只改构建提交号常量; `dsh-client-ui-plugin-manager` 只往官方 bundle 名单加入 `dsh-deepseek-chat-import`; `dsh-cordis-client-runner` 的槽位目录只新增 `sidebar.session.action` 一项; `dsh-client-ui-primitives` 只改图标集.
- 本插件依赖的契约逐字节一致: `dsh-user-questions` 的提问投影(timed 判定), `dsh-client-ui-user-questions` 的卡片 DOM 与四套等待文案, `dsh-client-ui-tool` 的工具行, `dsh-tools` 与 `dsh-agent` 的工具注册, `dsh-host-webserver` 的路由注册, `dsh-app-boot` 的 `engines.dsh` 预检(仍以 `includePrerelease: true` 判定).
- 全部 dsh 包仍依赖 Cordis `~4.1.0`.

## 维护约定

- 本目录不随每个 dsh 补丁版本复制整份文档; 只有上游出现实际内容变更时才新增或追加记录, 文件名带产生该记录时的 dsh 版本号.
- 上游文档缺位时优先从 npm 包 `@deepseek-ai/dsh` 解出 `package/docs/user/develop` 再核对, 不必依赖 GitHub 直连.
