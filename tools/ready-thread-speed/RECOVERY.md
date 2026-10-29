# Ready speed acceptance recovery (test-only)

REUSE: the actual shell's `WizOpenAgentChats`, navigation/Back, shared Chats renderer,
canonical list refresh and bounded Ready preload. EXTEND: synthetic acceptance
preparation and failure diagnostics. No new product capability or production edit.

## Original receipt retained

The failed durable receipt is `heavy_b8ffbe7a818547c295b07a0186c95003`.
Its evidence remains untouched at
`forum:/srv/work/ready-speed-20261029-3560aa8-r2/evidence`.
Production UX revision: `ec6ca4590f7d7c59518abb82bc1e9e8488ef65ca`;
Service revision: `3560aa8290e82e230604af0dcfc4575d347c73b9`.
Service 52/52 Node and 141/141 Vitest passes may be inherited only with exact
original log hashes. UX was 32/33; browser tap groups were incomplete, not green.
Original API measurements remain provisional synthetic contributor evidence.

## Diagnosed causes

- The cold unknown unit fixture omitted `wizard_retry_input`. Real `sessionInfo`
  deliberately reads `messages?limit=100` to recover legacy retry input before
  the requested `limit=500` transcript. This was not a duplicate open or a timer.
  The modern fixture now supplies metadata and retains the exact one-read
  assertion; a separate legacy regression asserts the two distinct reads.
- The r5 legacy fixture had two additional test-only defects: its VM never loaded
  `web/core/chat-kit.js`, so the optional `WosChat.parseRows` call could not recover
  user text, and the assertion used nonexistent `retryInput` instead of normalized
  `request`. The fixture now loads the actual shipped kit into the same VM, checks
  recovered `request`, and parses the returned transcript to require the actual
  user text and current assistant answer. Exact modern one-read (`limit=500`) and
  legacy two-read (`limit=100` then `limit=500`) assertions remain, with no new or
  removed test cases (the runner still requires 34/34). Failed r4/r5 evidence is
  retained alongside r2; no browser phase passed in either fast-failed recovery.
  Static audit covered every speed-test assertion and its imports, VM globals,
  detail gate, scope pinning, fetch response shape, in-flight join and cache-key
  invalidation against the serving source. The kit's startup only binds document
  listeners already supplied by this VM; parser dependencies ship in that same
  file. The other four files in the 34-test gate and their source dependencies
  remain unchanged. Syntax checks are not test execution or an acceptance pass.
- Every browser context advertised touch, so the supposed desktop entrypoint
  redirected into the phone shell. Both the receipt errors and desktop failure
  screenshot show the phone body/overview, not a desktop window. Contexts now
  use the appropriate capability and explicit supported `?shell=` override;
  every cell asserts actual shell identity.
- The phone preparation guessed desk 1 and selected the first layout-visible
  row globally. Phone retains translated off-desk DOM; `:visible` does not mean
  an input point is on screen. Preparation now awaits real agent-focus opening
  and derives its current desk/window. Owned-window locators and trial input,
  viewport/elementFromPoint assertions precede real taps/clicks.
- The previous setup opened Look settings, changed skin there, then attempted
  asynchronous sheet closure/navigation. The screenshots also show first-run
  Setup, whose delayed response was not fenced by the tour localStorage keys.
  Disposable Service settings now use schema-1 ISO `setup.seen_at`, and skin is
  established before shell boot. No UI is hidden/removed and no animation is
  disabled. Failure receipts include shell, current desks/windows, row geometry
  and Setup launch log.
- Scope results were 20 cells, with 16 passes and four private-row timeouts.
  Standard cells passed under both labels, but the shared touch capability means
  the desktop label did not establish desktop-shell proof. All four synthetic
  private cells failed to find a row. `setSupervisorSeal('private', [])` supplied
  an array where real agent parsing requires boolean `shared_with_agents`, so
  the synthetic private agent disappeared from the registry. It now uses false
  and explicitly verifies registry privacy before opening the UI.
- Two additional unexercised fixture defects were found statically: optional
  `sessionInfo` hydration does not replace canonical list revision/counts, so
  stale-cache setup must await `refresh()` rather than treat detail as truth;
  Ready preload considers a bounded first 16, so hard-coded thread 30 cannot
  prove preloading. The preload case now chooses an actual eligible Ready row,
  empties that row's cache, enables normal preload and requires one real read.

## Acceptance boundary

The repaired run still requires 12 tap groups x 30 samples for each A/B side,
exact served model/renderer/both-shell script hashes against the staged export,
three API groups x 50 samples, all 20 scope cells, both real shells/two skins,
and the existing ancillary cases. Timing begins on the owned row's actual
pointerdown and ends only when the latest assistant sentinel is in an on-screen,
unoccluded text Range across two animation frames. Scope cells require actual
history and actual optional-detail requests and answer paint before detail
release. Save-data controls only controlled cache-state samples; the separate
preload case enables and counts the production path.

Only static/syntax/staging checks are authorized in the repair worker. Browser
and unit acceptance remain unverified until the parent submits the sealed forum
run. No merge, deployment, restart, live agent or owner-private-data access.
