# Phone release integration candidate: 0.10.1 / 63

Branch: `integration/phone-release-0.10.1`.

This candidate starts at `main` d01e507c (Android Connect #219) and preserves the already-published Samsung scroll-capture native changes from `fix/samsung-scroll-capture` 7064f541 (#291). The live feed was 0.9.38/code62, while main was 0.10.0/code61: building main unchanged would both fail the monotonic update rule and remove native behavior already on the phone.

Integration repairs: retain the Connect null-WebView resume guard, use context-aware runtime-origin trust in all three capture/diagnostics callers, and preserve detailed capture rejection reasons. Source regression tests cover those seams. No new orb/IME behavior is included.

## Authority and gates

- This is a candidate, not a release receipt. #291 remains open and its physical Samsung acceptance is not waived. The release owner must reconcile its merge authority before promoting this integration to main.
- Before publishing, require exact-source generic/owner/debug release tests, lint, signature and manifest audits, Connect UI, signed upgrade from the current published artifact, required orb sections, scroll proxy instrumentation and AOSP saved pixels on Thales. No Android build executes on the control plane.
- Public/generic APK has no owner origin or photos server. An owner-configured signed companion exists only for upgrade/migration rehearsal; owner configuration stays private on the worker. Neither APK is published by the build chain.
- Query the feed again after completion. A changed published version/code/hash invalidates the baseline used by this candidate and requires reconciliation.
- Publication means exact content-addressed signed bytes, the canonical configured distribution listing (if applicable), and the matching in-app feed agree. A prepared build is not available on a phone.

## Executed lightweight checks

- Node contracts: 566 passed, zero failed/skipped.
- QA path regressions: 3 passed.
- Diagnostics HTTP/schema/retention tests: 3 passed.
- Conflict resolutions and whitespace checked before commit.

## Optional IME/orb follow-up

Prior #219 r10 evidence passes all required orb sections with zero retries. The optional `everywhere.3.dictation` case still logs an overlay shown above an IME but captures no visible orb and no tap effect. This candidate does not label that an app fix or silently waive it. Preserve screenshots/window state and keep physical-keyboard-overlay acceptance distinct from Connect/release acceptance.
