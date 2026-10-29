# Two phones share open apps — reproduction and verification

## Outcome

The real phone shell reproduced two client defects against the real Agent Service workspace store:

1. A response received while hidden puts the sync reader into a 15-second sleep. Returning to the foreground did not interrupt that sleep, a network retry backoff, or an outstanding/suspended long-poll. There were no workspace-specific visibility/resume/online handlers. A phone could remain visibly stale after reopening Wizard.
2. The reader trusted the saved revision alone. If a restored/reset server reused the checkpoint's revision for different desks, every response was ignored indefinitely, even though Settings reported the client in sync.

The fix wakes **one existing reader**, aborts its outstanding read, interrupts its sleep/backoff, and requests an immediate snapshot. Reads have a 35-second deadline. Snapshot content is checked as well as revision; a GET overtaken by a local PUT cannot roll the baseline back. Android labels use the WebView's model or a persisted short name when the UA is reduced.

These are reproduced code defects, **not a forensic claim about the owner's two handsets**. Their actual localStorage, sync-off setting, current desk and WebView lifecycle were not inspected.

## Reuse

- REUSE: Agent Service `createWorkspaceStore`, the real phone `index.html` and `app.js`, and `tools/qa-playwright.cjs`.
- EXTEND: `web/core/workspace-sync.js` and its existing unit tests. No second sync implementation or native fork.
- NEW: isolated QA origin and two-context browser regression only; no new production capability.

## Source comparison

The branch starts from shared main `ab7cb38231d5e3b29ba0ca24402dced310af1798`. The serving shell was at `b70bb104e2c8310334b432c889ac368e3f188aa3`, not shared main. Its unrelated local files were left untouched.

The sync module differs by **one existing condition**: main excludes `w.preview`, while the serving module does not. All polling, checkpoint, merge and reconciliation code was otherwise identical. This change preserves main's preview exclusion.

The phone sync adapter in `app.js` is the same. Other shell differences are unrelated: main has a window-refresh adapter, browser-toolbar/microphone recovery changes and skin hooks; the serving shell still has its app-setup gate and other owner-release integrations. `index.html` differs in the device slot and app-setup script/style; the desktop shell also differs. No wholesale copy of either release was made.

To avoid treating main as proof of the owner's build, the rig was run against the **serving web directory read-only**, before the fix and with only `core/workspace-sync.js` overlaid from the branch. It was also run against main/candidate web sources separately. Neither the live web files nor its workspace data file was written.

The store is imported directly from installed Agent Service release `was-8e1eb692a1be58a377adbc8a87fe98c43ed24302`, module SHA-256:

`1166e2440132e7fb71266ea44ad68721efbbf7e655cde1c88b49f82818e30488`

The QA origin creates its own disposable workspace file. It never proxies a live backend. Only the isolated workspace GET/PUT reaches the real store; unrelated API reads are minimal fixtures and unrelated writes return 403. Notes/Calendar/Files/Wisdom content is a synthetic iframe; app-window placement and desk reconciliation use the real shell.

## Browser results

Chromium via Playwright 1.64.1; separate contexts, Android WebView-style UAs for Pixel 10 Pro XL and SM-S938B, `WizardOS-Android/0.10.18 WizardOS-DocScroll`, 412 × 915 mobile/touch viewports. The freeze scenario dispatches hidden visibility, lets a response enter the hidden wait, freezes the page with CDP, changes A, activates B and dispatches visible/resume. It requires catch-up within 3 seconds; foreground opening allows 30 seconds.

| Scenario | Serving shell before | Serving shell + fix | Main before | Candidate |
|---|---|---|---|---|
| A opens Notes → rendered on B | PASS, 636 ms | PASS, 621 ms | PASS | PASS, 709 ms |
| B hidden/frozen; A changes; B resumes | FAIL, >3 s | PASS, 114 ms | FAIL, >3 s | PASS, 163 ms |
| B closes Notes desk → removed on A | PASS | PASS | PASS | PASS |
| First join adopts box desks, deduplicates Chats and preserves unique local desk | PASS | PASS | PASS | PASS |
| Older checkpoint revision adopts newer box snapshot | PASS | PASS | PASS | PASS |
| Reset store reuses checkpoint revision with different desks | FAIL, >3 s | PASS, 11 ms | FAIL, >3 s | PASS, 12 ms |
| Server revision lower than checkpoint | PASS | PASS | PASS | PASS |
| **Totals** | **5/7** | **7/7** | **5/7** | **7/7** |

All four browser runs reported **0 page errors**. Before: both client labels were `Android`. After: `Pixel 10 Pro XL` and `SM-S938B`. The final reset scenario creates a new real store instance at rev 0, retaining box desks, while the joining phone has a different rev-0 checkpoint.

Unit tests additionally cover interrupting a suspended poll and offline backoff, repeated lifecycle events not creating parallel readers, stale GET/PUT races, stable reduced-UA names, offline edits surviving reload, focus/page preservation and the existing merge rules.

## Commands

Set `WORKSPACE_STORE_MODULE` to an installed Service's `server/workspaces.mjs` (or a source release containing it). Do **not** point the QA store at the owner's workspace JSON; the helper always creates its own file. `TMPDIR` controls scratch placement.

```sh
node --test tests/workspace-sync.test.mjs
# tests 12; pass 12; fail 0

npm test
# tests 1305; pass 1305; fail 0; duration_ms 67117.208145

WORKSPACE_STORE_MODULE="$SERVICE_WORKSPACES_MODULE" \
  CHROMIUM_PATH="$QA_CHROMIUM" \
  QA_REPORT="$QA_OUTPUT/candidate.json" \
  node tests/two-phone-workspace-sync.browser.mjs
# two phones share open apps: 7/7 scenarios passed; 0 page errors
```

`CHROMIUM_PATH` is optional if Playwright's Chromium is installed. Resolve Playwright through `QA_PLAYWRIGHT` when necessary (the shared resolver also supports an installed package).

To test the serving shell without modifying it:

```sh
WORKSPACE_STORE_MODULE="$SERVICE_WORKSPACES_MODULE" \
  CHROMIUM_PATH="$QA_CHROMIUM" QA_WEB_DIR="$SERVING_WEB" \
  QA_SYNC_SOURCE="$PWD/web/core/workspace-sync.js" \
  QA_REPORT="$QA_OUTPUT/serving-with-fix.json" \
  node tests/two-phone-workspace-sync.browser.mjs
```

For baseline, omit `QA_SYNC_SOURCE` with the serving web directory, or set it to a scratch copy of main's sync module. `QA_ALLOW_FAILURES=1` records all expected baseline failures without failing the process. JSON reports contain scenario outcomes, page errors, the synthetic request log, stub inventory and final isolated snapshot. Do not publish reports from arbitrary real-data origins.

## Android path and remaining checks

`MainActivity` enables DOM storage and appends the native UA tag; `AppState.homeUrl()` loads `/wizard-os-home/` (therefore `index.html`). App-session shortcuts load the same entry with a query. The native source has no `wos.wsync.off` override and no separate workspace-storage namespace. There is no Android-specific sync implementation to patch, and web-only changes need no APK rebuild.

Not checked on physical phones: whether either device has `wos.wsync.off=true`, the actual server origin/checkpoint, OS-specific network restrictions, or simply Home/another current desk in front. Home, selected desk, focus, window layout and an already-open app's page intentionally stay device-local. The browser freeze is a lifecycle regression, not physical GrapheneOS/Samsung WebView certification.

No deployment, merge, live workspace PUT or native build was performed.
