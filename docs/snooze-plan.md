# Snooze — approved 23 October 2026

- REUSE: WizCore Chats thread/message actions, status/search, shared Back unwind, skins.
- EXTEND: WosBoomerang in core/scheduled-reminders.js with Snooze wording, fewer presets, exact confirmation and Someday through existing WizLive.defer. Keep scheduler/storage/event identifiers and deferred disposition unchanged. No new module, backend, timer or store.
- NEW: none.
- Adopt the prompt and actual-time confirmation concept from Novaire's #355; co-author credit. Close that draft after replacement PR is merged.
- Verify npm tests; phone + desktop × Sepia + Novairecito browser fixtures on ThalesMedia, timed and Someday flows, existing returns, failures, Back, search and screenshot geometry. Read live bytes and real thread lists without mutations.
- Release via named branch, green CI, merge commit, then integrate only the merged delta into the existing live branch (never switch live to main). Preserve untracked files and do not restart services. Add guest rebuild queue line and resolve #355 decision.
