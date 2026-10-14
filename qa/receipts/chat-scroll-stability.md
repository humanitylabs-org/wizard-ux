# Chats slow-touch-scroll candidate QA

Status: **live on daily**, source `7ba02b9`, integrated with daily `c4f61a7`. Original isolated baseline `dff3b59`; branch `feature/chat-scroll-stability`. The physical handset's black-pixel symptom remains unverified.

## Diagnosis and bounded change

Chromium's native vertical scroll emitted `pointercancel` with the finger still down. The old message guard lifted 900 ms later and expired stationary pointer ownership at 15 s. List long-press state was discarded on vertical movement; changed session/activity HTML then replaced the entire list. These paths demonstrably detached the actively scrolled DOM. This is a credible repaint trigger, **not proof of the reported Samsung black pixels**.

`web/core/chats.js` now owns genuine Touch Events until touchend/touchcancel, defers background thread and list paints through native inertia (350 ms scroll-idle debounce), and coalesces to current canonical client data. Selection retains its two-minute cap. Lost-end recovery is bounded by two minutes of inactivity and visibility/pagehide/blur; explicit remount/navigation discards detached targets. Explicit search, row actions and Back remain immediate. No CSS/compositor, scenery, native, or backend changes.

## Thales evidence

Root: `/Users/thales/.hermes/cache/scratch/chat-scroll-stability-20261012/`

| Suite | Final result | Evidence |
|---|---|---|
| Same focused regression against untouched base assets | 21 pass / 4 fail | `before.log`, `evidence-before/receipt.json` |
| Focused candidate regression | 25 pass / 0 fail | `after.log`, `evidence-after/receipt.json` |
| Existing text selection | 15 pass / 0 fail | `select.log` |
| Existing Ready status | 51 pass / 0 fail | `ready.log` |
| Existing Chats parity | 31 pass / 0 fail (807/807 threads) | `parity.log` |
| Node syntax | Both changed JS files pass | `/opt/homebrew/bin/node --check` |

Sustained real CDP moves lasted 18 s on both surfaces, crossing both the old 900 ms cancellation delay and 15 s cutoff. Candidate list scroll moved 0→183 px and thread 500→683 px, with **zero subtree replacements** during either interaction while messages continued polling. Base list replaced its subtree seven times and thread five times; scroll stopped progressing at 36/537 px. Real post-lift inertia is separately exercised: base painted ~9 ms after the last scroll, candidate waits for settling. The latest fixture revision lands after lift; selection, expiry, cancellation, simulated visibility recovery, navigation during ownership, search, real row long-press/tap, CloseWatcher and history Back pass.

Screenshots: `evidence-after/list-slow-18s.png`, `evidence-after/thread-slow-18s.png`. Headless fixture message lines, header and composer render normally. No attached handset was available; Samsung pixel behavior remains unverified.

Exact tested SHA-256:
- `web/core/chats.js`: `4616ff2b26f0315fcb09dbf72e0319921861de58edde53b29906c257f0313dd5`
- `qa-chat-scroll-stability.cjs`: `82bb75a5f3e1938f4291f96d8a8ee3eab7d8a9171ac5311eb15a000fb718ecdd`

## Reproduction and safety

All Chrome/mobile execution ran on Thales. Browser origin was `https://<machine>.<tailnet>.ts.net/wizard-os-home/`; candidate/baseline app assets were fulfilled from separate mirrors without deployment. The baseline web tree was archived from `dff3b59`. Live main's untracked `web/data.js` and `web/summaries.js` were copied into both mirrors. Every non-GET/HEAD request was fulfilled locally, service workers blocked. The focused suite uses deterministic sessions/messages. Existing suites retain real reads and locally intercepted action/upload fixtures; no sends/actions reached the backend.

Remote original suites have compatibility-only copies (`after/remote-qa-*.cjs`): Playwright module path, service-worker block, exact mirrored seed assets, and parity's write fence widened to every non-GET/HEAD request. Their source adaptation script is `prepare-remote.py` at the evidence root. Existing test source files in this candidate are unchanged.

```sh
ssh thales 'export NODE_PATH=/Users/thales/workspace/wizard-mobile-link-candidate/node_modules; export QA_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; export QA_WEB_DIR=/Users/thales/.hermes/cache/scratch/chat-scroll-stability-20261012/after; export QA_OUT=/Users/thales/.hermes/cache/scratch/chat-scroll-stability-20261012/evidence-after; /opt/homebrew/bin/node "$QA_WEB_DIR/qa-chat-scroll-stability.cjs"'
```

During harness development, a clock jump restored backwards caused cache timestamps to remain in the future; the final expiry probe keeps time monotonic. A touchend after navigating synthesized a new-list row tap, so the navigation recovery probe cancels the old touch rather than conflating release with an explicit tap. One concurrent selection run missed its fixture in its existing fixed 4.5 s startup window; the final two-browser run passed without altering that test. Final counts above come from completed runs, not the earlier aborted probes.

Original helper handoff stopped before integration/deployment; parent then completed the following live delivery.

## Parent integration and live verification

- Integrated the newer `daily c4f61a7` source, preserving concurrent model-route and Store changes; committed focused QA's `QA_LIVE=1` mode at `7ba02b9` and fast-forwarded canonical daily. Static files are served directly by `wizard-mobile.service` on 8923; no backend restart needed or performed. Version hook emitted web tree `e791f37e6967d9e7c534af6263e655ca1a539f6c`.
- Integrated real-touch regression **25/25**, selection **15/15**, Ready **51/51**, model-route contracts **14/14** on Thales. Exact-live focused regression, with all candidate asset overrides removed, **25/25** at the canonical origin. Sustained list and transcript drags each moved 183 px, retained their original nodes, and had zero subtree replacements; updates continued loading and flushed automatically afterward.
- Fresh phone and desktop live browsers loaded the exact repaired `core/chats.js` SHA-256 `130f05a5d72bd9a5515b4cd536d57cbd0f0df9e2142cf031b3b0a33d8486636e`. Phone service worker activated and page reloaded under its control; desktop intentionally does not register a worker. Both rendered real rows with zero page errors; screenshots inspected. Smoke made zero non-GET/HEAD requests. Final local served hash/version remained unchanged.
- Latest broad Chats parity **29 pass / 2 fail on both untouched daily and candidate** (reply-attachment send fixture and tray clear), independently baseline-compared. Original helper's 31/31 belongs to the older base. A temporary model-lock acknowledgement fixture did not alter those failures and was discarded; production send/model code is unchanged by this repair.
- Twenty-round accelerated real-data/churn phone soak passed: baseline heap +0.83 MB, nodes -8; candidate heap +0.79 MB, nodes -1108; no listener or document growth. Desktop soak failed pre-existing DOM growth in both baseline and candidate (~100k nodes); candidate additionally narrowly crossed heap budget (+6.34 MB vs baseline +5.89 MB). This is an open broader desktop stability finding, not a passing gate or evidence about Samsung pixels. Soaks used 100x timer compression, not actual elapsed hours. No adjacent production fix was attempted.
- Parent remote evidence: `/Users/thales/.hermes/cache/scratch/chat-scroll-parent/` (`integrated.log`, `qa-select-text.log`, `qa-ready-status.log`, `qa-model-route-contract.log`, `parity-baseline.log`, `soak/`, `soak-candidate/`, `live.log`, `live-regression/receipt.json`, `live-smoke/smoke.json`). Local live receipt and screenshots: `/home/telos/.hermes/cache/scratch/chat-scroll-live-receipt.json`, `/home/telos/.hermes/cache/scratch/chat-scroll-live-smoke/`.
- The reported physical handset's intermittent blacked-out text remains unverified. The app-side redraw defect is reproduced, repaired and verified live; next observation is whether the symptom recurs after reloading the updated interface. No APK is required.

