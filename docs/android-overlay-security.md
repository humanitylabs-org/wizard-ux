# Overlay remote-page boundary (#323)

The native `OverlayPage` host loads `web/assist/{surface,everywhere,screen}.html`
from the selected `ServerSettings` HTTPS:443 origin, with an identical APK bundle
as recovery after 1.5 seconds. The lock-screen caller remains bundled-only.
Existing words, layout, and native capability bridges are unchanged.

## Security review and corrections

- **Redirect bypass:** Android invokes `shouldInterceptRequest` only for the
  initial resource URL, not the redirects it follows. Returning null for an
  allowed script URL therefore did not constrain its final host. OverlayPage
  now supplies every response itself; HTTPS certificate validation stays on,
  redirects/non-200 statuses fail closed, reads/connects are bounded, and
  WebView's own network loader is disabled. Owner cookies are copied only to
  this exact selected origin, never a redirected location.
- **Bridge exposure to frames:** `addJavascriptInterface` exposes a bridge to
  every frame, not merely same-origin documents. A network allowlist alone
  does not block `srcdoc`/`data:`/`about:blank` frames. A native-supplied CSP
  denies network/data frames, workers, objects, forms and connections for both
  remote and bundled responses; HTML subframe interception is denied too.
  Chromium may still instantiate a `srcdoc`/`about:blank` document: its inherited
  `script-src 'self'` denies injected inline/eval scripts, while external
  resources remain confined to trusted remote assets or packaged APK bytes.
  This is not origin-scoping the Java bridge. The remote allowlist is the
  explicit overlay file set, not the full authenticated shell directory.
- **Android-asset CSP gap (emulator-proven):** early instrumentation recovered
  to the bundle, then an injected srcdoc called the probe bridge once despite
  response-header and native-prefix attempts. Android does not invoke request
  interception for `file:///android_asset/` resources: neither policy reached
  that document. All three shipped HTML files now embed the same CSP before
  scripts, in both web and APK copies; parity/policy tests prevent drift.
  Remote HTML still receives native headers and a policy prefix, independently
  of its server version. Frame probes cover remote AND bundled copies with
  a top-level bridge positive control and standards-mode assertions.
  Packaged resources are trusted APK bytes; do not claim the interceptor
  restricts android_asset loads to a subdirectory.
- **False readiness:** `onPageFinished` is not script execution success. The
  actual W/E/S API (and shared Orb where used) must exist before native ready
  callbacks run or the timeout is cancelled. Missing/failed scripts and HTTP
  200 login pages recover to the bundle. Later static-resource failures can
  also trigger recovery after the initial ready callback.
- **Runtime selection:** the build-time origin is no longer used directly.
  Each load reads the persisted selected origin; an already-open remote page
  is replaced by the bundle when that selection changes. Detach cancels the
  load deadline and invalidates asynchronous completion callbacks.

- **Wizard-origin service worker (independent review, emulator-proven):** a
  service worker registered for the Wizard origin by any WebView of the app
  (the shell registers `web/sw.js` at `/wizard-os-home/`; hosted apps can hold
  wider-scope workers) controls documents of that origin in every WebView of
  the profile. Requests it answers never reach `shouldInterceptRequest`, so an
  overlay page loaded at `<origin>/wizard-os-home/assist/` could be replaced by
  worker-supplied markup with no native allowlist, redirect check or CSP
  prefix, and with the privileged bridges. On the emulator a worker registered
  by one WebView answered a second WebView whose client intercepted every
  request (run 39880324919, `sw-served`). Remote overlay documents now live
  on the reserved virtual origin `https://wizard-overlay.invalid`; OverlayPage
  maps each allowlisted path to the selected Wizard and fetches it natively.
  No worker can exist on that origin (CSP `worker-src 'none'`, nothing else
  serves it), and requests on the real Wizard origin are refused.
- **Reattach after origin switch (emulator-proven):** EverywhereService
  removes the orb window while Wizard OS is in front, which is exactly when
  Connect switches Wizards, and later re-adds the same WebView. The change
  listener was unregistered on detach, so the previous Wizard's privileged
  page survived. Attach now re-registers and rechecks the selected origin.
- **Slow-drip fetch:** per-read timeouts let a server send one byte a second
  and pin a WebView IO thread indefinitely. Each native fetch now has a
  3-second total deadline.

## Trust and compatibility

The selected Wizard is trusted to supply privileged top-level JavaScript;
this is NOT protection against a compromised Wizard or malicious web deploy.
The synchronous existing bridges are not a versioned generic API migration.
A future newly required overlay asset must be added to the native allowlist
and bundle in an APK update. An older APK fails closed to its bundled page
rather than fetching arbitrary new shell files. No remote script is cached
for offline execution. Page localStorage remains origin-specific.

The bundled response has the same frame-denying CSP as the remote response.
Network access is never required for the locked caller. No TLS bypass, QA
origin exception, or exported fixture activity is added to release builds.

## Test boundaries / unclosed gates

`OverlayPolicyTest` covers exact origins, ports, static paths and traversal.
`OverlayE2eTest` runs the actual bundled HTML/JS in an Android WebView, using
synthetic HTTPS responses at fixture.invalid. Cold emulator renderer/shader
startup exceeded the 1.5-second deadline and correctly recovered to the bundle
in initial runs, including after warming. Success/security fixtures therefore
inject a 10-second deadline through a package-private constructor; the timeout
fixture uses the production 1.5-second value. Every real host still uses the
public constructor with the unchanged 1.5-second deadline. Success fixtures
prove page behavior, not remote-success latency on hardware.
It covers all three APIs in
remote/bundled modes, native state updates, offline/timeout/script failure,
HTTP-200 login recovery, late failure, origin switching, frame isolation,
and native transport redirect rejection against a local HTTP fixture.
The loopback HTTP probe calls transport directly; release URL policy never
admits it. The debug-only empty Activity is not an overlay permission bypass.

These fixtures do **not** prove the native side-button/VoiceInteractionSession,
keyguard, floating WindowManager orb, accessibility-driven screen capture,
or airplane-mode behavior. Those exact host flows still need emulator/device
proof, followed by the physical Thales gate. Existing launch-smoke CI is not
substitute evidence. Keep #323 draft and do not merge or publish APKs.
