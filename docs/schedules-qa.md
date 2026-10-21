# Schedules browser acceptance

Candidate only, Chrome on Thales; no deployment or real scheduler state.

`node qa-schedules.cjs "$QA_ORIGIN/wizard-os-home/"` with `QA_SHOTS`,
`QA_PLAYWRIGHT`, `QA_CHROME` and worker-local `TMPDIR` configured.
The candidate origin serves this branch and refuses all production mutations;
read-only ordinary service APIs remain live. Scheduler and synthetic destination-chat
API responses are intercepted by `tests/fixtures/scheduler.mjs`.

Final browser run: **57 checks passed, 0 failed, 0 uncaught page errors**.
Two automatic thread-seen writes were intercepted and refused; **zero production
writes forwarded**. All schedule mutations operated only on the in-memory fixture.

Verified phone CSS viewport 390 × 844, touch taps, and desktop 1440 × 1000; Nebula
and Dark selected through the actual Appearance picker. List and editor screenshots
on each; dry-run import preview on Dark. Also exercised toggle, run-now, create,
edit, delete confirmation, import preview then confirm, destination-chat navigation,
404 hiding, draft retention during background refresh and live re-skin, dialog
keyboard containment, Save hit targets above shell chrome and browser Back
(editor → Schedules → Settings, preserving the document).

Private screenshot filenames (kept outside the repository):

- `phone-390-nebula-list.png`
- `phone-390-nebula-edit.png`
- `phone-390-obsidian-list.png`
- `phone-390-obsidian-edit.png`
- `phone-390-obsidian-import-preview.png`
- `desktop-nebula-list.png`
- `desktop-nebula-edit.png`
- `desktop-obsidian-list.png`
- `desktop-obsidian-edit.png`
- `desktop-obsidian-import-preview.png`

`npm test`: **533 passed, 0 failed, 0 skipped** (includes 13 schedule HTTP-fixture
cases, responsive inventory and owner-skin guards). `git diff --check` and JS syntax
checks pass. Original checkout untouched; work performed in a separate worktree.

Service contract gap: no last-run time/result in PR #81. Screen explicitly shows
“Last run · unavailable”; see `docs/schedules.md`. No live secondary-agent runtime,
Android build, scheduler enablement, Hermes migration/cut-over or real job execution
was attempted. Native hardware Back uses the already-existing shell Back adapter;
browser history Back is exercised here, not an Android device.
