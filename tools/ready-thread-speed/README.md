# Ready-thread speed candidate acceptance

REUSE WosMorph, WosChatPower, canonical session truth and the current history cache. EXTEND existing service projection, WizLive reads/preload, and Chats transcript loading. NEW no renderer, cache or protocol.

## What changed

- Service: read optional/non-holding follow-up evidence only for a thread with relevant heavy jobs; share it with truth/helper/supervisor readers inside one synchronous projection phase; discard it after asynchronous enrichment. No cross-revision evidence cache or classifier removal.
- Service: preserve the existing 100-row head semantics, but project it in 20-row cooperative slices (`setImmediate`, not a microtask). Archive and cache self-check builds use the same slices. Concurrent self-check callers join one check. Existing off/shadow/fail-closed parity controls remain.
- UX: a trusted live main row or explicit agent scope can request history without serial optional detail. Unknown cold links still discover ownership first. History paints before optional detail and approval, retaining existing cache and navigation guards. Detail/history have 12-second abort signals; the history signal spans all pages.
- UX: show independent transcript loading/error/Retry even while a voice send is pending. No custody change.
- UX: existing preload runs when main-list truth lands, with Ready before errors/working, at most two warm reads, no hidden/save-data or routed/private prefetch. Preload fingerprints use the same content fields already required by cachedMessages; metadata-only ticks do not cause repeated transcript fetches.

## Entry point

`python3 run.py /srv/work/<staged-root>` runs only through the durable forum queue. The parent handoff includes the exact cwd/argv/key. It verifies the immutable archive, source-file, runner and dependency manifests before any tests. A preflight may check syntax/import resolution/hashes without starting the fixture, running tests or launching Chromium.

### Queued phases

1. Existing focused Service node suites plus `ready-thread-speed.node.mjs`: list/cache parity, order/head semantics, cooperative yielding, open asks, private policy.
2. Existing focused Vitest suites: owned open work, helper results/status/evidence, heavy holding/non-holding jobs, canonical truth. Optional follow-up and stale evidence classifiers stay exercised.
3. UX node suites: actual WizLive known/unknown scope, warm/open join, current/stale cache, hidden/save-data behavior; actual loadThread paint-before-metadata, pending voice error/retry, A→B→A; existing helper/reading-place/outbox voice custody guards.
4. Baseline and candidate each get an isolated real Service process with 600 synthetic threads and a multi-page long history. Canonical background progress runs every 300 ms, concurrent list polls every 30 ms after each completed list request, and cache self-check every 2 seconds. No live paths or real messages are read. All outgoing upstream writes are refused and counted.
   - 50 local samples EACH for health, detail, history while background work overlaps. Gates: health p95 <100 ms; detail/history p95 <200 ms.
   - Phone-sized touch shell (412×892) and desktop shell (1280×900), both Nebula and Signal through actual Look controls. 30 actual row taps EACH for current/empty/stale cache per shell/skin: 12 timing groups per revision. Current answer paint p95 <150 ms; empty/stale p95 <1000 ms. Cache state is asserted before each tap; text must match the current synthetic answer, not a skeleton or previous reply. Tap/request/response/two-animation-frame visible-answer traces are retained, with p50/p95/max/count.
   - Multi-page history, pending synthetic voice bubble + stalled transcript + deadline + Retry, and existing-cache Ready preloading in every shell/skin. The seeded pending item is already `sending`; the rig never invokes send/pump/admission.
5. Real Service + real UX + existing synthetic gateways: main, host-profile, container, restricted, and a synthetic private-policy agent; both shells and skins. Delay optional detail 1 second and assert correctly scoped history starts before it is released, real current answer appears, and routed/private history is excluded from the main persistent cache. These are disposable gateway fixtures, not real restricted containers/confidential-model proof.

## Evidence / gates

- `evidence/report.json`: every phase argv/cwd/exit/elapsed and final gate.
- `evidence/{baseline,candidate}/results.json`: all API/tap groups and correctness cases; partial sample groups never count as complete.
- `api.jsonl`, `tap-traces.jsonl`, `list-overlap.jsonl`, screenshots, fixture logs, per-second `fixture/metrics.jsonl` (elapsed, CPU user/system and event-loop delay), `.cpuprofile`, `custody.json`.
- `evidence/scopes/{cells.jsonl,results.json}` plus screenshots: complete counted scope matrix.

A candidate is NOT accepted merely because the script ran. Parent must inspect counts, budgets, failures, traces, screenshots, profiles, classification and custody. Baseline is a measurement, not a pass requirement for new behavior.

## Boundaries / remaining release work

Automatic follow-through is disabled in the synthetic performance fixture to guarantee no agent admissions; classifier correctness is covered by focused suites. Therefore this A/B measures the unconditional evidence-read contributor and cooperative/shared request path, not every CPU source from the full live daemon. Retain separate elapsed/CPU evidence and revise attribution if budgets fail; do not claim one evidence read explains all CPU contention. No warm service or live inspector is started by preflight.

No child merge, activation, restart, private-agent data access or device installation. Parent must refresh actual serving source, reconcile in-flight overlapping live changes (including stream/media fixes), run the queued acceptance, inspect parity, use the integrated preview, preserve release/rollback lineage, and verify exact served identities before rollout. Actual phone/tailnet timing, microphone capture and native APK identity remain explicitly unverified by this loopback/browser fixture.
