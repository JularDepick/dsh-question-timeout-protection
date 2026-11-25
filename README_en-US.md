<div align="center">

# dsh-question-timeout-protection

[![Version](https://img.shields.io/badge/Version-0.2.0-green)](https://github.com/JularDepick/dsh-question-timeout-protection/releases)
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
| Wait indefinitely | A button next to the countdown; one click removes the deadline until you submit, or the page or session ends |
| Auto wait indefinitely | A toolbar switch that puts every new question into indefinite wait |
| Selection fill | A chosen single-choice option fills the square marker in front of it |
| Timeout draft | The options you selected and the text you typed are kept at the moment of the timeout |
| Draft review | After a timeout the question row shows a bubble button; click it to read what you had entered |
| Context injection | When on, the draft returns to the model context with the tool result |

## Install

### Requirements

- dsh within `>=0.2.1-rc.1 <0.2.2-rc.0 || >=0.2.2-rc.0 <0.2.3-rc.1`; installation and startup refuse anything outside it
- Node.js >= 20

### Option A: install from npm

dsh installs plugins from npm natively:

```
dsh plugin --profile <profile> add dsh-question-timeout-protection
```

Installing by package name takes whatever the npm latest tag points at (0.1.4 at the time of writing). Versions 0.1.2 and earlier declare a dsh ceiling no higher than `0.2.2-rc.2`, so installation and startup reject them on dsh `0.2.2-rc.3` and later; pin a version with `dsh plugin --profile <profile> add dsh-question-timeout-protection@<version>`. Versions from 0.1.3 on support up to `<0.2.3-rc.1`, and Options B to D below install them from source or a tarball.

### Option B: build from source

For using the plugin straight from this repository:

```
pnpm install
pnpm pack
dsh plugin --profile <profile> add ./release/<tarball>
dsh plugin --profile <profile> add <absolute path>
```

`pnpm pack` builds first, then moves the tarball into `release/` at the repository root under a name like `dsh-question-timeout-protection-0.2.0.tgz`. Where a sandbox blocks lifecycle scripts, use `pnpm run pack:release` for the same artifact. A path passed to `add` is resolved against your current directory only when it starts with `./` or `../`; otherwise it is treated as a package name and looked up in the registry.

### Option C: install from the GitHub source

Use `github:JularDepick/dsh-question-timeout-protection#<commit>` as the package name; `prepare` runs the build.

pnpm 10 and newer block dependency build scripts by default, so the first `add` fails and prints a package key. Put that key into this profile's `pnpm-workspace.yaml`:

```
allowBuilds:
  dsh-question-timeout-protection: true
```

`allowBuilds` is available from pnpm 10.26; on earlier 10.x put the same package key into an `onlyBuiltDependencies` list.

Then run `add` again. Without this step the install lands with no build output and the plugin does not work.

### Option D: install from a release tarball

Download the tarball for the version you want and install it directly:

```
dsh plugin --profile <profile> add ./release/<tarball>
dsh plugin --profile <profile> add <absolute path>
```

No build is needed and the pnpm build-script policy does not apply.

## Quick start

1. Install the plugin into your profile with any option above
2. Restart dsh
3. Ask the model something so it asks you back; a countdown appears at the card's top right, and you can pause it with "Wait indefinitely" next to it

## Usage

### Countdown and warning

The countdown appears only on a **live question**, and it follows the plugin's own deadline: focusing the input or starting to type does not pause it. The deadline comes from the top-level `timeout` (seconds) the model passes to the question tool; without one the plugin uses its `timeoutSeconds` setting (120 by default). A `timeout` placed inside a question item is a misuse; the plugin only falls back to the first valid value found there when the top-level one is absent (`-1`, `0` and fractions are skipped). During the last seconds the number turns red and blinks. Once the deadline passes, the plugin withdraws its countdown and failure hints and restores the card to the host's own wait state; when the settlement arrives it decides whether to lock and withdraw the card or hand it back.

Historical questions and settled answers never show a countdown.

### Wait indefinitely

The "Wait indefinitely" button sits next to the countdown. Clicking it removes the deadline for this question and freezes the countdown as "Paused" until you submit.

Clicking it freezes the countdown immediately and registers the wait with the server; if that registration fails or the reply times out the freeze is withdrawn, the host keeps counting, the countdown slot reads "Cannot wait indefinitely" instead, and that round is handed back to the host.

### Auto wait indefinitely

The composer toolbar carries an "Auto wait indefinitely" switch to the left of the model selector. When on, every new question enters indefinite wait automatically, and a question already waiting freezes right away, exactly as if you had clicked "Wait indefinitely" once.

The switch state lives in browser storage and survives a refresh. Turning it off affects only later questions: frozen questions stay frozen and end when you submit. With several tabs on the same session, toggling the switch in one page is picked up by the others on their next scan, and a question that is still waiting freezes too.

The switch appears only while card enhancements and indefinite wait are both on.

### Timeout draft and read-only review

At the moment of a timeout the plugin keeps the options you selected and the text you typed in memory. That question's tool call row then shows a bubble button; clicking it pops a read-only floating card beside it with your selections and notes per question, offering no way to answer.

When the draft is empty, meaning you neither selected nor typed anything, the plugin closes the card on that timeout and no bubble appears.

The draft lives only in memory, so a page refresh loses the bubbles and their records.

### Custom text in single-choice questions

The host treats "the custom field has text" as "the custom answer is chosen", so a preset option and custom text cannot both hold, and clicking an option clears what you typed. The plugin makes the choice explicit: a radio button sits to the left of the custom field, on equal footing with the preset options, and only that button decides whether the custom answer is chosen — not whether the field has text.

- Custom chosen: the preset options lose their selected fill, the answer carries the custom text and an empty selection
- A preset option chosen: your custom text is not lost; a "Custom answer kept: … (click to use it)" button appears under the field, and clicking it switches back
- Custom chosen with an empty field: the host's own validation blocks submission (it asks you to answer first); the plugin adds no extra interception
- Multiple-choice questions are unaffected; custom text and options still coexist there
- The typed custom text and whether it is selected are written to localStorage, so they survive a refresh (the most recent 64 calls are kept)

### Context injection

This is on by default. While you are answering, the client always reports draft snapshots to the server (the adapter never reads the `fallback` mode; only the settings page maps its checkbox to it); the server decides whether to use them. When on, expiry takes the latest snapshot and returns it to the model context through the tool's pending result, per question, each keeping its own selections and notes; when off, the snapshot stays on the server and is cleared when the call ends.

The timeout notice and the draft share that one result. When a draft comes back, the notice tells the model to judge how complete it is and decide the next step, not to reveal that judgement to you, and to summarise the decision about this question after that next step.

With this off, the plugin only withdraws the card and hands the model no draft.

### Configuration

The config page sits at the **top of the plugin detail view**, not inside "Components". Only "Inject into context" can be changed, and a toggle writes immediately without any save or refresh. The page lists "keep the draft in the UI" and the three fixed features below as fixed rows for reference; none of them has a switch.

| Option | Values | Default | UI | Description |
|:---:|:---:|:---:|:---:|:---:|
| `fallback` | `ui` / `context` / `both` | `both` | One switch | Timeout fallback. The page only offers "Inject into context": checked writes `both`, unchecked writes `ui`. Keeping the draft in the UI is always on, so `context` never appears |
| `cardEnhancements` | boolean | `true` | Fixed | Decoration only: countdown and warning blink, a background fill on the square marker of the selected single-choice option, the custom-answer radio and its kept-content hint, the question bubble, and hiding the host's collapse controls and wait text. When off no decoration appears, while the timeout wrap-up still runs: the card that should be withdrawn is still withdrawn and locked, and the draft is still reported per the configuration above |
| `infiniteWait` | boolean | `true` | Fixed | Provides the "Wait indefinitely" button and the toolbar switch; turning it off removes both |
| `draftFallback` | boolean | `true` | Fixed | Timeout wrap-up switch. When off the client neither withdraws the card nor reports the draft and hands that question back to the host; the plugin still settles the wait on time |
| `warningSeconds` | number | 5 | Not exposed | Seconds remaining when the red warning starts, from 1 to 60 |
| `timeoutSeconds` | number | 120 | Not exposed | Wait seconds used when the model does not pass one explicitly, from 1 to 2147483. This is the plugin's own default; the host's built-in timed question tool also defaults to 120, but that is a different source |

The last two are not exposed in the UI; write them into this plugin's row under `config` in the profile's `cordis.patch.yml`, for example `config: { timeoutSeconds: 300 }` for a 300-second wait. Out-of-range values fail loudly at load time. The three fixed features are switched off the same way, for example `config: { cardEnhancements: false }`; restate every key that row needs rather than only the changed one.

## Compatibility

| Item | Version |
|:---:|:---:|
| dsh | `>=0.2.1-rc.1 <0.2.2-rc.0 || >=0.2.2-rc.0 <0.2.3-rc.1` |
| Node.js | >= 20 |

The Node.js requirement of the host dsh itself follows the release notes of the matching version.

The range is split in two to satisfy both checks. The host evaluates it with `includePrerelease`, where the single `>=0.2.1-rc.1 <0.2.3-rc.1` suffices, but npm and pnpm verify peer dependencies with strict semver: a prerelease version passes only when the range carries a prerelease comparator of the same `major.minor.patch` tuple. The single range names only 0.2.1 and 0.2.3, so 0.2.2-rc.x is rejected on the peer side. Naming the 0.2.2 prerelease in a second segment makes both checks accept the same set, and the union is still equivalent to `>=0.2.1-rc.1 <0.2.3-rc.1`.

## FAQ

**Will my input be lost when the question times out**

Not on this page. At the timeout the plugin keeps your selections and typed text in memory and records them in that question's bubble button, which you can open at any time. A page refresh does erase that record.

**Can the model see what I typed**

It depends on the "Inject into context" checkbox. When checked the draft reaches the model context with the tool result; when unchecked it stays in the UI only.

**Why did the card disappear**

Because that question timed out and the plugin took it over. The plugin withdraws and locks the card so it does not leave a dialog you can no longer answer. To review what you had entered, use the bubble button on the question row; when nothing was selected or typed at the timeout no bubble appears.

**Why is there no countdown on my screen**

Common reasons include: card enhancements are off; that question was a blocking one the model marked with `-1`; or your UI language is neither Chinese nor English. Also, on a page refresh, when the card is already in its editing or waiting state the plugin cannot restore the deadline, so no countdown appears until the card returns to counting.

**What happens after I click "Wait indefinitely"**

This question no longer has a deadline and the model keeps waiting until you submit, or the page or session ends. If the state channel is unavailable the button does not take effect: nothing stays frozen, the countdown slot reads "Cannot wait indefinitely", and that round is handed back to the host, which keeps it answerable.

**The bubble is gone after a refresh**

The draft lives in memory only and is never persisted, so a refresh loses the bubbles and records on this page. A still-waiting question is re-evaluated from the host's persisted draft.

**Do I need to edit my presets**

No. The plugin registers an identically named question tool in each agent scope, shadowing the host's blocking question by scope proximity.

**Will it submit answers for me**

No. A timeout never selects an option and never submits a draft as a formal answer.

## Known limits

**Depends on the host UI**

Cards and tool rows are located through host class-name suffixes, `data-question-key`, `data-chat-call-id` and `aria-checked`; host controls are recognised by their Chinese or English labels (the Japanese `回答` is identical to the Chinese one, so that entry matches too); when restoring the host entry after settlement the plugin also recognises `查看回答` / `View answers` / `回答を表示`. The toolbar switch prefers the model selector's accessible name, falls back to structural placement inside the composer toolbar, then to a document-wide lookup, and logs one console.warn per reason instead of failing silently. If the host changes those structures or labels the matching enhancement stops working; the recognition labels and selectors live in the source constants file.

**Depends on the host question projection**

The client relies on the userQuestions projection of the host sessions service to tell whether a question entered the continued state; draft reporting, the timeout wrap-up and the bubble all follow it. If that service is missing or the interface is renamed the plugin logs one console.warn per session: the countdown and card decoration stay, and while the card still shows the host waiting state the draft is still reported and still rides the tool result back to the model, but the wrap-up does not run and no bubble appears.

**Session subscription cap**

At most 8 sessions keep a projection subscription at once. Beyond that the least recently seen session degrades to per-second polling and its timeout takeover arrives later; the polling fallback is also capped at 8, and past that the least recently seen session is released, so its timeout fallback may stop working.

**No persistence**

The draft lives in client memory, so a refresh loses the bubbles and their records. A still-waiting question is re-evaluated from the host's persisted draft and taken over when the takeover conditions hold; settled rows are not restored.

**Indefinite wait and draft reporting need the web client**

Both share one token-protected channel mounted on the host's own HTTP service, same-origin with the UI. The page fetches the token first and then reports; without the token neither capability works. The channel also requires the request Host to be a loopback address, so a host bound to a non-loopback address or reached through a reverse proxy under a non-loopback name has it rejected. In a deployment without the web client the server still settles the timeout, but the draft never reaches the model context and indefinite wait has no effect.

**UI languages**

dsh 0.2.2-rc.1 ships eight UI languages while the plugin recognises Chinese and English labels only. Under other locales the countdown, the wait-indefinitely button and the toolbar switch are not rendered, and the plugin's own bubble and config page fall back to English. The Japanese "回答" is identical to Chinese and the plugin hides it for a moment, but it cannot recognise the Japanese close button, so once the dismiss retries are used up that round is handed back and both the entry and the card are restored; only a three-to-five second transition stays inconsistent, depending on how often the scan fires. In the remaining locales the host answer entry and its wait text mostly stay visible. Under Japanese, a timeout with an empty draft produces no plugin bubble, and the host entry is hidden only briefly before being restored, so the read-only card can still be reopened. The plugin cannot find the host close button there, so once the dismiss retries are used up that round is handed back to the host: the card stays visible and answerable (its locked state is restored) and the host's own wait status and answer entry take over, while timeout settlement and draft reporting still happen.

**Bounded by the enclosing program budget in PTC mode**

When the model asks from inside `run_code` (PTC mode), that question lives only as long as the enclosing program's elapsed-time budget: on expiry the host stops the program hard and aborts the in-flight question, so the on-screen countdown disappears mid-way and the draft never reaches the model. The plugin records the enclosing budget while the question is live and shrinks its wait to "remaining budget minus the settle margin": the question settles itself as a timeout before the budget expires, the draft still rides the pending result back to the model, and the countdown shows the shrunk duration. When the usable time left after the settle margin is under two seconds no card is opened; the call fails immediately as budget-insufficient and the model is told to raise the enclosing budget, so no answerable card is left behind. Indefinite wait cannot outlive the enclosing budget: a frozen question still ends when the budget expires, though its draft is kept. An interrupted question leaves a read-only bubble on the tool row so the draft as it stood at that moment can still be read. A run_code nested inside another run_code shrinks the wait to the inner budget; the budget clock starts when the program is actually dispatched, so latency from earlier wrappers does not count against it; when the draft rides the pending result back to the model it is capped per question and per round, and the same result says so, so an oversized draft is not swallowed whole by the host's tool-result pruning.

**Other**

- The plugin times the wait itself: on expiry it settles the timeout and releases the host-side foreground wait, and an answer you actually submitted before that moment still wins
- With several tabs on the same session the server keeps one draft snapshot per call id, so a later tab overwrites the one reported earlier
- Only the latest 200 draft records in bubbles are kept, so older bubbles can no longer be opened
- dsh 0.2.2-rc.1 pre-selects recommended options when a card opens, and the plugin recognises those presets by matching the original option labels from the projection, then decides per question as a whole set: it strips them only when the selection equals the presets exactly, so a recommended option you actually picked (the in-memory interaction record is gone after a refresh) is not stripped into an empty draft; in multiple choice, once you click any option the remaining presets are kept under the host's own submit semantics
- Skipping every question without any selection or typed text counts as an empty draft, so that timeout closes the card
- The draft is merged per question from three sources in this order: the host's persisted record, the live value of the question on screen, then the plugin's own snapshot; when the live value is read, selected labels come from the host's screen-reader text, which may drop suffixes such as "(Recommended)"
- On the macOS desktop app, dsh 0.2.2-rc.2 allows window dragging only inside header rows carrying `data-window-drag`, and the host automatically excludes drag on controls inside a `data-window-drag-controls` container; a custom overlay covering a drag row must declare `data-window-drag-exclude` to stay interactive, and `--dsh-frame-top-clearance` reserves a strip at the top. The plugin's draft panel is attached to the body and declares neither, so near the top of the window it may fall into the reserved strip. The panel holds no clickable controls, so the effect is positional only; the web client is unaffected
- The timeout notice injected for the model is Chinese-only, so on an English UI the model still receives Chinese text
- Closing a card relies on the host's close button: when that button is disabled during submission, or the UI language is not Chinese or English (labels do not match), the plugin cannot click it; after a few retries that round is handed back to the host, the card stays visible and answerable, and the host's own wait status and answer entry take over
- A draft over the 256 KiB per-report limit makes the UI read "Draft too large; not delivered", which does not count towards consecutive failures and retries at a fixed interval (about five seconds), so trimming the text restores reporting; after three consecutive failures that question is judged channel-unavailable, the plugin stops taking it over and the card returns to the host and stays answerable

## Update and uninstall

Remove the old version before installing a new one:

```
dsh plugin --profile <profile> remove dsh-question-timeout-protection
dsh plugin --profile <profile> add <new package or tarball>
```

To disable without uninstalling, disable the plugin row by id in that profile's `cordis.patch.yml`:

```
- id: question-timeout-protection
  disabled: true
```

## Development

```
pnpm install
pnpm build
pnpm typecheck
pnpm run check:translation
```

`pnpm run check:translation` verifies the three translation files, the config-page dictionary and the visible UI text constants against each other, and checks that a text change also updates the maintenance timestamp.

`src/translation/*.ini` mirrors one set of wording and is not read by the UI: visible text comes from `src/constants.ts` and `src/client/i18n.ts`, so a wording change must update those and the three ini files together.

## License

This project is licensed under the [Apache License 2.0](./LICENSE). The copyright notice is in [COPYRIGHT](./COPYRIGHT).

Copyright (c) 2026 JularDepick

## Related links

- dsh repository: https://github.com/deepseek-ai/deepseek-harness
- dsh plugin development docs: https://github.com/deepseek-ai/deepseek-harness/tree/master/docs/user/develop
