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
- Context injection: when the fallback scope includes the context, the entered content is submitted at timeout through the host's original submit flow; when that is unavailable it falls back to a late reply, and the model decides whether to ask again or skip the questions
- Card adaptation: rewrites the countdown to "Timeout in Xs", renames the "Take time" control to "Wait indefinitely", and hides the card's collapse/expand toggle
- State sync: clicking "Wait indefinitely" reports the state to the host, which keeps blocking instead of returning pending
- Read-only history marker: a timed-out question shows "Timed out · injected into context" (or "Timed out · draft kept" in ui mode); clicking it shows the draft read-only, stored in browser local storage so it survives restarts
- Configurable scope: collapse the box and keep the draft in the UI, send the draft into the context, or both

## How it works

- The host asks questions in blocking mode, so a question never times out. This plugin registers an `ask_user_question` of its own in each agent scope and shadows the host tool by scope proximity, so no preset edit is needed
- The plugin enforces the deadline itself: the host card suspends its own timer while a client holds or starts editing the answer, so the plugin races the same duration and always returns pending at expiry
- The tool uses the host timed wait: the card countdown, the freeze while the user focuses or edits, and the answerable question after a timeout all come from the host UI
- A client adapter reads the countdown text, adds the red warning in the last seconds, and after a timeout collapses the question box (ui) or sends the draft back through the host late-reply channel (context and both)

## Compatibility

- dsh: `0.2.1-rc.2`
- Runtime: Node.js >= 20

## Install

Not published to npm yet. Build it from this repository, then install the package directory or a tarball:

```
pnpm pack
dsh plugin --profile <profile> add release/dsh-question-timeout-protection-<version>.tgz
```

`pnpm pack` builds first and moves the tarball into the `release/` directory.

## Configuration

| Option | Values | Default | Description |
|:---:|:---:|:---:|:---|
| `fallback` | `ui` / `context` / `both` | `ui` | How the timeout draft is handled: `ui` only collapses the box and keeps the draft in that question's browser draft, reopenable from the conversation history; `context` and `both` send the draft into the context as a late reply |
| `warningSeconds` | number | 5 | Seconds remaining when the red warning starts |
| `timeoutSeconds` | number | 120 | Question wait time in seconds; a tool call may override it with `timeout` |

> With `fallback: ui` the draft stays in that question's browser draft and never enters the model context. With `context` or `both`, the content entered before the timeout is sent to the model as one message, and the model decides whether to ask again or skip these questions.

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
