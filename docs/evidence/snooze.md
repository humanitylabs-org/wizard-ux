# Snooze acceptance — 23 October 2026

## Outcome

Snooze replaces the separate Defer and Boomerang controls in shared Chats. Its five choices are Later today, Tomorrow 9:00, Next week, Pick a time and Someday. Timed returns keep the existing scheduler; Someday is exactly the old deferred disposition, including preserving any previously scheduled return. Existing deferred threads read Snoozed, and old search words remain aliases.

REUSE: shared Chats, scheduler, deferred disposition, Back unwind and skin controller.
EXTEND: core/scheduled-reminders.js and shared Chats wording/actions.
NEW: none (no new runtime component, store, timer, endpoint or backend change).

Novaire's #355 supplied the prompt and exact-saved-time confirmation ideas; this chooses James's approved Snooze name and neutral clock instead of Recall and the Wizard mark.

## Exercised on the Thales browser worker

- Untouched main `7569c6a4`: `npm test` **654/654 passed**.
- Candidate: `npm test` **656/656 passed**. Updated Snooze contracts fail **4/10** against untouched main and pass on the candidate.
- `qa-snooze.cjs`: **100/100 passed**, phone 390px Android UA and desktop 1440px, Sepia and Novairecito. Covers the five choices, exact Bangkok time, minute edits, message anchoring, old returns, errors without false confirmation, Someday disposition/bottom of Ready, old search synonyms, skin changes preserving a note, and nested Back retaining the app/thread.
- Updated `qa-boomerang-pins.cjs`: **52/52 passed**, retaining pin synchronization and keyboard/context-menu checks.
- Screenshots reviewed: phone/desktop picker, exact-time saved banner, Snoozed Ready row; coherent light/dark skins, no clipped controls. All fixture writes were intercepted, with no agent runs.

## Baseline limitations

The separate real-data `qa-chats-parity.cjs` has the same existing failures on main and candidate: section totals overcount by 24 (main 246 vs 222; candidate 247 vs 223), then its older thread-opening wait times out at line 100. This lane did not change that suite or claim it green. New Snooze browser acceptance is independent of that failing legacy live-data test.

Physical Android notification rendering was not exercised; existing watcher transport and `wzb_` ids remain unchanged. No APK or guest image build is needed for this web-only change.
