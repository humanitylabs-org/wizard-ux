# Stage-2 browser-trust prototype findings

**Default-off, synthetic only, not merge-ready.** This fixes a proposed contract shape; it is not approval to migrate the 48 apps or enable any live box. No native/media/stream transport, owner-fetch relay, app-visible shell token, global Origin:null authorization, real app data or phone proof.

## REUSE / EXTEND / NEW

- REUSE Oscar/Miguel's #327 registered opaque frames, shell-only token wrapper, appearance/Back/field/share/transcription handlers, and #100 server possession gate.
- EXTEND that channel, not a parallel RPC: `hello` -> client offers one MessagePort as `ready` -> shell challenge/response -> `connected`. Application messages and replies then use only the admitted document port. WindowProxy messages cannot invoke services. The port closes on load/detach; old async replies cannot reach the replacement document.
- NEW `core/app-state.js` is one shared shell-owned IndexedDB adapter. NEW Service `browser-adapters.mjs` is a fixed synthetic operation registry, not a proxy. The two migrated fixtures live only under `tests/fixtures/browser-trust/`.

## Contract deltas versus ADAPTER-SKETCH.md

1. **Only one data operation ships:** `fixture.notifications.list` accepts exactly `{limit:1..20}` and returns one reviewed synthetic DTO shape. Production names, stable cursors, writes and outcome/status APIs are not implemented. Unknown operations and extra identity/URL fields fail closed.
2. **State is a separately granted `state.local` capability.** Both the installed `browser_contract.operations` allowlist and a separate trusted grant resolver must admit it. A manifest alone grants nothing. Production WAM grant/install lookup is deliberately not connected: the synthetic runner injects trusted installation and grant callbacks. These callbacks resolve installation ID, publisher/source, installed commit and permission revision; no frame supplies them.
3. **Namespace follows installation and source within this one local owner/browser profile.** Commit/permission revision changes revoke handles but do not erase same-installation drafts. Reinstall or publisher/source change gets a new namespace. Multi-owner/profile-account switching and future server-side canonical draft durability are not claimed.
4. **Only persistent JSON state v1 ships.** `read({area,key})`, `write({area,key,value,ifRevision,operationKey})` and `transaction({area,operationKey,changes})` use per-key revisions. A change is exactly `{kind:'put',key,value,ifRevision}`. Delete, session/cache areas, enumeration/export, subscriptions, schema upgrades beyond v1 and local blobs are not shipped. Values are limited to 32 KiB, 16 keys/transaction and 64 KiB request, with a 5 MiB maximum approved value quota.
5. **Write receipts are bounded, not permanent.** The newest 256 receipts use a separate 512 KiB budget, atomically with value writes. Recent exact retries return the original result. An evicted retry fails CAS with `conflict` rather than reapplying; callers must reread, not blindly replace newer drafts. Acknowledgement follows transaction completion and receipt readback. Browser disk loss, quota eviction, private-mode storage and cross-device recovery are not backup guarantees.
6. **Migration is a reviewed synthetic map, not arbitrary app-import.** Only source `synthetic:fixture-drafts` may copy `fixture-drafts.legacy.v1` into `draft`. Hash, value/revision and migration marker commit together and are read back. Legacy bytes remain. Re-reading rolled-back legacy bytes never replaces a newer adapter draft. A new publisher with the same display ID is not allowed to inherit them. Old-state rollback here means restoring the legacy localStorage bytes, not rolling back the entire browser IndexedDB database.
7. **Prototype authority/lifetime is bounded:** grants are re-resolved for every admitted data/state call. A state call already admitted can finish its atomic local commit; revocation denies the next admission. A document/binding is limited to 4096 requests and one hour; reload to obtain a new channel. There is no production revocation event bus or background capability lease.

## What is proven now

- Focused UX state/channel tests: CAS, atomic multi-key conflict, source/install separation, schema/size/quota denial, migrated draft readback, same-profile SDK reload and legacy rollback, request replay, stale generation, wrong source, grant callback refusal, retained-ack retry, and >2100 autosaves in a small value quota.
- Focused Service tests: fixed schemas/output, independent grants, extra/forged identity, unknown/cross-app operation, stale binding/generation, replay, changed source/commit/permissions, uninstall, revoked handle/grant, default-off HTTP and owner gate.
- Canonical strict fixture style check reports no findings. Changed-line whole-repo style ratchet has zero errors (existing warnings retained). COMPONENTS size gate must pass before commit.
- Claude Opus independently found receipt exhaustion and cached binding failure; both fixed with regressions. Follow-up: PASS for default-off synthetic scope. Reviews are in `docs/browser-trust-review/`.

## Channel-test repair and harness diagnosis

The unchanged #327 fixture passes 12/12 on stacked base `f85d6231` but fails eight on the port prototype. Each failed before reaching its intended assertion because its `ready` omitted `portRole`/MessagePort/challenge and its requests used `rpc-*` rather than `wbs-*`. Real MessageChannels now connect the actual shell boundary/services and actual SDK/client; only DOM and resource endpoints are synthetic. No product handler changes were needed.

| Original failing case | Verdict |
|---|---|
| Opaque registered transcription | Obsolete transport fixture; real handler returns trimmed text without child DOM access |
| Ten-call budget across reload/reattach | Obsolete transport fixture; eleventh refused upstream |
| Oversized audio | Obsolete transport fixture; `too_large`, no budget spent |
| Shared sheet / trusted confirmation | Obsolete transport fixture; mandatory `requireTrusted` and generation authorization retained |
| Actual WizardApp share/transcribe facade | Obsolete transport fixture; real SDK/client on real ports preserves results and structured errors |
| Forged replies / hello / pagehide | Obsolete transport fixture; even exact-looking window replies ignored, pending calls revoked |
| Budget expiry / simultaneous frames | Obsolete transport fixture; shared identity budget and ten-minute expiry retained |
| Navigation after upstream admission | Obsolete transport fixture; old result suppressed |

Unsupported operations already explicitly return `not_allowed` on an authenticated port rather than disappearing; they still grant no capability. A new test rejects missing ports/guessed nonce before services, and a harness unit regression guards the frame-context acquisition order against the blank-frame URL-enumeration race.

The diagnostic's `openFixture` waits for an iframe's **src attribute**, then searches `page.frames()` for the navigated URL. At that instant its browsing context can still be `about:blank`, so `.find()` returns undefined. The retained lifecycle shows drafts navigation *after* `harness.catch`/`finally`. Resolve the iframe's own browsing context and await its URL instead. The original canvas target-closed failure lacks crash/disconnect telemetry, so its historical cause remains unproven; the diagnostic completes both canvas readbacks and screenshots, ruling out a deterministic canvas failure on that run. Keep the original failed evidence unchanged. The repaired harness retains the opacity assertion, logs lifecycle and readback events, and the staged runner retains Chromium stderr.

Browser acceptance additionally exercises real WizardApp transcription and sharing with synthetic upstream/delivery sinks: oversized/rate-limited calls, programmatic Send denial, trusted Send admission once, and outside dismissal. It retains the hostile, Back, field, appearance, migration, reload and grant checks plus all five required stage-2 screenshots. These browser checks and full suites are staged, **not claimed passed until the parent-admitted run returns**.

## Not proven / required parent-run gate

The child cannot submit durable work (409 restriction). The exact forum job stages the r5 hostile-page pattern extended with the two fixtures, fixture identity/grant resolvers, browser migration/autosave/reload/old-legacy-rollback/recovery, revoked grants, and four in-shell screenshots (both fixtures on Nebula and Sepia). It must run on forum before screenshot inspection or a browser PASS is claimed. Full repository suites are included as separate phases, not inherited from the earlier source heads. No screenshots have yet been produced or viewed by this child. Any browser or baseline failures remain visible in phase logs/receipt; no test filtering to manufacture a green suite.

## Card 1 extension: production WAM admission for Notifications (wizard-os #384)

**Still draft and default-off.** This extends the prototype (it is not a rebuild) to the first real default-app path. Contract: wizard-os `spec/browser-trust-adapters` (`docs/proposals/browser-trust/SPEC-CARD1.md`).

- **WAM is the source of identity and grants.** WAM now projects `apps.json` `browser` facts per app: installation id (Runtipi row serial + creation time, so a reinstall is new), source id `<store source>:<owner>/<repo>`, installed commit, the normalized installed `browser_contract`, the owner's browser grants for that installation and source (`browser-grants.json`, separate from network grants), and a permission revision. It only does this when `WIZARD_BROWSER_BOUNDARY=1`. Owner grants go through `wam browser-grants grant|revoke|list`.
- **Service production resolver** (`server/browser-installations.mjs`) re-reads that file at binding creation, at each admission, before the effect and before delivering a result. An ambiguous id (two `profiles`), a staged install, a missing or unattributed source, an unreadable registry, a grant for another source or installation, or a lost slot provider each admits nothing. Enabling it needs `WIZARD_BROWSER_BOUNDARY=1` **and** `WIZARD_BROWSER_ADAPTERS=wam`; the injected prototype resolver is still there for the synthetic fixtures.
- **Fixed operations:** `notifications.list {limit 1..50, cursor:null}`, `notifications.mark_read {id, expectedRevision} + operationKey`, and `data.status {operation, operationKey}`. Each has one constant upstream path on the WAM-recorded upstream. No credentials, redirects or upstream bodies pass through, and the DTO is fixed. A non-null cursor returns `unsupported_capability`.
- **Durable outcome:** the receipt is written and fsynced, then read back, *before* the upstream effect. Success is confirmed by an upstream readback. A lost reply or an `outcome_unknown` is reconciled by key without a second effect. Key reuse with other arguments, or a stale revision, conflicts. Full receipt storage (`quota_exceeded`) or unwritable storage (`storage_unavailable`) refuses before any effect. Retention is 7 days; a retry after eviction conflicts and does not reapply.
- **Shell:** the boundary forwards only reviewed operation ids. A write must carry an `operationKey` and a read must not. `state.remove`/`list`/`clear` and non-persistent areas return `unsupported_capability`. Errors keep only `code/outcome/operationKey/retryable`.

Not proven by this extension: the real Notifications app UI migration (card 2; a synthetic test view is used), cross-app operations, Store install/update prompts, real Runtipi lifecycle on a box, cursors, the direct Notifications listener (`/notifications/api/*` on the gateway is listener work for card 3), native clients, phone, and nginx itself (a Node stand-in applied the same document template).
