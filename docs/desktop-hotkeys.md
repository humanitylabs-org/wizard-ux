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

Evidence: Thales exact staging-origin QA baseline 2 pass/2 fail; candidate 19/19, zero page errors or agent-run writes. Screenshots on Thales /Volumes/ThalesMedia/desktop-hotkeys-evidence/candidate. Review the source and recorded checks before handing off; extend cases for finish/cancel, local storage validation, keyboard activation, native hide, and normal toolbar mic.
