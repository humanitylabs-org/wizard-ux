# Slice 8: Food app and Photos verification

Scope: web only. No Android changes, merge, app deployment, registry writes or live checkout edits.

Live discovery: Food is `web/usuals.js` + `web/usuals.css` in the serving shell. `usuals` is a shell-owned tile, not an installed registry row. Photos is already served by `wizard-photos-app.service` from its own repository at `/photos/`; preserve that implementation and native backup ledger.

Reuse:
- Food list, saved orders, teaching, editing, wording and styles: REUSE serving HEAD sources, port without redesign.
- Native calls: EXTEND `core/android-relay.js` with an owner/path/method-bound synchronous legacy adapter; expose it through the existing verified `WizardApp.device` service. No second broker or store.
- Food command grammar: EXTEND existing app-owned `WizardApp.voice.commands` and registry capability warm-up; app owns its phrases and native saved-order matching.
- Back, focus, toast and appearance: REUSE/EXTEND `WizardApp`, never app-owned root sentinels, theme storage or navigation broker.
- Saved workspace descriptors: EXTEND generic registry-backed window normalization; retain canonical id `usuals`.
- Photos: REUSE existing app, `core/photos-relay.js`, native backup worker and ledger unchanged.
- NEW: none.

Acceptance: main/branch unit failure-name comparison; moved-source app parity PASS without waivers; phone/desktop screenshot and element comparison; nested Back and no page errors; existing Food spell QA; current-main Android APK teach/replay on forum emulator; unmerged green PRs; detached unpushed candidate based on final serving HEAD.
