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

## r8: exact visible sentinel and desktop-list recovery

r7 passed 24/24 scope cases. Its A/B comparison was incomplete: phone current and
empty passed in both skins, but old `_v1` falsely matched new `_v179…`; desktop
preparation required an intentionally hidden Back, or retained a replaced owner.
Preserve the original r7 receipt/log/results/screenshots, including these failures.

- `paint-probe.mjs` matches complete synthetic tokens. Old and current both require
  a Range clipped to the owned transcript and viewport, shown ancestors and an
  unoccluded text-parent hit. Hidden old DOM is not paint; exact visible old text
  in the last assistant answer still fails. Current requires consecutive frames.
  Five queued DOM-model regressions cover prefix collision, hidden old DOM, visible
  stale positive control, clipping/occlusion/opacity and visibility interruption.
- The r7 desktop screenshot shows list left, thread right. `desktop.css:122-129`
  hides Back above the 620px container cutoff. Verify the same owned split-list
  search is actionable; don't invent phone navigation. Narrow/phone still inputs
  the real visible Back. Every timed sample retains row geometry, header/owner,
  Back visibility and the actual navigation contract, in both skins/all states.
- Signal diagnostics requested an absent new owner, while showing the preceding
  synced Chats owner. `workspace-sync.js` joins after 300ms; desktop `apply`
  reconciles ids. Wait for public `WosWorkspaceSync.current.ok === true` BEFORE
  `WizOpenAgentChats` and retaining the resulting owner. Keep sync enabled; failed
  joins fail preparation. Reopen real Ready/Working/Errors toggles and Show all
  after navigation or canonical re-render. Never patch renderer/store or force input.
- Runner collects candidate independently after baseline execution/count/diagnostic
  failure. Aggregate still fails incomplete comparison: both sides need 12 groups
  x 30 = 360 unique actual traces, valid headers/paint, 3 x 50 API samples and zero
  upstream writes. Candidate additionally needs all ancillary cases and unchanged
  latency budgets. Baseline old ancillary/budget failures remain diagnostic, as
  before; never inherit them as candidate passes.

### Static branch audit — assumptions, not fresh execution evidence

- Long history uses shipped `WizLive.messages` (500-row pages, `include_compacted`,
  `view=wizard`), synthetic 1200-row thread 0, real row input/current answer and
  three actual responses. Fresh long-history browser proof does not scroll upward;
  read-position regression remains inherited in the unchanged nine-case
  `thread-reading-spot` suite. Do not call inherited scroll evidence fresh browser QA.
- Pending uses shipped `outbox.enqueue({kind:'reply',sessionId,model,provider})`,
  its returned durable item and rendered `.msg.pending`, not nonexistent
  `markPending`. Hold local `/wizard/hermes/v1/runs`, hold thread-400 history beyond shipped 12s
  timeout, click visible `[data-chretry]` (not outbox Retry), require pending bubble
  on skeleton AND error. Release only into abort-only route handlers before closing
  context; admission never reaches Service. Fixture
  forbids upstream writes. Missing controls/timeouts fail, never get mocked away.
- Preload uses actual `workGroups` ready/errors/working, first 16, excluding hidden,
  archived, optimistic, synthetic and non-main-cache rows. Save-data fences earlier
  state samples. Pick a real first-16 non-long row, forget cache, release save-data,
  refresh and require exactly one real background response/current cache. This is
  a completed preload, not a fresh pointerover/inflight-join test; that invariant
  remains in inherited UX regressions. Never substitute long history for this
  one-page assertion.
- Changed shared helper requires fresh 24 scope cells (20 positive delayed-detail,
  four negative legacy). Only unchanged UX34 and Service52/141 remain inherited by
  exact hashes and complete production/test inventory equality. No local tests,
  browsers, fixture services or activation; the parent queues forum execution.

## r10 exact-revision/content recovery (static; execution pending)

- REUSE real Service/canonical SQLite fixture, owned row input and unchanged
  two-frame no-stale-paint observer. EXTEND only acceptance instrumentation;
  production runtime bytes and all established correctness test sources stay equal.
- r9 (`heavy_5fbcdfdcbdb84ad48ce199935a1462f9`) retained all 24 scope and five
  paint-observer passes. Its cache failure logged only `true !== false`, not cache
  content. That is insufficient to decide stale acceptance versus current refill.
  The prior `key !== oldKey` barrier could also accept an intermediate list revision
  left by an earlier shell/skin cell. No production bug or current-refill outcome
  is claimed from those old logs.
- New mutation ACK returns the exact committed canonical count/timestamps/token.
  Read the real Service history projection and bind its exact key/token to that
  ACK; internal status-marker stripping means raw SQLite content is not the public
  history digest. Every accepted cached role/content/normalized timestamp must
  hash identically to the real current Service projection, not just match a token.
- Require exact live canonical revision before preparing each sample. Retain
  read-only accepted/cache rows, IndexedDB revision/content, live list keys and
  fetch pending/completion/content observations in `cache-evidence.jsonl`; include
  the active sample and held-request diagnostics on every browser failure.
- Once per cell, observe an unheld mutation and classify non-null only after full
  current-content validation. This diagnostic does NOT replace stale-at-tap proof:
  each of the 30 stale samples then seeds an actual old cache through public reads,
  holds browser history fetches before a distinct canonical mutation, requires
  rejection under the exact new revision immediately before input, and releases
  solely on real owned-row pointerdown. Require the new visible answer, no visible
  old latest-answer token, full current cache content, and actual gated history.
  No TC/INFLIGHT/CH/window injection or renderer patch is used.
- Baseline pending-voice absence of skeleton/deadline Retry is an explicit observed
  known limitation (`pass:false`), never candidate evidence. It must not skip later
  preload cases or group accounting. Candidate retains every skeleton/pending/error/
  deadline/real Retry assertion. Both A/B sides must still have all 12x30 unique
  taps, 150 API samples and every ancillary receipt; candidate budgets unchanged.
- New content/barrier controls are a separate 10-test gate. Scope fixture/helper,
  observer and runtime bytes are unchanged, so r9 24/24 + 5/5 are inherited by exact
  inventories/log hashes rather than rerun. Original UX34 and Service52/141 remain
  inherited with their original receipts. Parent submits the sealed short-root
  forum job; staging never launches tests, fixtures or browsers.

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

## r12: final full integrated A/B, batched stale precondition

REUSE the real Service fixture, shell navigation, history/cache APIs, exact
revision/full-content assessor and two-frame viewport paint probe. EXTEND only
the acceptance fixture preparation and counted evidence. NEW product code: none.

The r11 diagnostic passed on both A/B sides: canonical SQLite, constructor row
reader, actual compact HTTP and client converged after the normal 30 s source
cache expired (24.8–28.2 s observed). It was not final acceptance. Its sealed
receipt is `heavy_a36d652f4116432289fa50269c963a8c`, log SHA-256
`43ea87490da13320fc90f78c727254b6d9b756d0b7fce472e7041fcc6783b6c3`.
No old eight-group partial benchmark becomes a complete final result.

The final candidate combines unchanged UX product bytes with Service
`6acaa498408426f4650f418d2bd3eb6e09dd399d` (global 48-preview cap preserved;
ambiguous cross-reader evidence reuse removed, ownJobs gate retained).
Baseline remains Service `88aa5f7e` / UX `9e4cadfb`. Neither Service worktree
nor production TTL is edited by this test-only change. The current pair gets
fresh focused Service correctness and fresh 24-cell scoped browser checks;
older Service/scope results are provenance, not integrated-pair passes.

For EACH real shell and skin, outside measured opens:

1. Use real Back on phone and a real unaffected control-row open on wide desktop,
   preventing the previously open target from starting an old-key history read.
   Obtain all 30 exact canonical revisions in one bounded batch barrier. The
   constructor cache is untouched. The client, real raw HTTP count and both
   role timestamps must agree; a merely changed/intermediate key never passes.
2. Drain old target requests, read all 30 old histories through `WizLive.messages`,
   then verify all 30 accepted and persisted copies coexist, including full
   projected content digests. Read the actual exported `TC_MAX`/`TC_BYTES` and
   preload cap/order (40, 2.5 MB per thread, 16 here); never inflate test caps.
3. Fence all 30 affected history URLs. Commit 30 isolated canonical transactions,
   each adding one user/assistant turn. Wait ONCE up to 45 s for the ENTIRE batch
   to match count + both role timestamps in raw HTTP/client and committed DB.
   Require every stored old copy still intact but rejected by the accepted-cache
   API. Preserve raw/DB/reader/cache evidence per ID. No serialized 30 s wait per
   tap, no clock rounding, TTL override, cache injection or lowered target count.
4. Tap 30 real actionable owned rows sequentially. Immediately before every tap,
   prove intact old persisted content, null accepted cache, exact new canonical
   key and an unreleased target gate. Owned-row pointerdown releases ONLY that
   target; every other untapped target remains held. No request captured under
   an old key may leak across the fence. After current answer paint, require
   complete projected role/content/timestamp digest equality and retained gate
   request/release evidence. Exact old-token non-paint and visible current-token
   two-frame paint criteria are unchanged. All current/empty samples also retain
   exact pre-tap state and full-content post-paint checks.

Run both sides independently, fresh: three API groups × 50 and twelve unique
shell/skin/cache timing groups × 30 per side (360 taps per side). Current p95
<150 ms, empty/stale <1000 ms, health <100 ms, detail/history <200 ms; no budget
changed. Four ancillary cases per shell/skin are now separately counted:
long history with offsets `[0,500,1000]`, durable pending-voice/hang/deadline/Retry,
actual capped/order-correct one-page preload, and no JavaScript exceptions.
Baseline's missing skeleton/retry is an explicit recorded limitation, never a
candidate pass; baseline completeness and all unaffected correctness remain
required. The inherited r11 exact-revision diagnostic supplies the lifecycle
explanation only. No additional unheld diagnostic consumes another TTL per tap.

`batch-preparation.test.mjs` adds direct harness regressions for intact stale
counterproof, whole-batch exactness, HTTP/client disagreement, implementation
caps, and unique matrix completeness. They must run in the parent-queued job,
not at staging. The immutable rs12 runner verifies all source/archive/tool/deps
and prior evidence hashes, runs fresh correctness + both full benchmark sides
and the 24 scope cells, and independently recounts all traces/evidence tuples.
Only a full fresh matrix may set final acceptance true. Syntax/hash/import
preflight is explicitly not a browser/test pass. No deployment or activation.

## r11: diagnose mixed-source revisions before changing the oracle

REUSE the existing synthetic fixture, actual shell helpers, `historyRevision`,
`assessCache`, exact `waitForRevision`, and the clipped two-frame paint probe.
EXTEND only read-only fixture IPC and add a bounded diagnostic entrypoint. NEW
product capabilities: none. The full acceptance entrypoint and its 15 s barrier
remain unchanged; this is not a silent acceptance timeout increase.

The r10 candidate desktop/Signal failure is count-only: expected 42, client 40,
with both timestamps already exactly equal to the committed turn. Final fixture
SQLite has `sessions.message_count=42` and 42 actual rows. Earlier count-only
mixed revisions also occur in the other candidate cells and in baseline.

Source trace (Service revision 3560aa8; unchanged baseline follows the same seam):

- `service.mjs::canonicalSessions` uses a 30,000 ms canonical-row cache. Its early
  refresh signal is `readWizardAssistantRevision(inboxDbPath)`, not the message
  revision used by the projected-list gate. This fixture has no Inbox DB and
  writes messages/sessions directly in one transaction; its early signal stays
  empty. Background heartbeats invalidate projected-list snapshots but do not
  invalidate these cached canonical rows.
- `filterSessionList` copies `message_count` from that cached row, then overlays
  `wizard_last_user_at`/`wizard_last_assistant_at` from current SQLite session
  truth. Thus a real server list can legitimately contain an older count and
  newer timestamps during the configured row-cache window. A fresh projection
  or a completed `WizLive.refresh()` does not mean every source cache refreshed.
- `session-list-view.mjs::normalizeFull` maps that count and those timestamps.
  Client compact `normalize` preserves the returned fields; `refresh` replaces
  returned rows wholesale, and `sessionInfo` deliberately does not change list
  count/timestamps. There is no source-level evidence of a client partial-merge
  count bug. `contentKey` correctly includes all three fields.
- Timestamp conversion is identical in server, client and history oracle:
  `new Date(seconds*1000).toISOString()`. Binary floating-point plus Date TimeClip
  can collapse an intended 1 ms difference: r10 baseline's actual DB assistant
  value `1793274543.0839999` and user `1793274543.083` both produce `.083Z`.
  Candidate's `1793274932.656`/`1793274932.655` remain `.656Z`/`.655Z`.
  Do not decimal-round these or waive a timestamp. The diagnostic runs three
  recorded-value controls through the actual staged Service `listRow` and the
  existing history oracle before opening either shell.

`revision-diagnostic.mjs` uses one skin, two real shells, distinct main-scope IDs,
one committed user/assistant turn and one actual stale open per shell per A/B
side: four mutations and four taps total, not 720. Preserve the original
background progress and list self-check load. Observe for at most 45 s only to
classify the 15 s-vs-30 s lifecycle mismatch; do not change production TTLs or
accept intermediate keys. Every observation records committed DB count/times,
actual count, last real canonical-reader count/time, actual compact HTTP row
before client normalization, client key/list, and reduced accepted/persisted
cache evidence. The real history request stays fenced until owned-row
pointerdown. Require exact count + both timestamps + complete projected content,
null stale cache before input, real history crossing/release, two-frame current
answer paint, and zero visible old answer. No forced clicks or new UI mocks.

Expected discrimination: the constructor reader initially retains its old count
while SQLite and projected timestamps advance; after its normal TTL refresh the
actual HTTP row and client both converge to the exact committed revision. If
raw HTTP is correct but client differs, return that as a product finding before
patching. If canonical count is fresh but raw HTTP is wrong, inspect the Service
projection/snapshot rather than client code. If no convergence by 45 s, preserve
the observations and fail; do not extend the deadline again. Record whether the
original 15 s was crossed, but do not require that on every cell (cache age at
mutation differs). An exact current-key accepted cache must also pass the full
existing digest, count, marker and timestamp assessor.

The r11 stage preserves r10 failure history and all validated current/empty,
34 UX, 24 scope and five paint-observer results by exact hashes. These are
inherited, not rerun. The diagnostic cannot establish the missing 120 stale
receipts per side, final full benchmark budgets, other scopes, or two-skin stale
proof. Parent submits the sealed stage through the forum worker; no execution
via SSH and no product change, merge, image build or live deployment is implied.
