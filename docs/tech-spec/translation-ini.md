# 翻译文件规范(translation-ini)

## 存放位置

翻译文件存放于 `src/translation/` 目录.

## 命名规范

翻译文件命名遵循 `xx-YY.ini` 格式:

- `xx`: 语言代码, 小写, 遵循 ISO 639-1, 如 `zh`, `en`
- `YY`: 地区代码, 大写, 遵循 ISO 3166-1 alpha-2, 如 `CN`, `US`

示例: `zh-CN.ini`(简体中文), `en-US.ini`(美式英语).

## 文件内容

- 使用 INI 格式, UTF-8 编码.
- 翻译 ini 中不使用注释.
- 文件结构包含两个节:
  - `[meta]`: 翻译文件的元信息, 包含以下键:
    - `for`: 本翻译文件对应的插件版本号
    - `lang`: 语言代码, 与文件名 `xx-YY` 一致
    - `name`: 语言显示名(用于 UI 语言切换展示)
    - `endtime`: 最近维护时间, 遵循守则日期格式 `yyyy-MM-dd HH:mm:ss+HH:mm`
  - `[translation]`: 文案键值对, 键名使用英文并以 `模块.字段` 分段, 值使用对应语言的文案.
  - 带占位符的文案使用 `{名称}` 形式, 如 `countdown.remaining` 的 `{seconds}` 与 `draft.selected` 的 `{items}`; 占位符名称在各语言版本中保持一致, 由调用方在取到文案后按名替换, `TranslationManager.translate()` 只做键查找与回退, 不替换占位符.
- 新增翻译文件时, 以 `src/translation/.example_zh-CN.ini` 为基准模板(简体中文版复刻), 从该模板翻译更新为 `xx-YY.ini`, 改写 `[meta]` 各键后翻译 `[translation]` 键值.

## 模板维护流程

- `src/translation/.example_zh-CN.ini` 是翻译文件的基准模板, 内容即简体中文版, 与 `zh-CN.ini` 保持一致.
- 版本迭代时直接维护该基准模板(补充, 调整 `[translation]` 键值), 并保持 `zh-CN.ini` 与基准模板一致.
- 模板更新后, 其余语言版本(如 `en-US.ini`)从模板翻译更新, 保持各语言键集一致.

## 键名与代码的对应

- 键名分段对应文案所在位置: `settings.*` 对应插件配置页(键名与 `src/client/i18n.ts` 的字典键一一对应), `countdown.*` 对应提问卡片右上角的插件自绘倒计时文案, `control.*` 对应卡片控件文案, `bubble.*` 对应提问工具行的气泡按钮文案, `draft.*` 对应超时草稿的注入正文, `draftPanel.*` 对应只读草稿面板文案.
- 配置页文案的实际来源是客户端半身的 `src/client/i18n.ts`, 它经宿主 locale 注册字典, 不读取本目录的 ini; 其余文案的实际来源是 `src/constants.ts` 与 `src/client/adapter.ts` 里的字面量. 本目录的 ini 是这些文案的同一套措辞镜像, 供 `TranslationManager` 与后续多语言接入使用.
- 因此改动任一可见文案时, 需同步字面量所在文件与本节所列 ini 的对应键, 保持键集与取值一致.

## 键集清单

| 键名 | 对应位置 | 说明 |
|:---:|:---:|:---:|
| `settings.*` | `src/client/i18n.ts` | 配置页文案, 共 18 个键 |
| `countdown.remaining` / `countdown.paused` | `src/constants.ts` 的 `COUNTDOWN_TEXT_ZH`/`COUNTDOWN_TEXT_EN` 与 `COUNTDOWN_PAUSED_TEXT_ZH`/`COUNTDOWN_PAUSED_TEXT_EN` | 插件自绘倒计时的运行态与暂停态文案 |
| `control.takeTime` | `src/constants.ts` 的 `TAKE_TIME_TEXTS` | 宿主「慢慢回答」控件的原文, 用于定位并隐藏该控件 |
| `control.infiniteWait` | `src/constants.ts` 的 `INFINITE_WAIT_LABEL_ZH`/`INFINITE_WAIT_LABEL_EN` | 插件自绘「无限等待」按钮的文案 |
| `bubble.draftLabel` | `src/constants.ts` 的 `BUBBLE_DRAFT_LABEL_*` | 提问工具行气泡按钮的文案, 只在记录了超时草稿时出现 |
| `draft.selected` / `draft.custom` | `src/constants.ts` 的 `DRAFT_SELECTED_LABEL_*` / `DRAFT_CUSTOM_LABEL_*` | 注入正文里的已选项与补充输入 |
| `draftPanel.title` / `draftPanel.note` / `draftPanel.empty` / `draftPanel.unanswered` / `draftPanel.close` | `src/constants.ts` 的 `DRAFT_PANEL_*` | 只读草稿面板的标题, 说明, 空态, 未作答提示与关闭按钮 |

## 语言切换机制

- UI 预留翻译功能, 提供翻译切换入口.
- 切换目标语言时, 加载 `src/translation/` 下对应的 `xx-YY.ini` 文件.
- 未命中翻译的文案回退到默认语言(`zh-CN.ini`).
