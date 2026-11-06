<div align="center">

# dsh-question-timeout-protection

[![Version](https://img.shields.io/badge/Version-0.1.1-green)](https://github.com/JularDepick/dsh-question-timeout-protection/releases)
[![Copyright](https://img.shields.io/badge/Copyright-JularDepick-0066AA)](./COPYRIGHT)
[![License](https://img.shields.io/badge/License-Apache--2.0-yellow)](./LICENSE)

English
| [简体中文](./README.md)

</div>

A plugin for dsh: once ask_user_question times out, the content you entered will remain in the UI or model context.

## Why you need it

A dsh question blocks by default: once the model asks, it waits, and if you step away the whole conversation sits there. Switch to a timed wait and another problem appears: when the clock runs out, whatever you had already selected and typed is dropped, and the model only learns that it timed out, not what you were about to say.

This plugin adds three things: you can see how long is left, you can pause the wait, and the content at the moment of the timeout is not lost.

## What you get

| Capability | What you will see |
|:---:|:---:|
| Countdown | The question card shows the remaining seconds at its top right, ticking down |
| Warning | In the last seconds the number turns red and blinks |
| Wait indefinitely | A button next to the countdown; one click removes the deadline until you submit |
| Auto wait indefinitely | A toolbar switch that puts every new question into indefinite wait |
| Selection fill | A chosen single-choice option fills the square marker in front of it |
| Timeout draft | The options you selected and the text you typed are kept at the moment of the timeout |
| Draft review | After a timeout the question row shows a bubble button; click it to read what you had entered |
| Context injection | When on, the draft returns to the model context with the tool result |

## Install

### Requirements

- dsh within `>=0.2.1-rc.1 <=0.2.2-rc.1`; installation and startup refuse anything outside it
- Node.js >= 20

### Option A: build from source

For using the plugin straight from this repository:

```
pnpm install
pnpm pack
dsh plugin --profile <profile> add <tarball>
```

`pnpm pack` builds first, then puts the tarball into the build output directory under a name like `dsh-question-timeout-protection-0.1.1.tgz`. Replace it with the real path.

### Option B: install from the GitHub source

Use `github:JularDepick/dsh-question-timeout-protection#<commit>` as the package name; `prepare` runs the build.

pnpm 10 and newer block dependency build scripts by default, so the first `add` fails and prints a package key. Put that key into this profile's `pnpm-workspace.yaml`:

```
allowBuilds:
  dsh-question-timeout-protection: true
```

Then run `add` again. Without this step the install lands with no build output and the plugin does not work.

### Option C: install from a release tarball

Download the tarball for the version you want and install it directly:

```
dsh plugin --profile <profile> add <tarball>
```

No build is needed and the pnpm build-script policy does not apply.

## Quick start

1. Install the plugin into your profile with any option above
2. Restart dsh
3. Ask the model something so it asks you back; a countdown appears at the card's top right, and you can pause it with "Wait indefinitely" next to it

## Usage

### Countdown and warning

The countdown appears only on a **live question**, and it follows the plugin's own deadline: focusing the input or starting to type does not pause it. During the last seconds the number turns red and blinks. Once the deadline passes, the plugin withdraws its countdown and failure hints and restores the card to the host's own wait state; when the settlement arrives it decides whether to lock and withdraw the card or hand it back.

Historical questions and settled answers never show a countdown.

### Wait indefinitely

The "Wait indefinitely" button sits next to the countdown. Clicking it removes the deadline for this question and freezes the countdown as "Paused" until you submit.

The action takes effect only after the server confirms the registration, so a click briefly waits for that reply. If the state channel is unavailable the button does not take effect: the card returns to counting and the countdown slot reads "Cannot wait indefinitely".

### Auto wait indefinitely

The composer toolbar carries an "Auto wait indefinitely" switch to the left of the model selector. When on, every new question enters indefinite wait automatically, and a question already waiting freezes right away, exactly as if you had clicked "Wait indefinitely" once.

The switch state lives in browser storage and survives a refresh. Turning it off affects only later questions: frozen questions stay frozen and end when you submit.

The switch appears only while card enhancements and indefinite wait are both on.

### Timeout draft and read-only review

At the moment of a timeout the plugin keeps the options you selected and the text you typed in memory. That question's tool call row then shows a bubble button; clicking it pops a read-only floating card beside it with your selections and notes per question, offering no way to answer.

When the draft is empty, meaning you neither selected nor typed anything, the plugin closes the card on that timeout and no bubble appears.

The draft lives only in memory, so a page refresh loses the bubbles and their records.

### Context injection

This is on by default. While you are answering, the plugin keeps reporting draft snapshots to the server; at expiry it takes the latest one and returns it to the model context through the tool's pending result, per question, each keeping its own selections and notes.

The timeout notice and the draft share that one result, and the model is explicitly told to report the timeout at the end of its reply, plus what it intends to do with the draft when one came back.

With this off, the plugin only withdraws the card and hands the model no draft.

### Configuration

The config page sits at the **top of the plugin detail view**, not inside "Included components". Only "Inject into the context" can be changed, and a toggle writes immediately without any save or refresh.

| Option | Values | Default | UI | Description |
|:---:|:---:|:---:|:---:|:---:|
| `fallback` | `ui` / `context` / `both` | `both` | One switch | Timeout fallback. The page only offers "Inject into the context": checked writes `both`, unchecked writes `ui`. Keeping the draft in the UI is always on, so `context` never appears |
| `cardEnhancements` | boolean | `true` | Fixed | Decoration only: countdown and warning blink, selection fill, question bubble, and hiding the host's collapse controls and wait text. When off no decoration appears, while the timeout wrap-up still runs: the card that should be withdrawn still is and locked, and the draft is still reported per the configuration above |
| `infiniteWait` | boolean | `true` | Fixed | Provides the "Wait indefinitely" button and the toolbar switch; turning it off removes both |
| `draftFallback` | boolean | `true` | Fixed | Timeout wrap-up switch. When off the client neither withdraws the card nor reports the draft and hands that question back to the host; the plugin still settles the wait on time |
| `warningSeconds` | number | 5 | Not exposed | Seconds remaining when the red warning starts, from 1 to 60 |
| `timeoutSeconds` | number | 120 | Not exposed | Wait seconds used when the model does not pass one explicitly, from 1 to 2147483 |

## Compatibility

| Item | Version |
|:---:|:---:|
| dsh | `>=0.2.1-rc.1 <=0.2.2-rc.1` |
| Node.js | >= 20 |

The Node.js requirement of the host dsh itself follows the release notes of the matching version.

## FAQ

**Will my input be lost when the question times out**

Not on this page. At the timeout the plugin keeps your selections and typed text in memory and records them in that question's bubble button, which you can open at any time. A page refresh does erase that record.

**Can the model see what I typed**

It depends on the "Inject into the context" checkbox. When checked the draft reaches the model context with the tool result; when unchecked it stays in the UI only.

**Why did the card disappear**

Because that question timed out and the plugin took it over. The plugin withdraws and locks the card so it does not leave a dialog you can no longer answer. To review what you had entered, use the bubble button on the question row.

**Why is there no countdown on my screen**

Three common reasons: card enhancements are off; that question was a blocking one the model marked with `-1`; or your UI language is neither Chinese nor English. Also, on a page refresh, when the card is already in its editing or waiting state the plugin cannot restore the deadline, so no countdown appears until the card returns to counting.

**What happens after I click "Wait indefinitely"**

This question no longer has a deadline and the model keeps waiting until you submit. If the state channel is unavailable the button does not take effect: the card returns to counting and reads "Cannot wait indefinitely".

**The bubble is gone after a refresh**

The draft lives in memory only and is never persisted, so a refresh loses the bubbles and records on this page. A still-waiting question is re-evaluated from the host's persisted draft.

**Do I need to edit my presets**

No. The plugin registers an identically named question tool in each agent scope, shadowing the host's blocking question by scope proximity.

**Will it submit answers for me**

No. A timeout never selects an option and never submits a draft as a formal answer.

## Known limits

**Depends on the host UI**

Cards and tool rows are located through host class-name suffixes, `data-question-key`, `data-chat-call-id` and `aria-checked`; host controls are recognised by their Chinese or English labels. The toolbar switch prefers the model selector's accessible name, falls back to structural placement inside the composer toolbar, then to a document-wide lookup, and logs one console.warn per reason instead of failing silently. If the host changes those structures or labels the matching enhancement stops working; the recognition labels and selectors live in the source constants file.

**Depends on the host question projection**

The client relies on the userQuestions projection of the host sessions service to tell whether a question entered the continued state; draft reporting, the timeout wrap-up and the bubble all follow it. If that service is missing or the interface is renamed the plugin logs a single console.warn: the countdown and card decoration stay, but no draft is reported, the wrap-up does not run and no bubble appears.

**Session subscription cap**

At most 8 sessions keep a projection subscription at once. Beyond that the least recently seen session degrades to per-second polling and its timeout takeover arrives later; the polling fallback is also capped at 8, and past that the least recently seen session is released, so its timeout fallback may stop working.

**No persistence**

The draft lives in client memory, so a refresh loses the bubbles and their records. A still-waiting question is re-evaluated from the host's persisted draft and taken over when the takeover conditions hold; settled rows are not restored.

**Indefinite wait and draft reporting need the web client**

Both share one token-protected channel mounted on the host's own HTTP service, same-origin with the UI. The page fetches the token first and then reports; without the token neither capability works. The channel also requires the request Host to be a loopback address, so a host bound to a non-loopback address or reached through a reverse proxy under a non-loopback name has it rejected. In a deployment without the web client the server still settles the timeout, but the draft never reaches the model context and indefinite wait has no effect.

**UI languages**

dsh 0.2.2 ships eight UI languages while the plugin recognises Chinese and English labels only. Under other locales the countdown, the wait-indefinitely button and the toolbar switch are not rendered, and the plugin's own bubble and config page fall back to English. The Japanese "回答" is identical to Chinese and is hidden, while the Japanese wait text stays visible and contradicts the withdrawn card. Card dismissal degrades to CSS hiding there and submit buttons stay enabled.

**Other**

- The plugin times the wait itself: on expiry it settles the timeout and releases the host-side foreground wait, and an answer you actually submitted before that moment still wins
- With several tabs on the same session the server keeps one draft snapshot per call id, so a later tab overwrites the one reported earlier
- Only the latest 200 draft records in bubbles are kept, so older bubbles can no longer be opened
- dsh 0.2.2 pre-selects recommended options when a card opens, and the plugin strips those presets by matching the original option labels from the projection; in multiple choice, once you click any option the remaining presets are kept under the host's own submit semantics
- Skipping every question without any selection or typed text counts as an empty draft, so that timeout closes the card
- The draft is merged per question from three sources in this order: the host's persisted record, the live value of the question on screen, then the plugin's own snapshot; when the live value is read, selected labels come from the host's screen-reader text, which may drop suffixes such as "(Recommended)"
- The timeout notice injected for the model is Chinese-only, so on an English UI the model still receives Chinese text
- A draft over the 256 KiB per-report limit makes the UI read "Draft too large; not delivered", which does not count towards consecutive failures; after three consecutive failures that question is judged channel-unavailable, the plugin stops taking it over and the card returns to the host and stays answerable

## Update and uninstall

Remove the old version before installing a new one:

```
dsh plugin --profile <profile> remove dsh-question-timeout-protection
dsh plugin --profile <profile> add <new package or tarball>
```

To disable without uninstalling, disable the plugin row in that profile's `cordis.patch.yml`.

## Development

```
pnpm install
pnpm build
pnpm typecheck
pnpm run check:translation
```

`pnpm run check:translation` verifies the three translation files, the config-page dictionary and the visible UI text constants against each other, and checks that a text change also updates the maintenance timestamp.

## License

This project is licensed under the [Apache License 2.0](./LICENSE). The copyright notice is in [COPYRIGHT](./COPYRIGHT).

Copyright (c) 2026 JularDepick

## Related links

- dsh repository: https://github.com/deepseek-ai/deepseek-harness
- dsh plugin development docs: https://github.com/deepseek-ai/deepseek-harness/tree/master/docs/user/develop
