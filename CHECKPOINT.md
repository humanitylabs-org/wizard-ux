# Home-screen apps candidate checkpoint

Outcome so far: native + mobile implementation is a **source candidate**, not a verified signed APK. Parent owns durable staging, independent review, delivery and stable promotion.

- Worktree `/home/telos/worktrees/wos-home-screen-apps-20261014`; base `201b4e6`; branch `feature/home-screen-apps-20261014`.
- Fable consulted before UX edits: first-party `claude-fable-5-1`, tools empty, success/no permission denials. Transcript `/home/telos/context/sources/projects/wizard-os/claude-transcripts/20261014-home-screen-interaction-response.json`.
- Implemented stable native pin identity/gesture+origin+frame port, OS-confirmed status, independent document tasks, same-session re-tap/recovery, single-app shell before workspace boot, app-registry launch resolution, durable route/reading checkpoints, early native Wisdom pagination-position scoping, chrome/exit suppression and app/root Back. Shape/limits in `docs/home-screen-apps.md`.
- Production package/origin/version36 unchanged. Preview: `ai.wizards.os.preview`, code1001, `0.9.12-homescreen.1-preview`, durable feature staging origin. Preview updater/legacy fallback cannot reach production feed/origin. Production reservations37/38 excluded.
- Actual lightweight execution: `node --test tests/*.test.mjs` **16 passed / 0 failed** (12 new home-screen unit/VM cases + 4 preexisting store adapter cases); `git diff --check`, JS syntax and manifest XML parse passed. These are not real browser/Android launcher proof.
- Added normal-runner JUnit tests, real-data browser `qa-home-screen-apps.cjs`, and exact-signed-Preview/API35 launcher probe `tools/qa_home_screen_apps.py`. Native/Thales/browser suites currently **not executed**; device script explicitly reports its remaining route/position/IME/recovery gates instead of claiming whole acceptance.

## Authorized route blocker / evidence

External evidence `/home/telos/.hermes/state/home-screen-apps-20261014-evidence/`:
- `unit-tests.tap`, `lightweight-checks.json`, `remote-preflight.log`, `remote-route-observations.json`: actual lightweight outputs and diagnosis.
- `attempt-build.py`: invokes the approved runner with `--wait-for-lock --java 17 --gradle-dir android`, private Thales Wizard OS signing env and pinned signer, tasks `:app:testPreviewUnitTest :app:lintPreview :app:assemblePreview`.
- `signed-preview-controller.log`, `signed-preview-attempt.json`, `signed-preview-build/`: bounded real remote attempt. Inspect actual result before making claims; a controller timeout is **not** an Android success receipt.

Thales diagnosis: SSH/stat/df succeed (`thales.local`, `/Volumes/ThalesMedia` 649 GiB free). Canonical `AndroidBuilds/worker.lock` is a zero-byte regular file, inode6400187, with no lsof holder and no Gradle/emulator/--worker processes. Open stalled; opening a fresh file in the same directory also timed out. A reversible rename preserving inode stalled too; **our own** shell+mv processes98036/98037 were canceled. Exact original inode/path was read back unchanged and our processes gone. Preexisting sibling read probes were untouched. Ordinary lease contention is not proven. No alternate lock, SDK fallback, guard bypass, destructive volume repair, sibling kill or reboot.

Missing acceptance: remote Java/Gradle tests+lint/compile/signing/APK metadata/hash, candidate-vs-daily real-browser negative control and affected regressions, API35 pin/icons/three tasks/position/process-death/refresh/Back/IME/recovery, exact signed Preview launcher-to-live durable staging. All five acceptance outcomes remain not fully proven. **Do not deliver/promote this as accepted.**

## Recovery

Repair Thales volume I/O with the Mac/workload owner; preserve siblings and the original canonical shared lease. Re-run from the immutable source commit via the approved runner, signed Preview first; separate debug signer/job if CDP is needed. Parent stages exact web source at `https://home-screen-apps.staging.wizard001.com/wizard-os-home/` before final APK acceptance. Continue native+web ownership as one lane; no worker deploy/merge/feed/service writes or physical-phone install.

## Independent review repair checkpoint

Input candidate `baa5a2027a210e20992ee7c2d83db08b26d58b08` was independently inspected against the brief and actual Wisdom/Signal frontend source. Narrow repairs and updated QA are detailed in `docs/home-screen-apps.md` under Independent source repair review. No remote heavy work was attempted during this review; parent retains Thales I/O diagnosis, staging and Android ownership.

Source findings fixed: one-pixel fullscreen screenshot crop; Signal naming; canceled/stale native tap qualification; invalid/reused intent navigation; Signal route/state loss on iframe refresh; unnecessary Wisdom reader rerender; route-checkpoint race; stale-frame/unavailable recovery; missing selection Search/shared media-link utilities; shell index/desktop/preview masquerading as a frontend. Browser QA now includes actual reading pages/routes, per-instance checkpoint comparisons and required expected-failure baseline/regression controls. Signed UI script explicitly exits incomplete instead of reporting subset success.

Unresolved external frontend boundary: Wisdom's current `layout(false)` ignores saved positions for already-read chapters and end-screen positions. The candidate's shell-level scoping cannot override that frontend decision safely. Do not mark universal process-death position restoration accepted on unread-page tests alone. No external app checkout edits were made.

Review evidence is written under `/home/telos/.hermes/state/home-screen-apps-20261014-evidence/independent-review/`; consult its actual receipt/test TAP, not this document's historical count16. The updated native JUnit, browser and API35 scripts remain unexecuted until the authorized Thales route is available.
