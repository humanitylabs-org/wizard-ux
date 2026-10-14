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
