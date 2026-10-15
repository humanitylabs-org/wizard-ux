# Remaining responsive browser parity

PR42 builds on live PR31 (`cd9c92d04c7ec6134cc75365626a024f52612954`), preserving the shared Settings/skins surface and the PR27 custody / PR40 foreground-Manager contracts. This is a web delta only: no native rebuild, deployment or merge in this lane.

## Common owners

- `core/commands.js`: the approved phone grammar and execution dispatch, including Music, apps, chat filters/search, navigation, Maps, skin/help/usage and review routes. Explicit command misses cannot enter agent routing. Normal desktop global talk now stages original audio before local-command STT; composer microphones remain pinned replies. Local outcomes retain original recordings without inventing a delivery receipt.
- `core/features.js`: lightweight common action/view registration, automatically discovered in shared Settings and accepted by deep links. Both shell window mounts use it. New actions/views do not require two registries. The synthetic browser test registers once, then discovers, mounts and executes in each shell. Command drawers retain the originating view rather than treating the new drawer as the command target.
- `core/views.js` / `views.css`: extracted existing day/week/month → project → thread renderers, review ancestry/rail actions and Maps. Phone pinch/animation and desktop window/keyboard geometry remain adapters. Both use actual generated review data. Maps searches/directions open Google Maps with the exact destination; the existing illustration is explicitly not a live GPS map.
- `core/capture-tools.js`: recording pause/resume action, screen-awake lifecycle, upload ownership/state, timeout/retry and screenshot reservation. Both layouts use the actual shared `core/screen-capture.js` and Chats uploader. The native/multipart phone recorder and browser recorder keep their input adapters. Desktop adds Pause/Resume, Screenshot, Attach/Retry/Remove, Finish and explicit Command/Dictate controls. Right Option's intentionally paused browser shortcut stays paused.
- `core/focused-field.js`: desktop browser dictation now seals the exact field, cursor range, value, document and view at START. Changed/detached fields are not overwritten or re-resolved. Late STT remains recoverable text/audio and cannot become an agent message.
- `core/bound-view.js`: common latest-reply view binding, original-thread metadata, dismissal and feedback submission. Desktop uses real bound iframes, not a phone embed. Both callers send feedback to the original thread despite focus changes; private route/model/files remain sealed.
- `core/sel-menu.js` and `pwa-install.js`: common browser selection actions (with share-to-copy fallback), and installation only when the browser supplies an install capability. Selection in another app still requires an OS accessibility adapter.

## Custody boundaries

Recording-start destination/model/provider/agent are not read again from the new foreground view. Manager conversation capabilities retain their separate pinned route; explicit commands, Dictate and composer replies cannot hijack it. Unknown/quarantined submissions never retry. Terminal tombstones, held audio, durable journals and input restoration are unchanged. The shared voice reply accepts an already obtained transcript without repeating STT, retaining its existing captured-run steer contract. Failed attachment uploads retain the original File and block finish until retried or explicitly removed.

## Finite scope

`responsive-capability-coverage.json` preserves all **73** canonical capabilities and the complete **163-row** legacy crosswalk. Its statuses distinguish current implementation, the already-live Settings slice, inherited shared features, platform adapters and the excluded preview. Reviews and local Maps are also recorded as supplemental browser views from the previous source inventory. This is an implementation delta against that finite audit, not another historical re-audit or a claim that all inherited features were exhaustively re-tested.

Native adapters remain native: Android Everywhere, physical side key, external-app accessibility, background recorder/reply watcher, Share intents, APK updater and Grab automation; native Mac key hooks remain their own input adapter. Android origin carry-in applies only to that migration. Browser push would require its own subscription/service-worker transport; it is not a fake desktop checkbox or an automatically ported Android background service. Browser screen capture requires `getDisplayMedia` or the native screen port, installation requires `beforeinstallprompt`, and wake lock is best effort where supported. Live Mode remains opt-in **simulated preview**, not production functionality.

## Verification boundary

All browser and sustained tests run on `thales.local`, under the external-volume QA directory `responsive-parity-remainder-20261015`, one Chrome instance at a time. No VPS browser, Android/VM build, device install, production message or deployment.

- `qa-responsive-remainder.cjs` uses the existing isolated-origin custody harness: real phone Android-UA/touch and desktop shells, common controls, real MediaRecorder with Chrome's fake microphone; STT/upload/install/screenshot-port responses are explicitly synthetic. It exercises registration, commands and misses, original-view chat search, review/Maps/Back, selection, bound callers, pause/resume, screenshot races, upload failure/retry, model pinning and cursor/stale-field dictation.
- `qa-responsive-parity.cjs` uses actual live GET data with the candidate static-source overlay, including shared Settings regression, actual generated review data and installed Music. All non-GET requests are fenced; beacons and service workers are blocked. Screenshots contain private live thread metadata and stay on Thales.
- `qa-voice-custody-callers.cjs` retains the existing full caller/steer/tombstone/held-audio scenarios, not a replacement mock-only outbox suite.
- `qa-manager-orb.cjs` uses the live Manager page and installed registry with fixture state and intercepted mutation requests; this proves route/custody, not real Manager admission.
- `npm test` discovers the existing guards plus common grammar/dispatch, bound lifecycle and finite inventory tests.

Final exact-SHA receipts are recorded below after the candidate gates complete. Parent owns protected-branch promotion and independent live phone/desktop verification.
