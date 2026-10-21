# Settings → Schedules

Shared Settings registration in `web/core/schedules.js`; both phone and desktop load it.
Uses the existing Settings cards/sheet and the shared Settings Back/focus dispatcher.

## Scope

Owner job: see, pause, edit, run and delete Wizard schedules; preview an import before
confirming paused copies of supported Hermes jobs. Standard implementation lane;
no new services, design system, protected skin edits, deployment or cron cut-over.
Existing Settings/Updates is the layout and transport pattern (no new visual direction).

Acceptance: both layouts reach one list; older-service 404 hides the category; mutations
use the owner API then refresh; import has an explicit dry-run/confirm boundary; Back
closes the top sheet then returns to Settings; live skin changes retain the open draft.

## API

Targets `wizard-agent-service` PR #81, branch `feature/wizard-scheduler`,
`d7fbcf2a895e00c157692a961dd64fd004de3150` and `wizard-os` PR #143.
Requests use same-origin credentials and the documented `/wizard/v1/schedules` routes.
Edit PATCH changes only name, when, prompt and thread. Agent, model, skill, timezone
and enabled remain unchanged. New jobs use the main agent, the service's timezone,
and enabled true. A missing destination creates a named chat on the first run.
Run-now says “Run requested”, never “completed”. Import preserves source Hermes jobs;
imported copies stay paused. This screen does not enable the scheduler or turn off Hermes.

**API limitation:** #81 exposes `nextAt`, `updatedAt` and the destination `thread`, but
no last occurrence/admission/completion result. The list says “Last run · unavailable”
rather than pretending that edits or chat activity are scheduled runs. Showing actual
last-run time/result needs a companion Agent Service contract. Arbitrary cron stays
exact as “Custom timing” rather than a potentially false English interpretation.

## Verification

- `npm test` includes `tests/schedules.test.mjs` and its case-local HTTP fixture:
  404 hiding in both mounts, list/chat link, toggle PATCH/readback, run-now,
  import dry-run/confirm, Back, create/edit, errors/drafts/live refresh,
  delete confirmation and form validation. No real state or agent runs.
- `qa-schedules.cjs` drives the actual phone and desktop shells on a read-only
  candidate origin. Scheduler API responses are intercepted fixtures and every
  other mutation is blocked. Run on a browser worker (Thales); use `QA_SHOTS`,
  `QA_PLAYWRIGHT`, `QA_CHROME`, and an isolated `TMPDIR` for private evidence.
- Owner-skins guard and normal responsive inventory guard stay in `npm test`.

No live deployment, service restart or merge is part of this PR.
