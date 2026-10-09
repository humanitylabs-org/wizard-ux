# Wizard UX — feature branches

Each feature lives on its own branch so it can be read, reviewed, and merged on its own. `daily` merges all of them and is what James runs on his phone. `master` is the web shell baseline the feature branches start from.

| Branch | What it adds | Files | Verified |
|---|---|---|---|
| `master` | Web shell: desks, slim nav-bar orb, Chats on the Wizard API, inbox shade, Mizel.ai recordings, Live Mode (demo only), Motion Kit, Back that never exits | `web/` | qa-os 54, qa 33, qa-live 15, qa-livemode 20, qa-motion 11, qa-recordings 7, Android Back 6 |
| `feature/pwa-install` | Each private app installs as its own Chrome PWA: own manifest `id`/scope, a scoped service worker, and a page install banner from the browser's real `beforeinstallprompt` | `web/manifest.webmanifest`, `web/sw.js`, `web/pwa-install.js`, `qa-android-pwa*.cjs` | Android Chrome: zero installability errors; Idea Queue and CineQueue each get their own prompt after Wizard OS is installed |
| `feature/native-shell` | Android app `ai.wizards.os`: WebView around `/wizard-os-home/`, hardware Back routed to the shell (never exits), mic for the private origin only, own persistent signer | `android/` (MainActivity, Origin), `web/app.js` (`__wosNativeBack`) | Native QA 12/12 on Thales |
| `feature/assistant-handoff` | `ai.wizards.os.action.LISTEN` opens the orb listening; `.SAY` puts words on Home as a draft James sends with one tap (never auto-sent) | `android/.../Handoff.java`, MainActivity handoff block, `web/app.js` (`__wosHandoff`) | Handoff QA 9/9, unit tests |
| `feature/side-key-assistant` | Hold the side button: full Wizard over the lock screen, small corner orb when unlocked (VoiceInteractionSession), hands words to Wizard OS via `.SAY`. Imported from Wizard Lock tag `side-key-0.2.0` (2b2e755); future behaviour arrives as new `side-key-*` tags | `android/.../assist/*`, `assets/assist/`, manifest block "Side-button assistant", `assist/README.md` | Device QA 30/30 (owner: lock-screen thread) |
| `feature/side-button-setup` | One-tap side-button switch: Home card + launcher "Side button" → mic asked in place → lands on Android's one assistant page → card turns green on return, disappears after the first real hold; Android's assistant gear opens Wizard OS; Samsung gets a shortcut to its Side button page | `SideButton.java`, MainActivity bridge, `web/app.js` side card, `tools/qa_side_setup.py` | Device QA 17/17 fresh + 17/17 signed upgrade over 0.3.0; qa-os 54/54 |
| `fix/back-exit-warn-guard` | When the guard is dropped for the exit warning, the resulting pop can land in a hosted frame; it is now ignored until it lands, so a single Back at Home never leaves and a real double Back still exits | `web/app.js` | qa-livemode 6/6 runs, qa-os 3/3 runs, Android Back 6/6 x2 |
| `feature/chats-parity` | Chats lists every Wizard thread (full paged walk) in Wizard's Work sections (Errors, Working, Ready, Yesterday, Past week, Deferred, Archive; Bangkok 06:00 day); attach photos/files on new chats, replies and steers (Wizard Files upload + `wizard_file_ids`); voice notes show mic + "Voice note" + length, tap to play | `web/app.js`, `web/live.js`, `web/styles.css`, `server.py` (CSP `blob:` for thumbnails), `qa-chats-parity.cjs` | qa-chats-parity 33/33 live (721/721 threads), qa-os 54/54 |

## Builds
Android builds run on Thales with `android-build-thales`, signed with the Wizard OS key (`3bf74d0b…ed1fd`), so every version installs over the previous one.
- 0.4.0 (`daily`): sha256 `e4d31e99ed58…dd7298`. Download: https://private.wizard001.com/reports/wizard-os/
- 0.3.0 (`daily` 2f7bf7f): sha256 `646520242a85…e3e79f`. Download: https://private.wizard001.com/reports/wizard-os/

## Rules
- Back never exits: Back steps out of the open view → Home → "Press back again to exit". Every Back change ships with a test.
- QA never writes to Archimedes: Hermes/Wizard writes are intercepted, and each suite checks for zero `/v1/runs`.
| `feature/everywhere-outbox` | Wizard OS 0.5.0: durable outbox (saved before send, idempotent retry, Not sent · Retry in thread/Inbox/Settings), Settings gear on Home, Wizard Everywhere floating button (Archimedes Anywhere merged in: hides while the app is open, draggable, remembered position, reply + not-sent notifications) | `web/outbox.js`, `web/app.js`, `android/.../everywhere/` | Web QA 22/22 + 54/54 + 33/33; device QA 25/25; upgrade 0.4.0→0.5.0 6/6 on Thales |
| `feature/recording-awake` | Wizard OS 0.5.1: the screen stays on while the orb records (shell `FLAG_KEEP_SCREEN_ON` via `WizardOSNative.keepAwake`; Screen Wake Lock API in browsers/PWAs; Everywhere bubble keeps the screen on while listening); released on send/cancel/page load | `web/app.js`, `MainActivity.java`, `EverywhereService.java`, `qa-awake.cjs` | qa-awake 11/11 (old tree 4/11), qa 32/33 (same as baseline); signed release built on Thales, sha256 `864663a75a0d…9d771` |
