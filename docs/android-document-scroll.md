# Android document-scrolling chat threads

Reuse:
- chat thread / composer: EXTEND `web/core/chats.js` and `chats.css`; retain the real thread renderer and shell event delegation.
- reading place / latest: EXTEND `web/core/chat-power.js`; use the same per-thread reading-position store with document metrics in the Android app.
- native scrolling: REUSE stock Android WebView and its platform ScrollCaptureInternal / WebViewCaptureHelper. No custom callback, scroll proxy, or capture hint.
- NEW: none.

Only the native Android bridge / WizardOS-Android UA opts in. A visible thread lifts its existing ancestor chain into normal document flow; the DOM is not cloned or portalled. Other desks and sibling tiles are hidden only while that thread owns document scrolling. Leaving it removes all flow classes and returns to the normal fixed shell. Thread header and composer retain skin styling and are viewport-fixed; measured padding keeps message edges reachable. The document's scroll events feed the existing reading/idle guards.

Browser acceptance uses intercepted synthetic API reads and blocks every non-GET/HEAD request with 403. Native release acceptance runs only on Thales. Samsung One UI and real keyboard acceptance remain separate from AOSP emulator proof.

## Verification before heavy-job preparation

- `npm test`: 517/517 (the existing 513 plus four document/native source contracts).
- `tools/qa-scroll-capture.cjs`: 30/30 real-renderer checks, native UA at 412×915 / DPR 2.625 on Obsidian and Landscapes; wide desktop UA remains on its existing inner scroller. Covers document movement, fixed/unobscured chrome including orb-dock clearance, first/last reachability, following arrival, automatic prepend with anchor preservation, per-thread restore, latest, viewport resize and nested/root Back. All unsafe requests receive 403; no live Agent Service request is needed.
- Python fixture/diagnostics/path suites: 5 + 6 + 3 passing. Python QA scripts compile. The native fixture was also exercised through a real browser: fourteen 120px bands spaced at 130px, long document 2078px at a 915px viewport, and a one-band short document exactly 915px. This is fixture/browser evidence, not native capture evidence.
- Visual review: actual screenshots of both native-mode skins show the final message, model switch and composer clear of the shell dock; desktop is unchanged.

The Thales chain pins release 0.9.42/67 and published 0.9.41's APK SHA256. Its 31-check API35 SystemUI gate now serves these real shell files with a read-only synthetic API. The saved-image checks require all fourteen fixture bands once, correct spacing across joins, multiple viewports, restored document scroll, short-thread refusal, nested Back and no crash. The old proxy gate and instrumentation were removed as redundant with stock discovery/acquisition.

## Explicitly outstanding

Prepared jobs have not run: Android compilation/unit/lint, signed upgrade and API35 saved screenshot stitching remain pending. Galaxy S25 Ultra / One UI 8.5 toolbar behavior, real IME/visualViewport transitions, selection gestures and native multi-window layouts need device acceptance. The stock capture gate deliberately keeps the real fixed chrome: it must detect any missing/duplicated content around tile joins rather than hiding chrome to pass.

