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
three API groups x 50 samples, all 20 positive delayed-detail scope cells plus
four explicitly additional legacy full-row cells (24 total), both real shells/two skins,
and the existing ancillary cases. Timing begins on the owned row's actual
pointerdown and ends only when the latest assistant sentinel is in an on-screen,
unoccluded text Range across two animation frames. Scope cells require actual
history and actual optional-detail requests and answer paint before detail
release. Save-data controls only controlled cache-state samples; the separate
preload case enables and counts the production path.

Only static/syntax/staging checks are authorized in the repair worker. Browser
and unit acceptance remain unverified until the parent submits the sealed forum
run. No merge, deployment, restart, live agent or owner-private-data access.

## r6 main-scope diagnosis and r7 static audit

The retained r6 receipt is `heavy_d5a2fa29edcd43b4aa69d7cc91773e05`, at
`forum:/srv/work/ready-speed-20261029-d546ab6-r6/evidence`. UX correctness passed
34/34; scopes passed 16/20. Only main failed in every shell/skin because optional
detail was never requested. No A/B phase was launched. These are inherited results,
not a new run. Preserve r2/r4/r5/r6 evidence and hashes unchanged.

- `qa/agent-parity/fixture.mjs:179-189` leaves main canonical listing disabled.
  `server/service.mjs:2972-2975,3741-3742` therefore returns no canonical window;
  `live.js:224` recognizes a list-version response without `window=archive-50` and
  retries the legacy full list. Its rows have no `listVersion`; `normalize` does
  not set `detailNeeded`. `chats.js:2360` correctly omits the unnecessary detail.
  Requiring delayed detail from that full-row branch was a fixture mismatch.
- The original four main positives now provide a synthetic raw canonical reader
  (same constructor seam as the A/B fixture). The real Service projects its list
  and window metadata. Before tapping, assertions pin actual HTTP list version,
  archive window, normalized row version and hydration need. All original 20
  positives still require an actual detail request held for 1 s and answer/history
  before release. Four extra main-legacy-full cells preserve the original no-reader
  setup, assert the actual fallback row is hydrated, and require no detail for
  1.1 s after answer paint. These do not replace or skip any positive cell.
- A/B controlled samples retain real `sessionInfo/messages/forgetMessages` cache
  APIs, save-data fencing and immediate current/empty/stale eligibility checks.
  Stale preparation now waits for a genuinely changed canonical content key via
  bounded live refresh, not one potentially stale-while-refresh response. The old
  cached answer remains forbidden; timing starts only after preparation.
- `chats.js:1132-1134` initially renders only `SEC_PAGE` rows. Preparation now uses
  the real owned Show all buttons before samples; later row 30/400 cannot silently
  depend on that page size. Real actionable input/viewport/hit-test and the
  two-frame, clipped, unoccluded answer Range remain unchanged, on both real
  shells and both skins. No forced click, direct window mutation or renderer patch.
- Long history now uses actual row input/viewport answer proof, clears its cache
  through the public API and requires exactly the three 500-row page offsets
  `[0,500,1000]` for 1200 messages. No direct `openChat` bypass remains.
- Pending-voice hang preparation now uses the shipped durable outbox `enqueue`
  API with an explicit synthetic model/provider, rather than `_items` injection.
  A browser network gate holds run admission before Service through context
  teardown, so it cannot execute or retry an upstream write. The receipt requires
  actual durable custody and a real held admission attempt, alongside a held
  history request, visible pending bubble, visible retry within 14 s of the real
  12 s history deadline, and actual retry input/new answer. Public route resolution
  accepts this explicit route even with an empty synthetic model catalogue;
  recording/model inference and real provider credentials are not involved.
- Preload selection now reproduces the real combined Ready/error/working filter
  and first-16 cap before choosing a positive, <500-message Ready row. Record its
  index and count; a long heartbeat row cannot invalidate the required one-request
  page proof. The request listener is armed before enabling preload and refreshing.
- The runner must require 24 unique scope tuples, with 20 positive detail receipts
  and four no-detail legacy receipts, then all existing A/B groups and traces.
  Production source and all five correctness suites are unchanged from r6;
  34/34 UX and 52/52 + 141/141 Service may be inherited only by exact file hashes.

This is a static audit and sealed next-run specification, not a browser pass.

