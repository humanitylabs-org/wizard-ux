# Launcher shortcut and app-pin repair

REUSE: `viewChrome` app picker and `goApp` existing-window routing, AI apps right-click menu, layout's existing `pins` storage and `paintVt`.
EXTEND: existing `api.keys` dispatcher with physical-left-Option tracking and release/blur reset; opt-in picker `includeOpen` flag; installed pin validation includes `kinds.dev` launcher links.
NEW: regression assertions only. No new UI, pin store, native shortcut binding, or skin CSS.

Owner trace (live predecessor `c54bc0da68773381237029f721b992bcf0e45f90`): desktop `onKey` forwards into `WosSkinHost.key` before its ordinary AltSpace palette route, including same-origin frame Window capture. AI apps `Space` handled AltSpace by `api.voice.talk`, overriding that palette route. Existing Mac VoiceKeys source handles only right Option (61) and right Command (54), with chord suppression; no left Option/Space native change is needed for this web override. The installed Mac binary is not device-verified by the Linux harness.

The shared picker deliberately excluded open IDs and AI apps pins, explaining the missing already-open Video Editor. `video-editor` is an installed `launcher.json` app projected into `kinds.dev`, while `api.apps.list()` is quick Apps only. Pin accepted its ID, then immediate `paintVt` → `refreshPins` dropped it against that incomplete list. Validate against installed Apps plus launcher links, keeping the existing stored pins and explicit empty list semantics.

Verification runner: `QA_LOCAL_ONLY=1 QA_LAUNCHER_ONLY=1 QA_OUT=<out> node qa-voice-custody-callers.cjs`; synthetic API interception, real shell, trusted keyboard/pointer input, two desktop/phone skins. `tests/ai-apps-view.test.mjs` adds release/repeat/right-chord and pin/remount regressions. No real messages, microphone audio, account writes or owner data are used. Native right Option tap/right Command remain unchanged, not falsely claimed as device-accepted.
