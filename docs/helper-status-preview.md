# Helper status — isolated preview

James approved building the preview in `wizard_1791823363261_4e06432460cb` after asking how to distinguish a long-running helper from a stalled request. Live release remains a separate approval.

## Open and judge

The original preview used the retired custom domain. For a new run, set `QA_ORIGIN` to an isolated tailnet preview hosting these fixtures and open its `/` entry.

Opens directly on **Preview · Stalled helpers**, phone shell. Tap the existing Working row to expand it; **Try Continue · example only** resumes the illustrative request and moves it to Ready after completion. Browser-cookie-isolated examples also cover helper batches still awaited and the main agent finishing its answer. Real thread status is read from the live database; real writes are refused by the preview origin.

## Candidate changes

- Existing Chats row and Working receipt share one helper-status label; no new panel or notification.
- Assigned task count for unresolved helper batches, elapsed duration, returned sibling batches, active parent vs idle returned results, decision holds and uncertain older records.
- Counts mean assigned tasks still awaited. Individual children inside an unfinished batch are not guessed as completed or running.
- `stalled` requires all helper batches returned, no active parent lease/admission, and two minutes without resumption. Long helper execution alone is not called stuck.
- Backend candidate GET projection uses `wizard_helper_status`; POST `/wizard/helper-continue` uses the automatic watcher's original receipt input/idempotency identity, checks active admissions and owner gates, and validates normal access/payload boundaries.
- No Hermes core changes, model changes, daily shell merge, service cutover, or new real agent execution from the preview.

## Verified evidence

- `qa-helper-status.cjs` ran on **Thales**, installed Google Chrome, against the exact HTTPS destination: **31/31 browser assertions**, phone and desktop, zero runtime errors. Deep link, partial sibling result, resumed example, Ready transition, touch target, both status displays, Back staying in Chats, and refusal of live continuation/run writes.
- `tests/helper-status.node.test.mjs`: **14/14** lightweight backend assertions. Real HTTP handler/access/body validation and session-list projection with explicit test fixtures; active lease/admission, pending siblings, owner gate, stale receipts, later requests/steering, final completion, and premature Done.
- Parent inspected phone stalled and list screenshots. Screenshots: `~/.hermes/cache/scratch/helper-status-shots/` and Thales `/Users/thales/helper-status-qa/`.
- Small remote browser QA used `/Users/thales/helper-status-qa` after the external ThalesMedia disk disconnected; it installed only playwright-core and reused installed Chrome. No sustained build or media staging on VPS.

## Viewport repair verification

- Removed this preview's staging `focus` selector after reproducing hidden `#device.scrollTop = 278`, which shifted the chat header above the browser viewport. The shell now stays unscrolled; no live shell/layout changes.
- Fixed example request/message timestamps to stay stable across polling, preserving the expanded Working receipt.
- `qa-helper-viewport.cjs`: **30/30 on Thales**. Delayed initial focus, four phone browser viewport sizes, keyboard-sized resize/restore, 15-second polling expansion, clickable Continue, completion, Back, zero page errors.
- Re-ran original phone/desktop suite after the repair: **31/31**. Final exact HTTPS preview origin remains live.

## Delivery checkpoint

UX source: `/home/telos/worktrees/wos-helper-status`, branch `feature/helper-status-preview` from `daily`.
Agent Service: `/home/telos/work/was-helper-status`, same branch name from live `99051325`.
Preview unit: `wizard-stage-helper-status`, port 9506; custom origin `tools/helper-preview-origin.cjs`.

Before live integration, reconcile with the separate Stock integration manual-Continue lane, preserve its approved downtime policy, review candidate execution race/idempotency and list-read cost, perform baseline/candidate regressions on Thales, then serialize daily/backend delivery under existing release policy. Preview approval is not live-release approval.
