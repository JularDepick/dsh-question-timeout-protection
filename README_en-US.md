<div align="center">

# dsh-question-timeout-protection

[![Version](https://img.shields.io/badge/Version-0.1.0-green)](https://github.com/JularDepick/dsh-question-timeout-protection/releases)
[![Copyright](https://img.shields.io/badge/Copyright-JularDepick-0066AA)](./COPYRIGHT)
[![License](https://img.shields.io/badge/License-Apache--2.0-yellow)](./LICENSE)

[English]
| [简体中文](./README.md)

</div>

A plugin for dsh: once ask_user_question times out with a draft, the draft stays in that question's bubble and, with injection on, also enters the model context.

## Features

- Top-right countdown: the question dialog shows the remaining wait time at its top right and counts down
- Near-timeout warning: the last seconds (default 5) flash in red
- Wait indefinitely: a live question shows this button next to the countdown; clicking it freezes the countdown and shows "Paused" until the user submits. History questions and settled answers' read-only cards show neither the countdown nor this button
- Selection fill: a chosen single-choice option fills the square marker in front of it
- Question bubble: it appears at the question tool call only after a timeout has recorded a draft; clicking it opens a read-only floating card next to the bubble. Questions that never timed out, or that were answered normally, show no such bubble and use the host's own entry instead
- Draft kept in memory: at timeout the selected options and the typed content are kept in memory
- Context injection: on by default, the timed-out draft enters the model context per question, each question keeping its own selected options and typed text; the timeout semantics live in the tool's pending result, and the model must tell the user about the timeout and its handling decision at the end of its reply
- Draft recorded in the bubble: at timeout the draft is recorded in the bubble button of that question tool call, which pops a read-only floating card next to it; that question no longer offers any way to answer
- Timeout wrap-up: with a draft, injection on submits it and the card disappears as the answer settles, while injection off withdraws the card; with an empty draft (no selection and no typed text at the timeout) the plugin does not take over and leaves the host's original timeout path intact, so the card stays answerable
- No fallback answering: a timed-out question is never answered on the user's behalf

## Scope

The plugin does one thing: make a question's wait visible and pausable, and keep the typed content when it times out. The boundaries below say whether a request belongs to this plugin.

**What it does**

- Makes the wait visible: the question dialog shows this question's countdown at its top right and flashes red near the deadline
- Makes the wait pausable: a "Wait indefinitely" button next to the countdown pauses this question's countdown until the user submits
- Makes the question recognizable: a filled square marker on the selected single-choice option, plus a question bubble button at the question tool call once a timeout has recorded a draft
- Keeps content on timeout: the selected options and the typed content are kept in memory and recorded in that question's bubble for read-only viewing
- Injects the timed-out draft when configured: the draft itself enters the context as a regular per-question answer with no extra text attached; the timeout notice lives only in the tool's pending result and the model decides whether to ask again

**What it does not do**

- It does not take over the host card's rendering or wording: it only enhances the DOM, hides the host countdown and collapse controls, and never rewrites host text
- It does not edit user presets: it registers an identically named tool in each agent scope and shadows the host tool by scope proximity
- It does not answer for the user: a timeout never ticks any option and never submits the draft as a formal answer
- It does not decide for the model: whether to ask again or handle the draft otherwise is the model's call; the plugin only delivers the information
- It does not fall back to continued answering: a timed-out question that carries a draft is withdrawn and the host "Answer" entry is hidden; with an empty draft the plugin leaves the host behaviour untouched
- It does not persist anything: the draft lives only in client memory. After a refresh both the bubble and its record are lost; a still-waiting question is re-evaluated and handled when the takeover conditions hold, and settled rows are not restored
- It adds no custom RPC or storage: injection reuses the host's existing late-reply channel and state sync uses one loopback HTTP endpoint

## How it works

- The host asks questions in blocking mode, so a question never times out. This plugin registers an `ask_user_question` of its own in each agent scope and shadows the host tool by scope proximity, so no preset edit is needed
- The plugin enforces the deadline itself: the host card suspends its own timer while a client holds or starts editing the answer, so the plugin races the same duration and always returns pending at expiry (unless the user chose "Wait indefinitely", in which case the tool keeps waiting)
- The tool uses the host timed wait: the card and its options come from the host UI, while the plugin draws the countdown at the card's top right from its own deadline so focusing or editing never pauses it; the model should pass the wait seconds explicitly, and omitting them falls back to the wait configured on the plugin, still treating the batch as a timed question
- The client adapter only enhances the host card DOM: it inserts the countdown and the "Wait indefinitely" button, fills the single-choice marker, and adds the bubble button to the question tool row; at timeout it keeps the draft in memory and either submits the draft itself through `userQuestions.answer` per question (the card then disappears as the answer settles) or withdraws the card without submitting anything; an empty draft, or any unmet takeover condition, leaves the host's own path untouched
- The client reads the configuration live through the host `configForms` service, so toggling the checkbox on the plugin page changes behaviour immediately without saving or reloading

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

The config page sits in the plugin-level config block at the **top of the plugin detail view**, not inside "Included components". Only "Inject into the context" can be changed, and the change is written as soon as the checkbox toggles; every other capability follows the plugin's enabled state and is listed for reference only.

| Option | Values | Default | UI | Description |
|:---:|:---:|:---:|:---:|:---|
| `fallback` | `ui` / `context` / `both` | `both` | One switch | Timeout fallback; the page only offers "Inject into the context", checked by default, writing `both` when checked and `ui` when not. Keeping the draft in the UI is always on, so `context` never appears. A toggle writes immediately |
| `cardEnhancements` | boolean | `true` | Fixed | UI enhancements: top-right countdown with warning blink, filled radio marker, question bubble; decoration only, while the timeout takeover and injection are governed by `draftFallback` |
| `infiniteWait` | boolean | `true` | Fixed | The "Wait indefinitely" button next to the countdown that pauses this countdown until the user submits |
| `draftFallback` | boolean | `true` | Fixed | Master switch for the timeout takeover: off leaves the host's own path untouched; on submits the draft or withdraws the card by the fallback scope |
| `warningSeconds` | number | 5 | Not exposed | Seconds remaining when the red warning starts |
| `timeoutSeconds` | number | 120 | Not exposed | Wait seconds used when the model does not pass one explicitly |

> Keeping the draft in the UI is mandatory: at timeout the draft always stays in memory and is recorded in the bubble button of that question tool call, which pops a read-only floating card beside it. With "Inject into the context" checked (the default), the draft is submitted as a regular late reply per question; the question card then disappears as the answer settles. Unchecked, the plugin only withdraws the card and submits nothing. The timeout notice lives only in the tool's pending result: it says the batch expired, the user never submitted, the draft was kept, and the model must report the timeout and its decision about the draft to the user. A timed-out question that carries a draft no longer offers any way to answer; with an empty draft, a disabled fallback, or a failed "Wait indefinitely" report the plugin submits nothing and keeps the card, the question still settles as timed out, and the card stays answerable.

## Known limits

- Depends on host UI structure: cards and tool rows are located through host class-name suffixes, `data-question-key`, `data-chat-call-id`, and `aria-checked`, and host controls are recognized by their Chinese or English labels; if the host changes those, the matching enhancement silently stops working and `src/constants.ts` has to follow
- No persistence: the draft lives only in client memory; after a refresh both the bubble and its record are lost, a still-waiting question is re-evaluated and taken over from the host draft, and settled rows are not restored
- "Wait indefinitely" prefers a route on the same origin as the UI; without that route it falls back to a loopback port, where a browser and server on different machines, a taken port, or a second dsh instance make it unavailable, the countdown shows "Infinite wait unavailable", and the question falls back to the host's own behaviour instead of submitting the draft at the timeout
- Self-timed waits leave a host wait unsettled: every takeover keeps the host wait alive until the request settles or the client disconnects, which accumulates in long sessions
- With several tabs on the same session, the first submit wins and the others lose their card because the host refuses a duplicate reply
- Only the latest 200 draft snapshots are kept, so older bubbles can no longer be opened
- A profile without the web client does not start the state sync endpoint, so "Wait indefinitely" is unavailable in that deployment
- Skipping every question without any selection or typed text counts as an empty draft, so that timeout keeps the host's own path
- When the host draft cannot be read and only the card is available, selected labels come from the host's screen-reader text, which may drop suffixes such as "(Recommended)"

## Development

```
pnpm install
pnpm build
pnpm typecheck
pnpm run check:translation
```

## License

This project is licensed under the [Apache License 2.0](./LICENSE). The copyright notice is in [COPYRIGHT](./COPYRIGHT).

Copyright (c) 2026 JularDepick

## Related links

- dsh repository: https://github.com/deepseek-ai/deepseek-harness
- dsh plugin development docs: https://github.com/deepseek-ai/deepseek-harness/tree/master/docs/user/develop
