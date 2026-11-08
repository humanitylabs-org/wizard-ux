# Troubleshooter opens and gives honest connection advice

**Status:** Plan only. Actual Opus consultation completed (claude-opus-5-5, firstParty, exit 0, is_error=false, no permission denials). No product code, build, deployment or acceptance test executed.

**Outcome:** Every Open Troubleshooter action immediately opens the actual Troubleshooter window, with useful local connection help even when Tailscale is disconnected. It never mistakes a failed Wizard route for proof of no internet.

**Acceptance:**
- Working public internet + Tailscale disconnected + navigator.onLine=false: the real window opens before network work; Internet is Working when positively observed, private connection remains unconfirmed/check Tailscale, and no claim of device offline appears.
- With all network access absent, the warm shell still opens local Troubleshooter content; cold-start Android retains existing local recovery. No remote registry/readiness/API is needed to show help.
- Restoring Tailscale updates the open window and Chats freshness without reload; late stale checks cannot replace fresh evidence; existing saved messages retain custody/idempotency and deliver once.
- Healthy host, server 502, slow health endpoint, blocked public probe and non-tailnet hosts are distinct states. Public probe failure alone means unknown. Any HTTP response proves host reachability, not health or working general internet.
- Phone and desktop in-shell on two skins, live switch preserving state, opaque panels, dark standalone fallback, normal Back/outside dismissal and capture/orb access; no automatic diagnostic popup.

**Reality check:** Verified source and screenshots identify unconditional browser-offline trust in core/reach.js; detailed checks skip their public probe when that hint is false. reach.open() explicitly redirects unreachable diagnoses into #wxOffline before opening the app. status.js then hides More help. The actual remote /troubleshoot/ page is not locally cached. Both primary :8928 and fallback :8923 currently serve CSP without the public probe endpoint; parent independently GET-verified this. Native code observes active network/any VPN, not authoritative Tailscale identity, and is not exposed to the warm shell. Exact reason for the phone's false browser hint remains unproven; source native findings do not attest installed APK behavior.

**Constraints:** Preserve existing one-tap repair home and repair chat, independent server authorization, private transport, durable outbox, quiet 8s/3s hint grace, no popup during capture, current live-source capabilities and unrelated working edits. No Hermes changes, alternate tunnel/provider, broad private repair cache, automatic reload or generic VPN=Tailscale claim. Plan is a proposal, not deployment authority.

**Reuse:** REUSE built-in app registry/window/Back, existing Troubleshooter home, shared Appearance, existing outbox and cold-start native recovery. EXTEND shared WizReach evidence model, local entry for the same Troubleshooter app, status/Chats wording and runtime CSP producers. EXTEND existing versioned native capability only if adding Open Tailscale/network hints; no feature-named legacy bridge. NEW: no second diagnostic app, modal or classifier.

## Slice 1 — actual window with working local recovery
- Remove asynchronous diagnosis/unreachable interception from explicit app opening. Bypass network setup/readiness checks for recovery entry.
- Mount a locally available recovery section inside the ordinary Troubleshooter window synchronously; diagnosis runs after first paint. Reuse/move the existing check content rather than another preflight popup.
- Keep remote repair UI unavailable honestly while disconnected; when reachable attach the existing authorized home/chat in that same app. A host HTTP error must not hide local recovery or imply the repair page loaded.
- Include required local static assets in the existing shell offline delivery path; do not cache private repair APIs/transcripts. Native cold-start fallback stays available when no shell can load.
- Verification: real UI entry buttons under blocked Wizard transport and five-second checks; actual app/window identity, local content and working Back, not just button text.

## Slice 2 — one honest connection model and matching transport policy
- Separate observed internet reachability, private route and Wizard service health. Browser hints inform scheduling only; manual independent checks run even when onLine=false. Use unknown when evidence cannot distinguish causes.
- If public probe succeeds but Wizard does not: 'Internet works, but we can’t reach your Wizard. Open Tailscale and check it’s connected.' Do not claim Tailscale disconnected without a specific verified signal. If evidence is inconclusive: 'Can’t reach your Wizard', with both connection and Tailscale checks available.
- Only direct reliable evidence of absent network earns an offline assertion. No validated-network flag or single endpoint timeout alone proves all internet absent.
- Fix narrowly allowlisted probe policy in BOTH primary static runtime configuration and fallback Agent Service header producer; verify delivered headers. Do not broadly relax connect-src.
- Feed the same facts to top pill, Chats freshness and app diagnostics. Prevent hidden help and first-failure suppression of Tailscale guidance.
- Recheck on return/focus/network restoration while failing; fence stale/in-flight results, stop healthy polling, preserve outbox retry ownership.
- Native enrichment is not prerequisite for truthful web behavior. If a one-tap Open Tailscale button requires a native addition, use existing sanctioned launcher and versioned trusted-origin capability. Report active network/any VPN as observations, not Tailscale status; old clients degrade to clear instructions.

## Slice 3 — regression proof and staged delivery
- Replace tests that currently require unreachable -> popup. Preserve no-auto-popup/capture/grace regressions. Extend reach.test.mjs, status-connectivity.test.mjs, reachable operation/send tests and actual troubleshooter-window QA.
- Exercise real delivered CSP (including intentionally blocked probe), warm cached shell and cold-start fallback; avoid mocked fetch claiming policy compliance.
- Run focused + affected suite and queued forum browser acceptance; inspect phone/desktop screenshots in Nebula and Signal, switch live skin, verify dark standalone and opaque panels. Native changes additionally require real packaged-device/bridge acceptance, delivered only through installed app updater.
- Stage current-live-derived candidate before promotion. Verify source/served hashes and corrected update marker on both active upstreams and owner-edge path. Keep rollback to previous source/headers available.

**Deferred:** speed tests, broad network dashboard, new repair powers, second network route, broad offline app policy, mandatory Tailscale-specific telemetry unavailable from supported APIs.

**Evidence:** /home/telos/.hermes/cache/scratch/troubleshooter-plan-evidence.md; troubleshooter-opus-brief.md; troubleshooter-opus-response.json; troubleshooter-live-csp-verification.txt. Source-guided synthesis overrides Opus's incomplete ship ordering: local entry must accompany unconditional opening, not be postponed behind a remote iframe. Opus's 'no validated network' is not sufficient proof of no internet; retain unknowns.
