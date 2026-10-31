# Alert quick actions — isolated preview

## Component decision (COMPONENTS.md)

- **REUSE** Chats' `.ch-sheet` / `.ch-sheet-b`, backdrop and Back/Escape dismissal, focus return and repaint survival.
- **EXTEND** `openRowSheet`, its existing touch long-press / mouse context menu / Shift+F10 handlers, and `justPressed()` to cover Ready alert rows. Keep the originating finger guarded until release, even for holds longer than 700 ms.
- **REUSE** `WosBell.item/mark/watch`, including optimistic list updates and server reload on write failure. No new Notifications endpoint or second actions-sheet component.
- **EXTEND** the existing `qa-origin.cjs` with explicitly opted-in, bounded synthetic notification state for an interactive staging demo. Ordinary QA mode still refuses all writes. No live write forwarding, including for unknown IDs.
- **NEW** regression tests only; no new production UI component, styling or capability.

## Behaviour

Ready alerts offer Open, Done and Archive. Done and Archive both mark `read:true, archived:true`: the Notifications API has no separate done state, and read alone is Snoozed, still in Ready. Mark unread is offered for a read alert and uses the supported `read:false` mark. Flag is intentionally absent: the existing inbox API supports only read and archived. Completed notification rows retain their existing Restore flow.

Short tap still opens the alert. A long-press lift never also opens it. Thread actions, swipe trays, keyboard actions and dismissal share their existing code. Text-bearing panels retain the shared opaque Wizard skin styling; no new hard-coded colours or CSS.

## Checks

```sh
node --test tests/alert-row-actions.test.mjs tests/qa-alert-fixture.test.mjs
npm test
```

The first executes the real Chats gesture/sheet/dispatch code and real bell API client: hold, Archive/Done API payload + Ready removal, short tap, right-click, long-hold suppression, cancellation, unread and failure rollback. The fixture tests exercise an actual HTTP server and reject real IDs, unsupported marks and writes outside the isolated sample endpoint.

The forum-only browser runner is `tests/browser/alert-row-actions.cjs`. It uses Chromium CDP touch events, a mobile 400×860 viewport, the staged shell, live skin switching (Dark / Light), screenshot capture, opaque panel checks, outside touch, browser Back, API readback, short tap, right-click, and an optional `origin/main` negative control. Browser evidence is not established by the unit suite.

```sh
NODE_PATH="$PLAYWRIGHT_MODULES" \
ALERT_PREVIEW_URL="$PREVIEW_URL" \
ALERT_PREVIEW_HOST="$PREVIEW_HOST" \
ALERT_BASELINE_JS="$QA_ROOT/baseline-chats.js" \
ALERT_QA_OUT="$QA_ROOT/evidence" \
node tests/browser/alert-row-actions.cjs
```

Access the actual registered staging router through a loopback-only SSH tunnel with the registered Host header. Copy its screenshots to the owner's private evidence folder and inspect them before claiming appearance acceptance.

## Preview safety

Set `QA_SAMPLE_ALERTS=1` only on the dedicated `wizard-stage-alert-long-press` unit. Its three alerts are labelled Sample and live solely in that process's memory. Reloading the preview resets them. `GET /__qa/alerts` reports `sample:true, liveWrites:false`; this is also the browser runner's prerequisite fence. Every other non-GET/HEAD request is rejected by the existing QA origin. No owner alert, session or preference writes are needed for this preview. Preview expiry is seven days. No merge or live deploy is part of this change.
