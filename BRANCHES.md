# Wizard OS — feature branches

Each feature lives on its own branch so it can be read, reviewed, and merged on its own. `daily` merges all of them and is what James runs on his phone. `master` is the web shell baseline the feature branches start from.

| Branch | What it adds | Files | Verified |
|---|---|---|---|
| `master` | Web shell: desks, slim nav-bar orb, Chats on the Wizard API, inbox shade, Mizel.ai recordings, Live Mode (demo only), Motion Kit, Back that never exits | `web/` | qa-os 54, qa 33, qa-live 15, qa-livemode 20, qa-motion 11, qa-recordings 7, Android Back 6 |
| `feature/pwa-install` | Each private app installs as its own Chrome PWA: own manifest `id`/scope, a scoped service worker, and a page install banner from the browser's real `beforeinstallprompt` | `web/manifest.webmanifest`, `web/sw.js`, `web/pwa-install.js`, `qa-android-pwa*.cjs` | Android Chrome: zero installability errors; Idea Queue and CineQueue each get their own prompt after Wizard OS is installed |
| `feature/native-shell` | Android app `ai.wizards.os`: WebView around `/wizard-os-home/`, hardware Back routed to the shell (never exits), mic for the private origin only, own persistent signer | `android/` (MainActivity, Origin), `web/app.js` (`__wosNativeBack`) | Native QA 12/12 on Thales |
| `feature/assistant-handoff` | `ai.wizards.os.action.LISTEN` opens the orb listening; `.SAY` puts words on Home as a draft James sends with one tap (never auto-sent) | `android/.../Handoff.java`, MainActivity handoff block, `web/app.js` (`__wosHandoff`) | Handoff QA 9/9, unit tests |
| `feature/side-key-assistant` | Hold the side button: full Wizard over the lock screen, small corner orb when unlocked (VoiceInteractionSession), hands words to Wizard OS via `.SAY`. Imported from Wizard Lock tag `side-key-0.2.0` (2b2e755); future behaviour arrives as new `side-key-*` tags | `android/.../assist/*`, `assets/assist/`, manifest block "Side-button assistant", `assist/README.md` | Device QA 30/30 (owner: lock-screen thread) |
| `fix/back-exit-warn-guard` | When the guard is dropped for the exit warning, the resulting pop can land in a hosted frame; it is now ignored until it lands, so a single Back at Home never leaves and a real double Back still exits | `web/app.js` | qa-livemode 6/6 runs, qa-os 3/3 runs, Android Back 6/6 x2 |

## Builds
Android builds run on Thales with `android-build-thales`, signed with the Wizard OS key (`3bf74d0b…ed1fd`), so every version installs over the previous one.
- 0.3.0 (`daily` 8ebbbf3): sha256 `646520242a85…e3e79f`. Download: https://private.wizard001.com/reports/wizard-os/

## Rules
- Back never exits: Back steps out of the open view → Home → "Press back again to exit". Every Back change ships with a test.
- QA never writes to Archimedes: Hermes/Wizard writes are intercepted, and each suite checks for zero `/v1/runs`.
