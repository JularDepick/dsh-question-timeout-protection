<div align="center">

# dsh-question-timeout-protection

[![Version](https://img.shields.io/badge/Version-0.1.0-green)](https://github.com/JularDepick/dsh-question-timeout-protection/releases)
[![Copyright](https://img.shields.io/badge/Copyright-JularDepick-0066AA)](./COPYRIGHT)
[![License](https://img.shields.io/badge/License-Apache--2.0-yellow)](./LICENSE)

English
| [简体中文](./README.md)

</div>

A plugin for dsh: once ask_user_question times out with a draft, the draft stays in that question's bubble and, with injection on, is handed to the model together with the tool's pending result. A timeout the plugin takes over is withdrawn by the plugin and the host's own "Answer" entry no longer appears; when the fallback is off or the channel is unavailable the question goes back to the host and the card stays answerable.

## Features

- Top-right countdown: the question dialog shows the remaining wait time at its top right and counts down
- Near-timeout warning: the last seconds (default 5) flash in red
- Wait indefinitely: a live question shows this button next to the countdown; clicking it freezes the countdown and shows "Paused" until the user submits. Historical questions and settled answers' read-only cards show neither the countdown nor this button
- Auto wait indefinitely switch: the composer toolbar carries an "Auto wait indefinitely" switch to the right of the model selector; when on, every question enters indefinite wait automatically (the same path as clicking "Wait indefinitely" once, and a question already waiting freezes right away), and when off new questions go back to the countdown behavior. The switch state survives a refresh; frozen questions stay frozen and end when the user submits
- Selection fill: a chosen single-choice option fills the square marker in front of it
- Question bubble: it appears at the question tool call only after a timeout has recorded a draft; clicking it opens a read-only floating card next to the bubble. The host's own "Answer" bubble conflicts with it, so the plugin bubble takes over that role
- Draft kept in memory: at timeout the selected options and the typed content are kept in memory
- Context injection: on by default, the draft snapshot is handed to the server while the question is still open, and at expiry it comes back to the model per question through the tool's pending result, each question keeping its own selected options and typed text; the timeout semantics live in that same pending result, and the model must tell the user about the timeout and its handling decision at the end of its reply
- Draft recorded in the bubble: at timeout the draft is recorded in the bubble button of that question tool call, which pops a read-only floating card next to it; that question no longer offers any way to answer
- Timeout wrap-up: with a draft, injection on hands it to the model through the tool result and the plugin withdraws the card, while injection off only withdraws the card; with an empty draft (no selection and no typed text at the timeout) the plugin closes the card itself instead of leaving an unanswerable dialog behind; a disabled draft fallback, a repeatedly failing draft report, or a failed "Wait indefinitely" report hands the question back to the host's own path and the card stays answerable
- No fallback answering: a question the plugin has taken over is never answered on the user's behalf; the three hand-back cases are left to the host path, where the card stays answerable

## Scope

The plugin does one thing: make a question's wait visible and pausable, and keep the typed content when it times out. The boundaries below say whether a request belongs to this plugin.

**What it does**

- Makes the wait visible: the question dialog shows this question's countdown at its top right and flashes red near the deadline
- Makes the wait pausable: a "Wait indefinitely" button next to the countdown pauses this question's countdown until the user submits; the composer toolbar also carries an "Auto wait indefinitely" switch that makes every later question wait indefinitely
- Makes the question recognizable: a filled square marker on the selected single-choice option, plus a question bubble button at the question tool call once a timeout has recorded a draft
- Keeps content on timeout: the selected options and the typed content are kept in memory and recorded in that question's bubble for read-only viewing
- Injects the timed-out draft when configured: the draft snapshot is reported to the server while the question is open, and at expiry the draft itself comes back per question through the tool's pending result with no extra text attached; the timeout notice lives in that same result and the model decides whether to ask again

**What it does not do**

- It does not take over the host card's rendering or wording: it only enhances the DOM, hides the host countdown and collapse controls, and never rewrites host text
- It does not edit user presets: it registers an identically named tool in each agent scope and shadows the host tool by scope proximity
- It does not answer for the user: a timeout never ticks any option and never submits the draft as a formal answer
- It does not decide for the model: whether to ask again or handle the draft otherwise is the model's call; the plugin only delivers the information
- It does not fall back to continued answering: a question whose timeout the plugin takes over is always withdrawn and the host "Answer" entry is hidden, whether or not a draft was recorded; with the fallback disabled, a repeatedly failing draft report, or a failed "Wait indefinitely" report the question is left to the host's own path
- It does not persist anything: the draft lives only in client memory. After a refresh the bubbles and drafts recorded on this page are lost; a still-waiting question is re-evaluated from the host's persisted draft, and when the takeover conditions hold the plugin withdraws the card and rebuilds the bubble; settled rows are not restored
- It adds no custom RPC or storage: the draft reaches the model only through the tool result, and state sync mounts on the host's own HTTP service, same-origin with the UI; the only local storage is the "Auto wait indefinitely" switch state

## How it works

- The host asks questions in blocking mode, so a question never times out. This plugin registers an `ask_user_question` of its own in each agent scope and shadows the host tool by scope proximity, so no preset edit is needed
- The plugin enforces the deadline itself: the host card suspends its own timer while a client holds or starts editing the answer, so the plugin races the same duration and always returns pending at expiry (unless the user chose "Wait indefinitely", in which case the tool keeps waiting)
- The tool uses the host timed wait: the card and its options come from the host UI, while the plugin draws the countdown at the card's top right from its own deadline so focusing or editing never pauses it; the model should pass the wait seconds explicitly, and omitting them falls back to the wait configured on the plugin, still treating the batch as a timed question; passing `-1` means the question must be answered before the agent continues, which uses the host's blocking question and enables neither the countdown nor the timeout fallback
- The client adapter only enhances the host UI DOM: it inserts the countdown and the "Wait indefinitely" button into the card, adds the "Auto wait indefinitely" switch to the composer toolbar, fills the single-choice marker, and adds the bubble button to the question tool row; while the question is open it keeps reporting the draft snapshot to the server, and at timeout it keeps the draft in memory and withdraws the card, while whether the tool result carries the draft to the model is decided by the fallback on the server side; with an empty draft the plugin closes the card itself
- The client reads the configuration live through the host `configForms` service, so toggling the checkbox on the plugin page changes behaviour immediately without saving or reloading

## Compatibility

- dsh: `>=0.2.1-rc.1 <=0.2.1-rc.5`
- Runtime: Node.js >= 20

## Install

Not published to npm yet. Build it from this repository, then install the package directory or a tarball:

```
pnpm pack
dsh plugin --profile <profile> add release/dsh-question-timeout-protection-0.1.0.tgz
```

`pnpm pack` builds first and moves the tarball into the `release/` directory. Installing straight from source (as `github:JularDepick/dsh-question-timeout-protection#<sha>`) works too, with `prepare` doing the build; pnpm 10 and newer block build scripts by default, so allow them for this package first, otherwise the install lands without `dist/`.

## Configuration

The config page sits in the plugin-level config block at the **top of the plugin detail view**, not inside "Included components". Only "Inject into the context" can be changed, and the change is written as soon as the checkbox toggles; every other capability follows the plugin's enabled state and is listed for reference only.

| Option | Values | Default | UI | Description |
|:---:|:---:|:---:|:---:|:---:|
| `fallback` | `ui` / `context` / `both` | `both` | One switch | Timeout fallback; the page only offers "Inject into the context", checked by default, writing `both` when checked and `ui` when not. Keeping the draft in the UI is always on, so `context` never appears. A toggle writes immediately |
| `cardEnhancements` | boolean | `true` | Fixed | UI enhancements: top-right countdown with warning blink, filled radio marker, question bubble, and hiding the host collapse controls and wait text; the timeout takeover and injection are governed by `draftFallback`, this switch only covers decoration; when off those decorations do not appear while the timeout wrap-up still runs (the card is still withdrawn and locked), and the toolbar "Auto wait indefinitely" switch is removed with it, since the automatic freeze runs through that same decoration path; only hiding the host "Answer" entry and its wait text stops |
| `infiniteWait` | boolean | `true` | Fixed | The "Wait indefinitely" button next to the countdown that pauses this countdown until the user submits; turning it off removes both that button and the "Auto wait indefinitely" switch in the toolbar |
| `draftFallback` | boolean | `true` | Fixed | Timeout wrap-up switch: turning it off stops the client from withdrawing the card and from reporting the draft, handing that question back to the host's own path (the plugin still settles the wait on time); turning it on hands the draft to the tool result or only withdraws the card, by the fallback scope |
| `warningSeconds` | number | 5 | Not exposed | Seconds remaining when the red warning starts |
| `timeoutSeconds` | number | 120 | Not exposed | Wait seconds used when the model does not pass one explicitly, from 1 to 2147483 |

> Keeping the draft in the UI is mandatory: at timeout the draft always stays in memory and is recorded in the bubble button of that question tool call, which pops a read-only floating card beside it. As long as the timeout wrap-up is on, the client reports the draft snapshot to the server while the question is still open, and the server alone decides whether that draft reaches the model: checked (the default) the draft comes back per question through the tool's pending result, while unchecked the plugin only withdraws the card and hands the model no draft. The timeout notice and the draft share that one pending result: it says the batch expired, the user never submitted, and the model must report the timeout and its decision about the draft to the user. A question the plugin takes over is always withdrawn and its host "Answer" entry hidden; with an empty draft the plugin closes the card itself and no bubble appears. Three cases hand the question back to the host: the wrap-up switched off, a repeatedly failing draft report, or a failed "Wait indefinitely" report; those cases neither withdraw the card nor hand over a draft, the question still settles as timed out, the card stays answerable, and for the last two the countdown slot reads "Draft cannot be delivered" or "Cannot wait indefinitely" (only one at a time) until the timeout settles, after which the card is restored to the host's own state; with the wrap-up off nothing is reported and no failure hint appears. With card enhancement off none of those decorations happen (no countdown, no indefinite-wait button, no bubble, no toolbar switch), while the timeout wrap-up still runs: a card that should be withdrawn still is, and the draft is still reported and handed to the model per the configuration above; only the host "Answer" entry and its wait text are no longer hidden.

## Known limits

- Depends on host UI structure: cards and tool rows are located through host class-name suffixes, `data-question-key`, `data-chat-call-id`, and `aria-checked`, host controls are recognized by their Chinese or English labels, and the toolbar switch relies on the model selector's accessible name (`选择模型` / `Select model`) plus the `[class*="standardControls"]` container; if the host changes those, the matching enhancement silently stops working, and the label constants in `src/constants.ts` plus the selectors in `src/client/adapter.ts` have to follow
- No persistence: the draft lives only in client memory; after a refresh the bubble and its record are lost, a still-waiting question is re-evaluated from the host's persisted draft and taken over when the takeover conditions hold, and settled rows are not restored
- "Wait indefinitely" and the draft report share one token-protected channel mounted on the host's own HTTP service, same-origin with the UI: the page first fetches the channel token and then reports, and neither capability works when the token cannot be obtained; other pages on the same machine cannot get the token because their origin does not match, so they cannot forge a report; that boundary only covers browser pages, since a request without an origin is treated as the host page itself, so other processes on the same machine can still obtain the token and forge a report or a draft; a deployment without the web client (no host HTTP service) has neither capability: the server still settles that question as timed out, but the draft never reaches the model context and "Wait indefinitely" has no effect
- The plugin times the wait itself: on expiry it settles the timeout and releases the host-side foreground wait; an answer the user actually submitted before that moment still wins
- With several tabs on the same session, the server keeps one draft snapshot per call id, so a later tab overwrites the one reported earlier
- Only the latest 200 draft snapshots are kept, so older bubbles can no longer be opened
- Skipping every question without any selection or typed text counts as an empty draft, so that timeout closes the card
- The draft is merged per question from three sources, in this order: the host's persisted record (authoritative, written synchronously on every edit), then the live value of the question on screen (only when the host record has no entry for it), then the plugin's own snapshot; when the live value is read, selected labels come from the host's screen-reader text, which may drop suffixes such as "(Recommended)"
- With injection on but the draft snapshot not reaching the server (page closed, state channel unavailable, token unavailable, report failed), the model receives only the timeout notice and no draft content; after three consecutive failures that question counts as channel-unavailable, so the plugin stops taking it over, the card goes back to the host and stays answerable, and the plugin bubble does not appear; from that verdict until the timeout settles, the card countdown reads "Draft cannot be delivered" (it covers "Cannot wait indefinitely", only one of them is shown), and once the card is handed back it is restored to the host's own state and the drawn countdown is removed with it

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
