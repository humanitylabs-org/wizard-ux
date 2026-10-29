# Historical: initial desktop new-chat shortcuts candidate

**Superseded:** This note records the earlier 0.5.1-based experiment only. Current commands, native 0.5.2 installation requirements and release evidence are in [desktop-commands.md](desktop-commands.md). The “no native update” statement below applied only to that earlier limited experiment and is not the current delivery instruction.

Requested: a desktop hotkey for a new chat, and a voice hotkey that always creates a new chat.

## Interaction

- Wizard for Mac: **Command-N** opens and focuses a fresh composer. **Command-Shift-N** starts a new-thread voice take; the same chord again sends it.
- Desktop browser: **Option/Alt-Enter** opens a new chat; **Option/Alt-Shift-V** starts/sends a new-thread voice take. These avoid browser-owned New Window/Incognito chords.
- Control-N / Control-Shift-N are additional native/non-Mac aliases.
- Right Command and the current thread's microphone retain their existing reply destination. New voice remains new-thread-bound when the focused thread changes, and leaves other composers' text/files alone.
- Recording key autorepeat is consumed. Pressing the new-voice chord during reply recording, dictation or transcription preserves that operation and gives a finish-current-recording notice. Cancel discards the take without creating a session.

## Verification

All browser/native execution took place on **Thales**, using isolated staging and intercepted write endpoints.

- Untouched daily baseline: fails `Command-N opens a fresh New chat`, confirming the added behavior.
- Final staging served assets: `qa-new-chat-keys.cjs` **26/26**. Includes input/iframe focus, draft retention, pinned destination across navigation, actual MediaRecorder audio and durable outbox new-session delivery through intercepted APIs, active reply/dictation/transcription guards, both browser aliases, cancel/autorepeat, and Back preservation.
- Command-W existing regression: **13/13**.
- Native WKWebView/AppKit event path: **5/5**. An isolated QA-only copy of Wizard 0.5.1 injects NSEvents into the real AppKit key-equivalent/responder chain; production native sources and app stay unchanged. Both chords reach the web shell, send-again enqueues exactly one `kind:new` audio message, and Wizard remains open. Audio is a generated test tone captured by actual MediaRecorder; live microphone permission and physical hardware keys are not claimed by this test.
- Native preferences restored with exact semantic readback. Test app stopped afterward.
- Independent source review: no implementation defects; native evidence gate subsequently cleared by the AppKit/WKWebView run. Its deferred Control-Shift-N and dictation/think coverage was added and passes.

Remote evidence: `$WIZARD_WORK_ROOT/Projects/wizard-desktop/new-chat-keys/evidence/`.
Local receipt projection: `$HERMES_HOME/cache/scratch/new-chat-keys-evidence/`.

## Reproduce

Browser suite (Thales):

```sh
PLAYWRIGHT_PATH="$HOME/workspace/wizard-mobile-link-candidate/node_modules/playwright" \
QA_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
QA_LIVE=1 QA_OUT="$PWD/evidence/staging" \
node candidate/qa-new-chat-keys.cjs "${QA_ORIGIN:?Set an isolated tailnet preview origin}/wizard-os-home/?open=chats"
```

Native: build the QA-only event injector with `tools/qa-native-new-chat-injector.py` on Thales, then run `qa-native-new-chat-keys.py`. It uses the existing QA notifier and refuses to disturb another running Wizard.app.

## Release boundary

Historical preview: `/wizard-os-home/?open=chats` on the retired custom domain. New runs require an isolated tailnet `QA_ORIGIN`.

**Staged only.** Candidate was built from daily `9983350`. No live assets, daily/main branch, native release download or upstream remote has been changed. James's approval is required for feature promotion. Promotion changes only desktop web assets, requires no native-app update and keeps phone code unchanged; reload the Wizard desktop to load it. Preserve any subsequently advanced daily source and rerun the targeted gates against the integrated exact revision.
