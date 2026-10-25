<div align="center">

# dsh-question-timeout-protection

[![Version](https://img.shields.io/badge/Version-0.1.0-green)](https://github.com/JularDepick/dsh-question-timeout-protection/tree/v0.1.0)
[![Copyright](https://img.shields.io/badge/Copyright-JularDepick-0066AA)](./COPYRIGHT)
[![License](https://img.shields.io/badge/License-Apache--2.0-yellow)](./LICENSE)

[English]
| [简体中文](./README.md)

</div>

A plugin for dsh: once ask_user_question times out, the content you entered will remain in the UI or model context.

## Features

- Visible timeout: the question card shows the remaining wait time and counts down
- Near-timeout warning: the last seconds (default 5) flash in red
- Timeout fallback: no waiting question box is left behind; the typed draft is handled by the fallback scope
- Context injection: when the fallback scope includes the context, the selected options and the typed content are sent at timeout through the host's official `userQuestions.answer` channel, which steers the reply into the conversation as a user message; the model decides whether to ask again or skip the questions
- Context rendering stays native: the injected content is not rendered by this plugin, the original tool result shows it in the transcript and the bubble keeps the host's own expand behavior
- Card adaptation: rewrites the countdown to "Timeout in Xs", renames the "Take time" control to "Wait indefinitely", and hides the card's collapse/expand toggle
- Selection highlight: a chosen single-choice option paints its index marker in the same solid fill the multi-select checkbox uses
- State sync: clicking "Wait indefinitely" reports the state to the host, which keeps blocking instead of returning pending
- Configurable scope: collapse the box and keep the draft in the UI, send it into the context, or neither

## How it works

- The host asks questions in blocking mode, so a question never times out. This plugin registers an `ask_user_question` of its own in each agent scope and shadows the host tool by scope proximity, so no preset edit is needed
- The plugin enforces the deadline itself: the host card suspends its own timer while a client holds or starts editing the answer, so the plugin races the same duration and always returns pending at expiry
- The tool uses the host timed wait: the card, its options and the answerable question after a timeout come from the host UI, while the plugin renders the countdown from its own deadline so focusing or editing never pauses it
- A client adapter reads the countdown text, adds the red warning in the last seconds, and after a timeout collapses the question box (ui) or sends the selected options and typed content back through `userQuestions.answer` (context and both)

## Compatibility

- dsh: `>=0.2.1-rc.1 <=0.2.1-rc.3`
- Runtime: Node.js >= 20

## Install

Not published to npm yet. Build it from this repository, then install the package directory or a tarball:

```
pnpm pack
dsh plugin --profile <profile> add release/dsh-question-timeout-protection-<version>.tgz
```

`pnpm pack` builds first and moves the tarball into the `release/` directory.

## Configuration

The config page sits in the plugin-level config block at the **top of the plugin detail view**, not inside "Included components". Only "Inject into the context" can be changed; every other capability follows the plugin's enabled state and is listed for reference only.

| Option | Values | Default | UI | Description |
|:---:|:---:|:---:|:---:|:---|
| `fallback` | `ui` / `context` / `both` | `ui` | One switch | Timeout fallback; the page only offers "Inject into the context", writing `both` when checked and `ui` when not. Keeping the draft in the UI is always on, so `context` never appears |
| `cardEnhancements` | boolean | `true` | Fixed | Card enhancements: countdown wording, hidden collapse toggle, locked input after the timeout |
| `infiniteWait` | boolean | `true` | Fixed | The "Wait indefinitely" control and the blocking it triggers |
| `draftFallback` | boolean | `true` | Fixed | Keep the draft at timeout and handle it by the fallback scope |
| `warningSeconds` | number | 5 | Not exposed | Seconds remaining when the red warning starts |
| `timeoutSeconds` | number | 120 | Not exposed | Question wait time in seconds, decided by the `timeout` argument of each tool call; this value is only the default when the argument is omitted |

> Keeping the draft in the UI is mandatory: at timeout the draft always stays in that question's local draft and can be opened from the tool row. Once "Inject into the context" is checked, the content entered before the timeout is sent to the model as one message, and the model decides whether to ask again or skip these questions.

## Development

```
pnpm install
pnpm build
pnpm typecheck
```

## License

This project is licensed under the [Apache License 2.0](./LICENSE). The copyright notice is in [COPYRIGHT](./COPYRIGHT).

Copyright (c) 2026 JularDepick

## Related links

- dsh repository: https://github.com/deepseek-ai/deepseek-harness
- dsh plugin development docs: https://github.com/deepseek-ai/deepseek-harness/tree/main/docs/user/develop
