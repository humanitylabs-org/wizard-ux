# Legacy-origin native cleanup — release reservation

Reserved under the Wizard UX release lock: **0.9.21 / versionCode 45**, package `ai.wizards.os`, branch `fix/retire-legacy-origin-20261014`. Feed observed at 0.9.20/code44, SHA256 `7b616f5d1820b0ee7623616fc729494b7d4fc6de30cdbf94fe05e1acbf93d04c` (18 Oct 2026 06:0x UTC). The shared-resources 0.9.14 (38) reservation was declared lapsed on 18 Oct; no other live reservation above 44 was found.

Scope: dead-code removal after private.wizard001.com was retired (18 Oct). Removes the legacy origin fallback (Origin.toLegacy, AppState.legacyFallback/useLegacy, inAppUrl legacy branch); fresh installs never attempt the one-time carry. No user-visible change.
