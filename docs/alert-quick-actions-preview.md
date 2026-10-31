# Alert quick actions — isolated preview

## Component decision (COMPONENTS.md)

- **REUSE** Chats' `.ch-sheet` / `.ch-sheet-b`, backdrop and Back/Escape dismissal, focus return and repaint survival.
- **EXTEND** `openRowSheet`, its existing touch long-press / mouse context menu / Shift+F10 handlers, and `justPressed()` to cover Ready alert rows. Keep the originating finger guarded until release, even for holds longer than 700 ms.
- **REUSE** `WosBell.item/mark/watch`, including optimistic list updates and server reload on write failure. No new Notifications endpoint or second actions-sheet component.
- **EXTEND** the existing `qa-origin.cjs` with explicitly opted-in, bounded synthetic notification state for an interactive staging demo. Ordinary QA mode still refuses all writes. No live write forwarding, including for unknown IDs.
- **NEW** regression tests only; no new production UI component, styling or capability.

## Behaviour

Ready alerts offer Open and exactly one completion action, Archive. Archive marks `read:true, archived:true`: the Notifications API has no separate done state, and read alone is Snoozed, still in Ready. Mark unread is offered for a read alert and uses the supported `read:false` mark. Flag is intentionally absent: the existing inbox API supports only read and archived. Completed notification rows retain their existing Restore flow.

Short tap still opens the alert. A long-press lift never also opens it. Thread actions, swipe trays, keyboard actions and dismissal share their existing code. Text-bearing panels retain the shared opaque Wizard skin styling; no new hard-coded colours or CSS.

## Completion wording audit (owner-approved 31 October)

**REUSE / EXTEND** the existing `ACT.done` metadata and dispatch ids. Its label and hint are Archive and its icon is the existing archive box. Row sheets, thread headers, swipe trays and opened-notification actions all use that metadata. Active follow-ups say Archive for now; success says Archived · still watching. Alerts have only that one completion action. No state/API migration and no change to watcher cancellation.

User-visible Done classification after scanning `web/`:

- **Owner archive action — renamed:** Chats `ACT.done`, follow-up action/toasts/failure text, alert sheet; desktop shortcut guide, in-place key hint and disabled-action fallback; Unified inbox and Model pills descriptions. Their internal `done` ids stay unchanged.
- **Agent/completion status — kept:** Chats `ATT`, `STI_LAB`, `STI_TIP`, `PRI_LABEL`; Morning's Done and Done for today badge/copy; voice command completion fallback in `app.js`; Setup connected-device aria-label; tour final-beat title. None archives an item.
- **Other non-archive actions — kept outside this completion-action rename:** app-route close; phone-connect step acknowledgement/flow close; Store share-sheet close; Desks overview close; desktop first-message tour finish; returned Boomerang acknowledgement (removes its one-shot schedule, not `LIVE.archive` or `WosBell.mark`). These are not archive actions and must not be mislabeled Archive. Generic close-wording changes are not part of this PR.
- **Not visible action text:** `done` ids, CSS/state names, comments, fixture content, motion demo controls and API documentation. Unchanged, apart from descriptions of the renamed archive control.

`tests/archive-action-wording.test.mjs` locks shared action labels, archive-box icon, follow-up copy and keyboard surfaces while evaluating the real status maps to ensure they still say Done. The alert-row harness renders both real thread and alert sheets and rejects Done-labelled completion buttons.

## Checks

```sh
node --test tests/alert-row-actions.test.mjs tests/qa-alert-fixture.test.mjs
npm test
```

The first executes the real Chats gesture/sheet/dispatch code and real bell API client: hold, Archive API payload + Ready removal, short tap, right-click, long-hold suppression, cancellation, unread and failure rollback. The fixture tests exercise an actual HTTP server and reject real IDs, unsupported marks and writes outside the isolated sample endpoint.

The forum-only browser runner is `tests/browser/alert-row-actions.cjs`. It uses Chromium CDP touch events, a mobile 400×860 viewport, the staged shell, live skin switching (Dark / Light), screenshot capture, opaque panel checks, outside touch, browser Back, API readback, short tap, right-click, and an optional `origin/main` negative control. Browser evidence is not established by the unit suite.

```sh
QA_PLAYWRIGHT="$PLAYWRIGHT_MODULE" \
ALERT_PREVIEW_URL="$PREVIEW_URL" \
ALERT_PREVIEW_HOST="$PREVIEW_HOST" \
ALERT_BASELINE_JS="$QA_ROOT/baseline-chats.js" \
ALERT_QA_OUT="$QA_ROOT/evidence" \
node tests/browser/alert-row-actions.cjs
```

Access the actual registered staging router through a loopback-only SSH tunnel with the registered Host header. Copy its screenshots to the owner's private evidence folder and inspect them before claiming appearance acceptance.

## Preview safety

Set `QA_SAMPLE_ALERTS=1` only on the dedicated `wizard-stage-alert-long-press` unit. Its three alerts are labelled Sample and live solely in that process's memory. Reloading the preview resets them. `GET /__qa/alerts` reports `sample:true, liveWrites:false`; this is also the browser runner's prerequisite fence. Every other non-GET/HEAD request is rejected by the existing QA origin. No owner alert, session or preference writes are needed for this preview. Preview expiry is seven days. Live promotion follows owner approval; the isolated preview never writes owner data.
