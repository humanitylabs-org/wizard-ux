# Hosted app reading-position memory

The Wizard phone and desktop shells preserve hosted-app reading places across a shell refresh, an explicit Update-ready → Reload, and an iframe refresh. This is a default of the shared host, with no SDK call, opt-in, or app-specific restoration code.

`core/app-reading-position.js` is loaded before `core/app-services.js`. Every registered same-origin frame attaches through the existing host authorization boundary. Cross-origin frames remain outside DOM access and are skipped.

## Contract

- Persist page and overflow-panel offsets in bounded sessionStorage: app ID + shell window ID + exact path/query/hash. Keep at most 80 route/window records and 24 scroll containers per record. No page text is stored; a short visible block is represented by selector, text hash, and viewport offset.
- Save after a debounced scroll, on shell/frame lifecycle flush, and immediately before either shell's update Reload. A current-route check at flush captures pushState/replaceState changes even when no scroll event occurred.
- On document remount, restore the visible text anchor where it survives; otherwise use offsets. Observe delayed DOM/font/image/layout readiness. Saved geometry prevents an early surviving anchor from falsely completing while earlier text is missing.
- Parked/hidden frames retain their destination and pause the fifteen-second visible-time budget. Visibility/layout resumes restoration; parking is never evidence that restoration succeeded.
- Success adopts the restored checkpoint. Timeout preserves the prior checkpoint rather than overwriting it with a partially loaded/clamped position. Actual user input cancels pending restoration and returns ownership to the user. Ordinary wheel/touch/pointer events after settlement do no snapshot work; scroll saves remain debounced.
- Dispose on document replacement/frame removal, cancel timers/RAF, disconnect observers, remove listeners, prune detached scroll targets, and reuse the host's exact app/path/origin checks.

This restores a rendered reading place. The app continues to own its content, router and durable application state. A shell update cannot retrospectively capture an old page that did not yet load this module; after the first update reload, subsequent refreshes use the default.

## Verification

Execute sustained browser QA only on Thales, under `$WIZARD_WORK_ROOT/AndroidBuilds/worker.lock`.

`qa-app-reading-position.cjs` uses deterministic hosted readers plus an optional GET-only proxy of the actual I Ching app (`QA_REAL=1`). It exercises both shells, nonzero page offsets, actual update-banner buttons, inner panels, delayed text, partial content with a surviving early anchor, cancellation, route isolation, no-scroll route changes, parked geometry, document-hidden parking beyond the restore deadline, and timeout checkpoint preservation. `QA_SHA` and `QA_TREE` identify the exact tested source; `QA_OUT/result.json` records host, checks, scope, runtime errors and writes.

Original daily `29f388f`: first page-reload regression fails, 1650 → 0. Repaired web tree: all focused checks pass. Shared app-services and device suites additionally cover Back, capture/update holds, draft recovery, ownership boundaries and the existing update banner. Physical handset/native execution is separate from these browser contracts; this web-only fix changes no APK.
