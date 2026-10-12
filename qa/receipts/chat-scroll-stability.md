# Chats slow-touch-scroll candidate QA

Status: isolated, **not deployed**. Base `dff3b59` (daily); branch `feature/chat-scroll-stability`.

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

All Chrome/mobile execution ran on Thales. Browser origin was `https://wizard.tailc0f369.ts.net/wizard-os-home/`; candidate/baseline app assets were fulfilled from separate mirrors without deployment. The baseline web tree was archived from `dff3b59`. Live main's untracked `web/data.js` and `web/summaries.js` were copied into both mirrors. Every non-GET/HEAD request was fulfilled locally, service workers blocked. The focused suite uses deterministic sessions/messages. Existing suites retain real reads and locally intercepted action/upload fixtures; no sends/actions reached the backend.

Remote original suites have compatibility-only copies (`after/remote-qa-*.cjs`): Playwright module path, service-worker block, exact mirrored seed assets, and parity's write fence widened to every non-GET/HEAD request. Their source adaptation script is `prepare-remote.py` at the evidence root. Existing test source files in this candidate are unchanged.

```sh
ssh thales 'export NODE_PATH=/Users/thales/workspace/wizard-mobile-link-candidate/node_modules; export QA_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; export QA_WEB_DIR=/Users/thales/.hermes/cache/scratch/chat-scroll-stability-20261012/after; export QA_OUT=/Users/thales/.hermes/cache/scratch/chat-scroll-stability-20261012/evidence-after; /opt/homebrew/bin/node "$QA_WEB_DIR/qa-chat-scroll-stability.cjs"'
```

During harness development, a clock jump restored backwards caused cache timestamps to remain in the future; the final expiry probe keeps time monotonic. A touchend after navigating synthesized a new-list row tap, so the navigation recovery probe cancels the old touch rather than conflating release with an explicit tap. One concurrent selection run missed its fixture in its existing fixed 4.5 s startup window; the final two-browser run passed without altering that test. Final counts above come from completed runs, not the earlier aborted probes.

Review/integration, service-worker activation and Samsung live acceptance remain parent-owned. No merge, push, restart or deployment was performed.
