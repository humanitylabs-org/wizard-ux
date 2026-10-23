# Android document-scroll port: 0.10.7 / 71

Reuse:
- chat renderer / reading place: REUSE the four live shell files at `7bb29a6e` byte-for-byte (`chats.js`, `chat-power.js`, `chats.css`, Obsidian `intro.js`).
- native acquisition: REUSE stock WebView scrolling, discovery and platform capture. Remove the custom callback, JS/proxy metrics and accessibility instrumentation.
- cancel race: REUSE `ScrollCaptureCrashGuard` and its unit test from `0805e4cc`; retain pairing, Connect skin and existing predictive Back handling from `4e357e01`.
- NEW: none.

The APK appends `WizardOS-DocScroll` beside its existing Android version UA. Live shell code gates document scrolling on that capability, not a version comparison. Older APKs keep inner scrolling. The browser fixture sends the capability; native QA asserts the real APK sends it, without overriding its UA.

The native/SystemUI harness uses the real shell and read-only synthetic API, hides only the offline update-feed error banner, keeps real fixed chat chrome, reopens after editor dismissal, and retries the identified AOSP CancellationSignal race once. Aborted-attempt checks are preserved separately so successful retry still emits the chain's exact 31-check contract. A failed geometry/discovery check cannot be hidden by retry.

Source contracts for Snooze, reply context and model-switch layout match the required live files, rather than reverting live behavior to the older phone branch. No unrelated live web modules are imported.

Release acceptance pins the published 0.10.5 APK SHA256 `afc4ec0023ab152b454180362aeee6d68b7ebf8ebb39009a0c5a93c6e04d96e0`, expects 0.10.7/71 and the established signer. Heavy build/lint/JUnit, signed upgrade and API35 screenshot stitching run on Thales only. Preparing jobs is not Android build or device acceptance. Galaxy S25 Ultra / One UI toolbar, real keyboard and selection remain physical-device gates. Back must not exit; nested/root browser Back is checked on both skins and native Back remains in the Thales chain.
