<div align="center">

# dsh-question-timeout-protection

[![Version](https://img.shields.io/badge/Version-0.1.0-green)](https://github.com/JularDepick/dsh-question-timeout-protection/tree/v0.1.0)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue)](./LICENSE)

[English]
| [简体中文](./README.md)

</div>

A plugin for dsh: once ask_user_question times out, the content you entered will remain in the UI or model context.

## Features

- Visible timeout: the question card shows the remaining wait time and counts down
- Near-timeout warning: the last seconds (default 5) flash in red
- Timeout fallback: after a timeout the question stays answerable and the typed draft is not cleared
- Context injection: when the fallback scope includes the context, the draft is handed to the model at timeout with a request to ask again
- Configurable scope: UI only, context only, or both

## How it works

- The host asks questions in blocking mode, so a question never times out. This plugin registers an `ask_user_question` of its own in each agent scope and shadows the host tool by scope proximity, so no preset edit is needed
- The tool uses the host timed wait: the card countdown, the freeze while the user focuses or edits, and the answerable question after a timeout all come from the host UI
- A client adapter reads the countdown text, adds the red warning in the last seconds, and after a timeout reads the draft from the card and, depending on the fallback scope, sends it back to the model through the host late-reply channel

## Compatibility

- dsh: `0.2.1-rc.2`
- Runtime: Node.js >= 20

## Install

Not published to npm yet. Build it from this repository, then install the package directory or a tarball:

```
dsh plugin --profile <profile> add <package or tarball>
```

## Configuration

| Option | Values | Default | Description |
|:---:|:---:|:---:|:---|
| `fallback` | `ui` / `context` / `both` | `ui` | How the timeout draft is handled: UI only, context only, or both |
| `warningSeconds` | number | 5 | Seconds remaining when the red warning starts |
| `timeoutSeconds` | number | 120 | Question wait time in seconds; a tool call may override it with `timeout` |

> With `fallback: ui` the draft stays in the question card and never enters the model context. With `context` or `both`, the text typed before the timeout is sent to the model as one explanatory message asking it to ask again.

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
