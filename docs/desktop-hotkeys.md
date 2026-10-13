# Desktop voice-hotkey switches

Request: easy top-right enable/disable controls for desktop voice hotkeys; pause Wizard Right Option dictation while James uses system Voice Sync; preserve operating-system bindings.

Lane: Consequential (new user-facing controls). Direct Hermes implementation follows James's suggested placement and existing toolbar tokens; no broader design changes.

Acceptance:
- Two independent, accessible top-right one-click switches for Right Option dictation and Right Command talk.
- Right Option off by default; disabled events remain unconsumed; Right Command initially stays enabled.
- Choices persist on this browser and synchronize across same-origin windows.
- Pausing a key preserves an active recording and provides an explicit finish/cancel control.
- OS/native global bindings untouched; browser controls hidden in native Mac wrapper.

Delivery split: immediate scoped conflict repair on live daily (pause the PWA Right Option handler); complete reversible-controls feature on isolated staging for James's acceptance.

Evidence (parent verified): Thales exact staging-origin focused QA 31/31 with explicit fixture transcription, cursor text insertion after pausing Option, active paused-Command Send reaching intercepted audio-upload and agent-admission endpoints, reload persistence, actual second-window synchronization, chords, native-Mac ownership and 1000px fit. Baseline before controls: 2 pass / 2 fail. Every backend write is intercepted; these are UI pipeline checks, not a provider transcription accuracy test. Screenshots on Thales `/Volumes/ThalesMedia/desktop-hotkeys-evidence/candidate-final`.

Review: independent source review approved the scoped live pause and found no feature source must-fix. Its requested acceptance correction (successful Insert/Send rather than merely returning idle) is implemented and exercised in the final 31/31 suite. Merge of current daily preserves fullscreen and microphone-lock repairs; conflict resolution keeps the feature's guarded optional Option tap and successful-completion test.

Live repair: `e7a4ec7`, web tree `8b96e1cdee25f9761ee134db5bb51842877527b9`, served desktop JS SHA256 `a44af66b1102e4319d7e26cab1f7eb8bd708ab4b607a310ed4141213431a02e0`, read back from Thales on the actual tailnet origin; 7/7 focused and 22/22 fullscreen live. Native and OS bindings unchanged.

Preview: https://desktop-hotkeys.staging.wizard001.com/wizard-os-home/?shell=desktop&open=chats . One residual gate: James accepts these new toolbar controls before their production promotion. Physical Voice Sync coexistence on his own laptop remains outside browser automation evidence.

Broad historical `qa-desktop.cjs` smoke is stale: existing-baseline focus failure then timeout, candidate 47 pass / 6 fail in legacy focus/fullscreen/inbox/shortcut assumptions. It is not an acceptance receipt for this feature; current focused keyboard and current 22/22 fullscreen checks cover the changed surface.
