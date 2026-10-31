# Instant voice/song admission (31 October 2026)

**REUSE / EXTEND:** `WizardApp.capture` → `WizAppCapture`, existing browser/native engines, Web Lock, IndexedDB custody and Appearance host. No app-owned recorder, new recorder implementation, or change to the orb's recorder. Meeting/PCM/resume admission retains its established recovery protocol.

For a fresh compressed audio/song take, the exclusive mic lock is requested without waiting. A local startup recovery pass yields its maintenance lease before that request. Existing physical native/meeting ownership remains a hard admission check; a second app/window cannot record. Only a real engine start returns the recording session. Persistence opens/creates its row in the background; chunks remain buffered until writable. Storage failures warn without stopping physical capture; Stop retains retryable custody, and a stuck initial persistence wait is bounded. The memory queue also counts toward the configured size limit. Discard remains explicit.

The `attach` no-live-native fast path avoids waiting on IndexedDB just to prove a browser take is not currently running. Live native recovery and same-app owner-scoped reattachment remain unchanged.

## Reproduction / evidence boundaries

`qa-app-capture/instant-start.cjs` uses real Chromium getUserMedia, MediaRecorder, IndexedDB and Web Locks with synthetic microphone input and native contract mocks. It injects 1400ms store/row/recovery delays, failed storage, delayed permission and a never-resolving optional meter resume. Each successful take is stopped and read back from pending custody, not just a changed UI label. Permission must actually be granted before recording; an occupied lock must refuse, never open a second microphone. A deliberately delayed Web Lock service cannot safely be bypassed.

`qa-app-capture/messenger-instant-shell.cjs` loads the actual shell, its shared capture service, hosted app-client, exact Messenger composer/icons/CSS and synthetic dependencies. It verifies the timer within 300ms despite slow row persistence, zero backend/external requests, and the same take across live Nebula/Grove changes. Set `MESSENGER_ROOT`, `QA_WEB_DIR`, `QA_OUT`, `QA_PLAYWRIGHT` and `CHROMIUM` to the staged source/toolchain.

Use a matching Playwright/Chromium toolchain. Old Playwright 1.55 with Chromium 156 hangs AudioWorklet module loading; baseline does too. Playwright 1.64.1 with Chromium 156 runs the complete PCM/native contract suites.

No physical-phone stage telemetry was available. Access-log UA distinguishes Pixel browser/PWA from Samsung WebView but cannot prove the actual runtime bridge or hung await. These controlled delays prove the removed critical-path waits, not which await hung on James's device. Browser/PWA without `WizardOSDevice` uses getUserMedia; full Android `WizardOSDevice` uses the existing native adapter. Lightweight `WosDeviceRecording.device()` is checked for ownership but is not the full-app `WizardOSDevice` recording adapter; its physical fallback remains unproven.
