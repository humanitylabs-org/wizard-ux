# Troubleshooter plan: verified source/native seams

Plan-only evidence, inspected 2026-11-04 UTC. No implementation, deploy, heavy tests, browser, or owner/private-agent data access. Parent is handling history/Opus consultation; this document covers source and serving provenance.

## Outcome

Every explicit **Open Troubleshooter** action should immediately open the ordinary Troubleshooter app window. Connection diagnosis belongs inside that app and must remain available locally when the tailnet/server is unreachable. A failed route/public probe must never be stated as proof that the device has no Internet.

Preserve the earlier no-auto-popup correction (thread `wizard_1793433030722_13527263ba58` supplied by parent): no automatic `#wxOffline`, including navigation/Enter/scroll during an outage; subtle pill only after 8 s slow-server / 3 s device-offline hint; manual details only; never over orb/capture. Appearance acceptance: Appearance v1 `--wz-*`, two in-shell skins, live skin switch without state loss, dark standalone fallback, opaque text-bearing panels.

## 1. Exact live source provenance

Caddy config `/home/telos/.config/private-gateway/Caddyfile:297-324` routes `/wizard-os-home/*` first to `127.0.0.1:8928`, fallback `:8923`, `lb_policy first`. `/troubleshoot/*` bypasses the sign-in bridge at `:279-290`, routes directly to Troubleshooter `:9691`, and injects the verified peer header. It still requires a working route to the same Wizard host.

Read-only Docker inspection:

- Primary `wizard-interface-candidate`, image `wizard-ux:interface-626c21102374a47b1a2fe7bcdc54c3b13b1dc4bd-amd64`, image revision `626c21102374a47b1a2fe7bcdc54c3b13b1dc4bd`.
- Primary bind mounts **`/home/telos/apps/wizard-os-home/web` → `/usr/share/nginx/wizard-ux` read-only**; static files are NOT solely the old image contents. Its generated nginx config is `/tmp/nginx.conf`, listening on `:8928`.
- `/home/telos/apps/wizard-os-home` Git HEAD = `03fa4ee793cec2e1b1d31c44d4f323a1448b1455` (`test: reconcile launcher file fallback with canonical house identity`). Its only reported status item was existing untracked `.hermes/`.
- Agent Service fallback `wizard-agent-service`, runtime image `wizard-agent-service-runtime:node22.22.3-py3`; environment `WIZARD_UX_DIR=/home/telos/.local/share/wizard-ux/current/web`.
- Managed pointer resolves to `/home/telos/.local/share/wizard-ux/releases/03fa4ee793cec2e1b1d31c44d4f323a1448b1455` (release snapshot, no `.git`). Agent Service code resolves to `/home/telos/.local/share/wizard-mobile-server/releases/was-1bde91decbb42448a8d00ba5394b0fd7900b4d7b`.

Direct GETs to **both** `:8928/wizard-os-home/` and `:8923/wizard-os-home/` verified matching file hashes against the managed snapshot:

| File | SHA-256 (local = primary = fallback) |
|---|---|
| `web/core/reach.js` | `25e793b38bb957f484ffc68924d0794277f2e053e301332e488fdb64a0d1d7af` |
| `web/core/status.js` | `941156682dfaef5b4416a4129bad7a85070915231ce8dc422f8717fdce707549` |
| `web/core/chats.js` | `7809bf7c9ae4f0266f526e58c4f5c8d8843a84f9473305f272863044c433ebbf` |
| `web/app.js` | `1a3fbe336cba87d0e86757b59e5031a045806e65e152103916d9143c8fcc22dc` |
| `web/ux-version.txt` | `8db074a0d0474ef4da47d5f921e6e1fa7e450ec5591c903853b99db4d42da2aa` |

`ux-version.txt` contains **`219349e490ea37056bfdda49399b0039b124515a`**, not the release HEAD. Do not use this marker alone to identify live source.

All UX source line references below are relative to the verified managed release root above; served JS bytes match. Native Java is source in that release: **not proof of the exact APK installed on James's phone** (no APK/device inspection performed).

Canonical `/home/telos/workspace/wizard-ux` was only inspected read-only. Existing staged paths: `tests/space-members.test.mjs`, `web/core/chats.js`, `web/live.js`; no unstaged diff paths reported. Do not touch or reset those edits.

## 2. False-offline classification: two distinct paths

### A. Shared diagnosis trusts `navigator.onLine` after a private-host failure

`web/core/reach.js:22-33`:

```js
try { ping = await request('/troubleshoot/api/ping'); }
catch (_) {
  if (navigator.onLine === false)
    return result('device-offline', 'Your device is offline. Messages are saved and will send when you reconnect.', 'Device offline · retrying');
  if (/\.ts\.net$/i.test(String(location.hostname || ''))) {
    return result('tailscale', 'Can’t reach your Wizard. Check that Tailscale is on on this device and signed in to the same account as your Wizard, and that the computer running your Wizard is on. Messages are saved and will send when it’s back.', 'Can’t reach Wizard · retrying');
  }
}
```

A failed private ping proves neither a failed Internet connection nor that Tailscale is definitely off. With Tailscale off, the `.ts.net` route/DNS may fail while ordinary Internet works. If WebView also reports `onLine === false`, that branch wins **before** the tailnet-specific explanation. The screenshot's exact `Device offline · retrying` and `This device is offline` strings imply that false browser hint was present at the respective classifications. We have no phone telemetry to establish why WebView produced it.

### B. Detailed checks treat one blocked public request as Internet failure

`web/core/reach.js:90,99-117`:

```js
const INTERNET = 'https://derp1.tailscale.com/generate_204';
const offline = navigator.onLine === false;
const [net, ping] = await Promise.all([
  offline ? Promise.resolve({ ok: false, ms: 0 })
    : timed(() => request(INTERNET, { mode: 'no-cors', credentials: 'omit' })),
  timed(() => request('/troubleshoot/api/ping')),
]);
// when ping fails:
out.internet = net.ok ? speed(net) : { state: 'bad', ms: 0, detail: offline ? 'This device is offline' : 'No connection' };
out.tailscale = net.ok ? { state: 'bad', ms: 0, detail: ts ? 'Can’t reach your Wizard' : 'Can’t reach your Wizard’s address' }
  : { state: 'wait', ms: 0, detail: 'Needs internet first' };
out.wizard = { state: 'wait', ms: 0, detail: 'Waiting for the connection' };
```

**Verified deployment mismatch:** both live shell responses currently send:

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' blob: data:; media-src 'self' blob:; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'
```

This excludes the public DERP probe. `mode: no-cors` does not bypass CSP. Therefore even with `onLine === true`, private-host ping failure + CSP-blocked DERP request yields Internet **Problem/No connection**, Tailscale **Waiting/Needs internet first**, Wizard **Waiting**. With `onLine === false`, no DERP request is attempted and detail becomes **This device is offline**.

Source discrepancy matters:
- Current UX snapshot `packaging/static.conf:4` **does** allow `https://derp1.tailscale.com/generate_204`.
- Running primary container's generated `/tmp/wizard-static.conf:4` **does not**; confirmed through `nginx -T -c /tmp/nginx.conf` and HTTP headers.
- Fallback Agent Service `/home/telos/.local/share/wizard-mobile-server/current/server/service.mjs:6788-6811`, especially `:6802`, explicitly sends the restrictive policy above.
- Replacing web assets alone cannot align these runtime header producers. A plan that keeps the public probe must address both primary packaging/config and fallback Agent Service, while still treating failed public probes as inconclusive.

`web/core/status.js:241-244` compounds this:

```js
const offlineDevice = navigator.onLine === false || c?.internet?.state === 'bad';
const title = happy ? 'Back online' : offlineDevice ? 'You’re offline' : 'Can’t reach your Wizard';
const canHelp = !happy && c && c.tailscale?.state !== 'bad'
  && c.internet?.state !== 'bad' && c.tailscale?.state !== 'wait';
```

Thus the title asserts offline from either untrusted hint or failed public probe, and the same failed checks **remove More help**. `:219-224` chooses airplane-mode/Wi-Fi advice first, hiding actionable Tailscale advice. `:251` leaves only Check again plus the close button for the screenshot's state. This is a deterministic source path, not an inferred visual bug.

### C. Global banner can also say offline from the hint

`web/core/status.js:135-149`: fresh successful Wizard reads / generation-matched successful probes override stale offline flags, but if Wizard cannot be reached there is no successful evidence to override the hint. `navigator.onLine === false` sets `net='offline'`; the offline event directly sets it too. `render():176-183` then renders `Offline · messages send when you’re back`. The 3 s / 8 s grace at `:36-38` must remain unchanged in intent, not be replaced with popups.

## 3. Exact Open Troubleshooter interception chain

1. `web/core/chats.js:55` creates `<button ... data-chtroubleshoot>Open Troubleshooter</button>`.
2. List read errors use it at `:1333-1335`: `Not up to date ... reachLabel('read')` plus that button. `reachLabel` calls `WizReach.label` (`:52-55`), which returns the cached diagnosis short text except for confirmed-healthy saved sends (`reach.js:67-70`).
3. Chats delegated click `web/core/chats.js:2965`:

```js
if (e.target.closest('[data-chtroubleshoot]')) { window.WizReach?.open(); return true; }
```

4. `web/core/reach.js:135-143` refreshes diagnosis (potential network wait) and **intercepts before opening the app**:

```js
let d = cached;
if (!d || Date.now() - cachedAt > 3000) {
  try { d = await diagnose(3000); } catch (e) { d = cached; }
}
if (d && UNREACHABLE.has(d.layer)) {
  window.dispatchEvent(new Event('wizreachexplain')); return false;
}
try { if (window.WizOpenApp?.('troubleshooter')) return true; } catch (e) {}
```

`UNREACHABLE` at `reach.js:8` is `device-offline`, `tailscale`, `unreachable`. All explicit callers using this shared open method are intercepted consistently; this is intentional existing behavior, not a lost click.

5. `web/core/status.js:316` binds `wizreachexplain` to `openOffline`. `openOffline():269-277` renders `#wxOffline`, checks local capture state, runs `WizReach.checks()`, moves focus to close.
6. `renderOffline():241-251` gates More help behind Internet and tailnet success. If shown, More help (`:212`) calls `WizReach.open()` again and can re-enter the same interception. No unconditional route into the actual app exists in the unreachable state.

Ordinary app route already exists:
- `web/core/apps.js:12-13`: built-in `id:'troubleshooter', kind:'wizard', url:'/troubleshoot/'`, independent of remote app catalog availability.
- `web/app.js:1171-1176`: `WizOpenApp` validates a same-origin hosted wizard app then invokes `openApp`.
- `web/app.js:1235-1236`: generic `WosAppSetup.gate` is in this route too. `web/core/app-setup.js:178-230` opens after at most 250 ms on missing readiness data, but may overlay a setup sheet for actual gaps; there is **no explicit Troubleshooter bypass**. For the requested always-open recovery path, do not add a remote readiness precondition here.
- `web/app.js:1250` opens/reuses the normal `app:'frame', appId` window. This is the existing app-window capability to REUSE, not a new fullscreen UI.

## 4. Local recovery: what exists and what does not

### Warm shell

There IS local diagnostic rendering: `status.js` builds the offline card from already-loaded code and `reach.js` runs probes. But it is **not the actual Troubleshooter app**, lacks native network evidence, hides help on the very states needing it, and is intercepted into a close/Check again loop.

There is **no offline-served `/troubleshoot/` document** in this source path:
- `web/sw.js:123-130` sends same-origin requests outside the shell scope straight to `fetch(req)`; `/troubleshoot/` is outside `/wizard-os-home/`.
- `web/core/offline-apps.js:5` grants reviewed offline app sessions only to `wisdom`.
- Real Troubleshooter page is `/home/telos/apps/wizard-troubleshooter/web/index.html`; ordinary document is served by separate remote `server.mjs:137-139` (peer authorization at `:123-129`). It can survive shell/sign-in/agent failures when the host is reachable, but cannot load over a missing tailnet route.
- That page does have graceful shell-style absence (`index.html:8-16,168`) and remote API failure status (`:228-232,292-300`, reads `/troubleshoot/api/status`); this is not an offline document cache or local connection repair mode.

Simply deleting the interception and loading the remote URL is insufficient for the explicit remote-unreachable acceptance criterion. The app must have a locally available entry surface (cached/bundled shell-owned recovery document/content in the SAME Troubleshooter window) and then attach remote repair chat/status when reachable. Reuse its real document/appearance structure rather than creating another standalone preflight modal. Do not broadly cache private `/troubleshoot/api/*` repair chats.

### Cold-start Android native fallback

The existing native fallback is separate, only for failed/hung **main-frame loads**, not in-page API failures of a warm shell:
- `MainActivity.java:146`: `new ReachScreen(this, root, this::retryReach, this::openTailscale)`.
- `:227-231`: main-frame `onReceivedError` → `showOffline`.
- `:494-498`, `:529-534`: 1.2 s mark uses native network/VPN state; 10 s gives up.
- `:545-565`: shows local native explanation; retries the desired main-frame URL every 15 s while resumed.
- `:579-603`: default-network callback + 700 ms settle retries when native reason changes. `landed():537-542` hides recovery once a page paints.
- `ReachPolicy.java:31-35`: no active network → `NO_NETWORK`; configured tailnet + no VPN → `TAILSCALE_OFF`; else `NOT_ANSWERING`.
- `ReachPolicy.java:53-65`: **Tailscale is off** / Turn Tailscale on is already correct for `network=true,vpn=false`.
- `ReachPolicy.java:69-72`: offers Tailscale when installed except when classified no-network.
- `ReachScreen.java:175-192` network observation:

```java
Network n = cm == null ? null : cm.getActiveNetwork();
NetworkCapabilities nc = n == null ? null : cm.getNetworkCapabilities(n);
network = nc != null;
vpn = nc != null && nc.hasTransport(NetworkCapabilities.TRANSPORT_VPN);
return new boolean[]{network, vpn};
```

This is **active network present / any VPN transport**, NOT Internet validation and NOT identification of the Tailscale process or login/account/route state. Do not expose it as certain Internet OK/Tailscale connected.

- `ServerOrigin.java:68-70`: only `.ts.net` host suffix means `needsTailscale`.
- `MainActivity.java:575-576` reuses `TailscaleGuideView.openTailscale(this)`; `TailscaleGuideView.java:84-95` opens installed Tailscale, otherwise Play store fallback.
- `TailscaleGuide.java:61-75` already accepts installed/on/missing observations to choose ordered setup steps; `:78-104` supplies shared private-network guidance. Native network extraction itself remains in `ReachScreen.net`, not in this pure guide. Reuse these native policies rather than duplicating a new classifier.

No network diagnostic capability is exposed to warm-shell JS in these source seams: `MainActivity.Bridge` (`:969` onwards) exposes platform/browser/change-server and other methods, but no connection status/open-reach method; `DeviceMessageProtocol.java:53-62` capability list is packages/identity/capture/shares (+vault at `:18-21`), not network. `ReachScreen.net` is package-private Java. A warm cached shell currently cannot ask the existing native recovery policy to explain Tailscale-off or launch its local recovery screen.

Native source SHA-256 (not installed APK attestation):
- ReachPolicy.java `7781e110adf64072814e9c78cbfe26e0acbf80d82c2cdc4effb3d79ead79a8cf`
- ReachScreen.java `244ae8eb4c89cbc98dfd36646701565d7b717347779cad0195f417a3d5368915`
- MainActivity.java `2692236325115357090d52e1980982cbeec15eb2b77b0cd2c9d6dcaea05a0891`

## 5. Minimal coherent fix plan (not implemented)

### Slice 1 — direct entry + honest locally available diagnosis

**REUSE** app registry/window/back/theme paths (`COMPONENTS.md:30-33,43`). **EXTEND** `WizReach`, actual Troubleshooter entry/document, and existing shell offline asset ownership. No second troubleshooter capability.

- Make explicit Troubleshooter navigation unconditional/same-frame in the shell; do not await diagnosis or dispatch `wizreachexplain` as its substitute. Preserve return-to-origin/normal app Back. Do not introduce setup/readiness preflights for recovery.
- Ensure its connection section is available locally in the ordinary app window, not merely a remote iframe that hangs. Use a narrow shared recovery entry owned by the app plus the existing shell/offline cache machinery; attach the real remote repair UI when reachable. Document the scope/admission if extending the currently Wisdom-only offline app policy. Keep private repair chats/APIs uncached.
- Use `navigator.onLine` as a hint, not proof; failed public request = unknown/unverified, not automatically no Internet. Keep separate Internet, private-route and Wizard-service observations. Show Tailscale/host checks even when Internet evidence is unknown. Actual private-host HTTP response is positive reachability evidence; separate busy/status failures from route failures.
- Internet connected + Tailscale off must say private connection unavailable / check Tailscale, not device offline. On browsers without reliable native data, prefer honest uncertain language.
- If retaining DERP probe, align both served CSP/header producers and test primary/fallback response headers, not just the on-disk `packaging/static.conf`. Even aligned CSP does not make failure of one public endpoint proof of no Internet.

Verification: warm cached shell; block all Wizard/tailnet requests with Internet otherwise available and explicit native `network present/no VPN`, tap each Open Troubleshooter entry → actual app identity/window appears immediately, local diagnostics remain interactive; remote chat unavailable honestly; Open Tailscale available. No `#wxOffline` substitute. Repeat with false `navigator.onLine=false`, DERP blocked by CSP, public DERP only blocked, actual airplane mode, non-tailnet URL, server 502/slow health/sign-in, stale in-flight probes.

### Slice 2 — native evidence into that same recovery surface

**EXTEND** origin-scoped/versioned native capability plumbing, reusing `ReachScreen.net`/`ReachPolicy`/`TailscaleGuide` rather than a duplicate implementation. Return structured observations with unknowns (`activeNetwork`, Internet-capability/validation if added, VPN transport presence, Tailscale installed, configured tailnet), timestamps and conservative labels. Any VPN is not necessarily Tailscale. Reuse existing sanctioned launcher/open-Tailscale action; maintain trusted-origin/allowlist checks.

Verification: Java pure policy tests and bounded native bridge acceptance for no network, Wi-Fi/mobile + no VPN, other VPN, Tailscale on/off, public host; warm-shell path and cold-start path share explanation but do not auto-open recovery during normal shell use. Returning from Tailscale updates diagnostics in place. Native API absent/old APK gracefully remains unknown, never guessed.

### Slice 3 — retain no-auto-popup and appearance contracts

Keep 8 s slow-server / 3 s browser-offline-hint grace, quiet pill only; no automatic dialog on idle/navigation/Enter/scroll/network events; capture/orb remains usable. Manual entry belongs to the actual app. Keep existing durable outbox custody/retry semantics and read-versus-send wording; diagnosis must not imply an outbound message exists.

Verify in-shell on two skins + live switch, dark standalone fallback, opaque text-bearing surfaces, 44 px targets, outside-tap/Back behavior, phone/desktop, no titlebar/capture/orb overlap. Future browser/native/heavy acceptance runs must use the authorized queued forum rig; none run in this investigation.

Deferred: broad network diagnostics dashboard, speed tests, new remote restart/repair powers, private-agent data, cache-all-apps policy. No release/deploy until plan approval and staged acceptance.

## 6. Existing relevant tests (read, NOT executed)

- `tests/reach.test.mjs:14-29` validates current navigator-offline/route branches; `:31-96` gateway/layer ordering/timeouts; `:99-105` safe app navigation; **`:128-138` currently REQUIRES unreachable Troubleshoot → offline popup**, and `:166-175` fresh diagnosis before interception. These must intentionally change for the new product requirement, not be blindly preserved.
- `tests/reach.test.mjs:140-157` covers Internet/tailnet/Wizard rows but stubs fetch; it cannot detect real served CSP excluding DERP. Add header-aware integration coverage and unknown/evidence cases.
- `tests/status-connectivity.test.mjs:62-98,163-218` covers false offline flag overridden by real reads, freshness/generation races, short blips, iOS timeout compatibility.
- `tests/status-connectivity.test.mjs:133-137` also REQUIRES any Troubleshoot action to open the popup when unreachable; update that obsolete acceptance.
- `tests/status-connectivity.test.mjs:221-244` is the important preserved no-auto-popup regression: no auto-open on idle/navigation/Enter/scroll; 8 s / 3 s grace; manual pill / outside / capture / recovery behavior. Earlier test names `:100-121` are stale wording (navigation no longer auto-opens); inspect assertions, not name alone.
- `tests/reachable-operation-labels.test.mjs` exercises production send/read surfaces and custody; `tests/reachable-send-pill.test.mjs` retains Retry/Open Troubleshooter affordances and unsent count. Add behavior checks to ensure clicking reaches actual app, not just matching button HTML.
- `qa-troubleshooter-window.cjs:1-7` asserts normal app window phone+desktop, shell stays loaded, hosted page hides its own back link, 44 px waiting-pill controls; currently uses reachable fixture Troubleshooter and network errors on writes, not complete route loss.
- `qa-status-connectivity.cjs` covers false offline/probe races, `WizOpenApp('troubleshooter')` ordinary-window path, quiet/manual checks/capture behavior. Extend it to real button chain plus remote-unreachable local document and two skins.
- `tools/qa_reach.py` exercises shared diagnosis/window/outbox across phone/desktop/Android UA and blocked requests; old expectations mention popup and require review.
- `android/app/src/test/java/ai/wizards/os/ReachPolicyTest.java:11-23` already explicitly covers James's Wi-Fi up/Tailscale off → `TAILSCALE_OFF`; `:37-59` retry-on-change / useful Tailscale action. These test pure rules, not ConnectivityManager extraction or warm-shell exposure; add those seams.

## Investigation limits / encountered issues

- Did not inspect the actual screenshots or phone telemetry; screenshot wording came from parent's task context. Source fully explains matching states, but cannot prove phone-specific `navigator.onLine` cause or installed APK version.
- Initial default `nginx -T` pointed to unused `/etc/nginx/nginx.conf` and failed on read-only `/run/nginx.pid`. Retried with actual `/tmp/nginx.conf`; config dump succeeded and confirmed stale generated CSP. No config reload/change performed.
- Managed release has no `.git`; provenance came from resolved release path, live bind-mounted repo HEAD, and byte-for-byte HTTP SHA-256 equality, not an invented Git status of the snapshot.
- Only artifact created by this subtask is this evidence markdown. No repository/runtime files, commits, services or deployments changed.
