# Live red-test reconciliation — 27 October 2026

## Boundaries and baseline

No deployment, native build, live-checkout edit, skin CSS edit, feature-reference allowlist increase, or owner-skin fingerprint change is part of this work.

Baseline main: `e5cf115d`, normal suite on Forum: 1,240 passed, zero failed/skipped.
Baseline live source: `5f99f1b2`, clean normal suite on Forum: 1,038 tests, 1,024 passed, 13 failed, one pre-existing skip. The reported fourteenth failure (feature references) requires the ignored private thread exports found in the serving checkout; it does not reproduce in a clean archive. Reading the actual source tree with the scanner identified seven growth entries, all in those two generated files, not native vault files.

The shared reported assertions pass on main. `tests/wizard-id-bridge.test.mjs`, including reported failure 14, does not exist on this main baseline: it is **absent**, not a passing assertion.

## Per-test disposition

| # | Reported test | Cause and disposition |
|---|---|---|
| 1 | Feature app references never grow beyond the allowlist | Scanner counted ignored private `web/data.js` and `web/summaries.js` user-content exports as shell implementation. `.gitignore` explicitly reserves them in `58d58b4f`. Exclude exactly those two data outputs; add fixture coverage. Production paths/counts, native scanning, ratchet assertions and allowlist unchanged. Main fix `5c6670d2`; live port `308d02e3`. |
| 2 | Resume re-renders current sigil and name | Real regression: `1e645f38` added a global 30-second cooldown and an ID/URL-only signature, suppressing native resume and metadata updates. Keep single-flight/deduplication, but sign rendering inputs and force native resume. Main `91ed7d73`, plus empty-registry regression `9f6ad2b0`; live initial port `bb1bf8f2`. Original test unchanged. |
| 3 | Old APK unknown/timeout stays quiet and later resume retries | Same cooldown/signature regression. Resume bypasses registry deduplication and remains coalesced during an active native request. Unknown/unsupported/timeouts remain silent. Same fixes as #2; original test unchanged. |
| 4 | Registry update during refresh reruns with new apps | Same regression: ID/URL signature plus cooldown discarded a dirty metadata update. New snapshot signature includes name and sigil; self-announcing registry reads cannot perpetuate the loop. Same fixes as #2; original test unchanged. |
| 5 | Only Miguel's packages style the pill dock/show orbApp | Needs James look. `4defd354` adds core `.orb-app` styling for all five owner skins, contrary to this guard. Same real visual change as #7–11. Assertion unchanged. |
| 6 | Only collaborator packages style symmetric dock/orb X | Needs James look. The final new owner-skin selector in `4defd354` contains `[data-sheet="launcher"] .dock .orb-app { opacity: 0; }`, tripping the scope guard. It hides the new owner glyph while Apps is open; it does not add symmetric geometry to owner skins. Assertion unchanged. |
| 7 | Nebula unchanged | Needs James look: the owner-scoped rules introduced in `4defd354`, not comments or whitespace. Before/after `skin-drift-nebula-{before,after}.png`. Fingerprint unchanged. |
| 8 | Grove unchanged | Same commit and rules; `skin-drift-grove-{before,after}.png`. Fingerprint unchanged. |
| 9 | Tide unchanged | Same commit and rules; `skin-drift-tide-{before,after}.png`. Fingerprint unchanged. |
| 10 | Ember unchanged | Same commit and rules; `skin-drift-ember-{before,after}.png`. Fingerprint unchanged. |
| 11 | Signal unchanged | Same commit and rules; `skin-drift-signal-{before,after}.png`. Fingerprint unchanged. |
| 12 | Tracked source contains no private paths/hosts | Real portability regression in `52462d5f`'s `qa-app-orb.cjs`. Reuse `tools/qa-playwright.cjs`; use explicit CH/CHROMIUM_PATH or Playwright's installed browser instead of a developer cache path. No guard or allowlist change. Live fix `98b34a32`; main already portable via `69cb2067`. |
| 13 | Skin API exposes no shell internals | Stale exact-key expectation after shipped `52462d5f` added the app-orb facade. Keep exact top-level allowlist, add only `app`, and assert frozen facade, exact `orb`/`tap` keys and no-front-app no-ops. Live `98b34a32`; main has no app-orb extension and needs no expectation change. |
| 14 | Navigation retains scroll reset and native signer cancellation | Incompatible native-line assertion copied by explicitly web-only `1522804f`. This live branch's Android source has public ChatScrollCapture cancellation (`22f19915`) and no native signer/device capability port; it never had ScrollProxyMetrics or the signer hooks of native `30a6644e`. Assert the actual navigation cancellation/abort and explicitly reject advertising an unsupported signer. Existing missing-bridge refusal and requesting-document identity tests remain. No Android implementation changed. Live `98b34a32`; test absent on main. |

## Protected visual drift: exact change

`4defd354d43eb7105527b1e1ed16ef573bd61e65` adds 15 lines at the end of `web/core/skins.css` (current lines 164–178). Each selector explicitly enumerates Nebula, Grove, Tide, Ember and Signal, excludes desktop/two-orb/corner-orb, and changes the phone dock:

- Reveal `.orb-app:not(:empty)` as an absolutely positioned grid, opacity `.96`.
- Size its `.dsg` to 46%, remove glyph background/border/shadow, and hide `.dn`/`.dbg`.
- Make `.sgi` white with shadows; adjust hat masks to 82%; whiten image/SVG glyphs.
- Hide the glyph during listening/paused recording and while the launcher sheet is open.

That creates a real white focused-app mark over the previously unmarked center orb. The commit message/comment attributes it to James, but this cleanup has **not** treated that as fresh approval to change protected fixtures.

Isolation proof: run the three original protected test files on the live candidate, changing **only** this stylesheet back to its `4defd354^` contents: all 11 tests pass. Restore the stylesheet byte-for-byte: the same seven protected assertions fail. The base palette/font fingerprint remains valid. No other CSS edit is needed to explain the drift.

Screenshots: ten 390×844 PNGs under `$HERMES_HOME/cache/screenshots/skin-drift-<skin>-{before,after}.png`. They use the exact live web source, the same built-in Chats desk and Classic layout, and substitute only the pre/post stylesheet. The isolated backend deliberately returns unavailable; these are dock visual evidence, not live-data or APK acceptance. Capture metadata is in adjacent `skin-drift-evidence.json`. The single-commit diff and capture runner are retained in private scratch, not published owner data.

## Verification scope

The shortcut suite adds five regressions: unchanged echo storm, self-announcing registry reads, empty-then-restored registry, unchanged native pins on resume, and resume during an in-flight refresh. Two echo regressions fail against untouched main. A real Chromium protocol fixture verifies changed PNG/name, no redraw for 100 unchanged announcements, resumed refresh, zero page errors, and zero reads/messages without a native bridge. It is a fixture, not native device proof.

The remaining seven failures are deliberately retained for owner review. Do not turn them green by accepting new fingerprints or broadening dock scope assertions without approval.
