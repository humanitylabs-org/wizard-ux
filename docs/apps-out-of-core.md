# Optional apps out of core (refactor plan)

James, 26 Oct 2026: Wizard OS core (web shell and Android shell) stops naming feature apps. Food, the phone-app tiles, Music, the Video Editor companion desk, the hard-coded app id lists, Photos and Recorder (formerly Mizel.ai) become optional installed apps over generic, versioned device capabilities. Builds on [android-thin-shell.md](android-thin-shell.md). Reviewed with Claude Fable over two rounds (transcripts in the Wizard OS context sources, 2026-10-26-hardcoded-apps-refactor-*).

Stays core: Chats, Settings, Agents, App Store, Setup, Troubleshooter, side button, Android Apps installer bridge, generic mic/recording, Files. Miguel's `mizel` skin is a skin, not the Recorder; it stays.

## Rules

- Native never takes routes or automation steps from an app. Routes derive from the owner-chosen slot provider's own path prefix, handed to native by the shell at grant time.
- The device port is the broker. No second broker, no intent/slot parser in core: apps declare literal voice names (registry `voice_names`); everything else is forwarded to the app frame.
- Extend existing registry fields (`voice_names`, `provides`, `system`, `view`) before adding manifest fields; a new field needs a COMPONENTS.md row.
- Old ids keep working through one alias table (desks, recents, pins, sigils, single-app session, home-screen shortcut hash `identity(origin, app)`).
- Device data (saved Food orders, photo backup ledger, meeting journal and unsent takes) never moves; only the owning app label is aliased.
- Owner-preference seeds are a versioned migration in the synced store, marker beside the data, run only when the key is absent.
- Server routes that any installed APK pins (`/mizel-live/`, `/mizel-live/orb-events`, `/meetings/api/meetings/<id>/chunks`) stay served until the updater shows the replacing APK installed and logs show no caller.
- The meeting service changes once per APK release, and only together with the shared-capture native-ownership change.

## Slices

| # | Ships | Gate | Rollback | Where |
|---|---|---|---|---|
| 1 | CI grep for feature app ids in core (web + android), allowlist of today's violations; baseline recordings of Food, Recorder, Photos backup, Music | grep green; recordings stored | none | CI |
| 2 | Recorder backend cutover: wizard-recorder running as `meeting-recording` provider, mizel stopped, pinned routes aliased | parity PASS live Mizel vs Recorder; handset meeting through current APK lands in Recorder | restart mizel | server (owned by the Recorder live-parity work) |
| 3 | Launcher lists, phone-app tiles, recents defaults, desktop quick list, auto-open, hosted-thread apps, sigil house map, Signal short name from registry + seeded owner prefs | both shells boot James's exported state, zero page errors, screenshots match | redeploy web | web |
| 4 | Generic companion pane API; video-desks.js removed; dual message types for one release | Playwright with Video Editor + nested Back test | redeploy web | web |
| 5 | Voice: open aliases from registry, utterances forwarded to app frames; music/food grammar leaves core | table tests from installed manifests; duplicate alias rejected | redeploy web | web |
| 6 | Music: grant-keyed background-audio admission; web sends legacy `wizard-music` token until APK A | play, lock, controls, close stops audio (emulator + handset, current APK) | redeploy web | web |
| 7 | Recorder shell rename: alias table incl. shortcut hash | existing pin opens Recorder and reads pinned; meeting survives reload; handset recording | redeploy web | web |
| 8 | Photos settings and Food UI/words in their own app repos over legacy bridge methods | parity PASS per app vs live source; Food teach/replay on emulator identical | redeploy web | web |
| 9 | APK release A: grants store + native prompt; discovery advertises generic capabilities; audio admits granted apps; meeting service, event sync and upload read the provider prefix; trusted paths = shell + provider prefixes; backup worker endpoint from the Photos grant (Immich leaves native); usuals exposed as `device.automation@1`; shared-capture ownership change. Legacy methods kept, all dark behind web flags | emulator instrumentation on both paths; updater install on handset; every feature exercised | forward-fix; flip web flags to legacy | APK |
| 10 | Flip one capability flag at a time to the generic path | handset check per capability; zero queued photo re-uploads | flip flag | web |
| 11 | Food on real Grab: James teaches and replays one order to the checkout stop | handset recording, or logged pre-existing defect + James's call | none | handset |
| 12 | APK release B: legacy methods, Mizel constants and server aliases deleted | A installed for a stated period, no legacy caller in logs | none | APK |

## Web slices 5+6 contract

Reuse: `WizCore.apps`, verified `WizAppServices` / `WizardApp` frame connection, native audio port.
Extend: registry `voice_names` for literal open-app aliases; registry `provides` for `background-audio` admission; existing command dispatch and shared SDK.
New: `app-voice.js` routing only; `voice-legacy.js` and `background-audio-legacy.js` deletion-bounded compatibility (COMPONENTS rows).

- Registry order is the install order for competing `voice_names`: the first declaration wins; later conflicting claims are refused with a console warning. Names are normalized exactly like existing app lookup. Cached registry entries retain aliases, but new audio grants require a fresh trusted registry response.
- `WizardApp.voice.commands.register({claims(text, context), receive(text, context)})` registers one synchronous boolean claim and an async/sync receiver on the verified current app document; returns unregister. The shell keeps its own navigation priority; app grammar then gets the original transcription, never a shell-parsed intent. Typed text and tap-to-message still use their pre-refactor routes. A claim token expires on consumption, document replacement, receiver replacement, frame close or registry removal.
- Live Music source was traced from its systemd unit to its release checkout, `src/music/voice.ts`: it accepts `wizard-os:voice` raw text and `wizard-os:music` parsed commands. It has no shared SDK claim registration; its raw parser does not include the shell's open-and-play spell. `voice-legacy.js` therefore freezes *all* current shell phrases and the ack/done transport together, including Food browse/open and saved-order priority. It does not fork or edit Music. Delete this adapter when installed apps supply names and claim handlers with equivalent grammar, and Food ordering moves to its app over APK A automation. The Food native UI/ordering bridge stays unchanged.
- `WizardApp.device.backgroundAudio.request(method, params)` uses the existing verified service connection and the same native port as the old message envelope, not another broker. A live app's registry `provides: ["background-audio"]` is the owner-installed grant (no new manifest field). The exact installed document, origin, shell attachment and grant are rechecked at invocation/reply. There is one device player/session; the latest attach/load/play owns explicit-close pause. Reload/detach preserves playback; explicit close pauses while retaining queue and position.
- `background-audio-legacy.js` alone seeds the current Music pilot's grant and maps every admitted provider to the old native `wizard-music` token. Delete this module after APK release A accepts grant-keyed actual app ids. No Android files change here. Current-APK lock-screen/handset proof remains the APK release gate, not a claim made by browser unit tests.
- `tests/fixtures/voice-baseline` is frozen from origin/main `dafb1ad7`. The generated table expands every finite regex alternative; infinite query/name captures use representative values, and all five view contexts and three input modes compare exact action objects. This proves grammar branches, not infinitely many arbitrary song names.

## Failure modes and the test that catches each

- Blank launcher from a saved desk naming a removed id: boot both shells with James's exported desks/recents.
- Recorder pin dies on rename: pin under `mizel` on the emulator, update web, tap, Recorder opens and reads pinned.
- Orphaned meeting when ids change mid-recording: start meeting, deploy web, reload, still live, completes into journal.
- Background audio admission widens or denies Music: unit cases (foreign frame denied, Music admitted, close stops).
- Whole photo library re-uploads: emulator with seeded ledger, zero queued uploads after update.
- Old APK silently lacks a capability: discovery absent, UI says the phone app needs updating.
- Voice phrase lost or contested: generated command table tests, duplicate alias rejected.
- Food runs without the cover or past checkout: instrumentation asserts overlay shown and halt at checkout, plus handset recording.
- Back exits in single-app session or companion pane: standing nested-view Back test.
