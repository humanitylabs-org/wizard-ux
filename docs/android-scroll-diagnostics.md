# Android scroll-capture flight recorder — 0.9.38 / 62

This release is a diagnostic experiment, **not a verified Samsung fix**. The two earlier AOSP-only successes did not establish One UI Smart Capture compatibility. Physical S25 Ultra and TalkBack acceptance remain outstanding.

## Captured (session memory only)

- 400 newest events, ordered sequence + uptime milliseconds + thread name. Serialized upload is additionally capped at 240 KiB UTF-8.
- Native View scroll capability, range/offset/extent, scrollBy/scrollTo/overScrollBy; method inputs and returned metrics. These hot calls and gesture summaries are enabled only for 60 seconds after focus loss, Activity pause, a capture callback or an accessibility action; each trigger extends the window.
- AOSP search/start/image/end callbacks, requested capture rectangle, accepted search bounds and rejection reasons.
- Host accessibility provider/node creation, scrollability/action bitmask/child count; Chromium virtual node creation, actions, focus and text-search **count only**. Text-search strings, node text/descriptions and raw Bundles are never recorded. Numeric/boolean accessibility arguments are allowlisted; other arguments contribute only a count.
- Touch DOWN and completed UP/CANCEL summaries, MOVE counts, source/tool/flags/device ID, start/end Y only. Generic motion is summarized per event. Device ID zero is reported as zero, **not proof that an event was injected**.
- Activity pause/resume/window focus/top-resumed/configuration geometry; origin-checked JS proxy geometry + fixed candidate-rejection constants. No DOM identities/tokens, chat text, thread URLs or screenshots.
- Once per process session: random recording ID, device manufacturer/model/SDK, One UI system property if readable, WebView package/version, enabled accessibility service component names and app version.
- Up to 12 framework/Samsung caller frames only when the calling stack contains ViewRootImpl, AccessibilityInteractionController, framework ScrollCapture or Samsung, or originates on a Binder thread. Application stack paths and source locations are omitted.

## Delivery and server

Resume (including focus-only return from an OEM overlay) schedules a background same-origin POST to `/wizard-os-home/api/diagnostics/scroll-capture`. Release builds use only the configured private `BuildConfig.ORIGIN` via AppState; QA builds may use their existing loopback fake. Redirects are disabled. WebView cookies are reused; no embedded credentials. A failed request retains the in-memory ring for retry on a subsequent resume/focus return. No diagnostic data is persisted on the phone.

`server.py` owns the append-only route; `scroll_diagnostics.py` validates its schema, accepts at most 256 KiB and keeps at most 50 files, with a lock, exclusive filenames, fsync and 0600 files in a 0700 directory. Default storage is `$HERMES_HOME/data/apps/wizard-os-diagnostics/scroll-capture` (or `~/.hermes/...`); `WIZARD_SCROLL_DIAGNOSTICS_DIR` may override it. GET/list/download are not supported.

For this development install, the exact route is forwarded by the existing private gateway to a loopback instance of this shell server. It uses the same owner `forward_auth /verify?` policy and identity-header stripping as `/wizard-os-home/*`, and server-side `WIZARD_ORIGIN` same-origin POST validation. Only this exact diagnostics route is added; the running modular shell and Agent Service are unchanged. No core Hermes modifications.

## Accessibility experiment

Keep all superclass/provider delegation. On the host node only, add scrollable and forward/backward actions when the proxy is eligible. A host scroll action moves the confirmed inner chat scroller by one native extent minus overlap. Virtual descendants, source IDs, focus, text, children and other actions are returned/delegated unchanged. Chromium provider wrappers observe counts and flags only. Never call both Chromium document scrolling and the inner proxy for one host action.

## QA and release gate

- Pure-Java `ScrollDiagnosticsRingTest`: newest-400 order, JSON structure/escaping, UTF-8 size cap without mutating the ring.
- Lightweight `tools/test_scroll_diagnostics.py`: private permissions, retention, content-field rejection, HTTP same-origin/size/type gates, exact-byte readback and no read endpoint.
- `ScrollProxyE2eTest`: arm recorder; assert native capability/scroll events; activate real accessibility service through UiAutomation; preserve Chromium host children/class/focus while adding host actions; exercise accessible scrolling; pause/resume and await upload acknowledgement.
- `tools/qa_scroll_proxy.py`: fake private-origin server persists upload and reads exact bytes back, asserts recorded methods and content exclusion, retains Back x3/no-crash gates.
- `tools/qa_scroll_release.py`: pinned previous 0.9.37 APK SHA, signed upgrade to 0.9.38/62, release + QA Gradle/JUnit/lint, diagnostics JUnit required in both builds, AOSP 28/28 pixel capture gates and native proxy/upload/Back gates. Prepared jobs only; no feed publication or merge.

Live server verification: authenticated gateway POST returned **201**, and its named 0600 file was read back byte-for-byte. GET returned **405**, foreign-Origin POST **403**, unauthenticated loopback access **403**, and the existing shell still returned **200**. A real Thales request through normal Tailnet ingress also returned **405** on the append-only route. The loopback `--resolve` proof uses curl's PROXY client-IP option with this server's own verified Tailnet address because the gateway requires a Tailnet principal; it does not weaken the identity gate.

Local verification: browser scroll contracts 38/38; Node suite 513/513; diagnostics HTTP tests 3/3; QA path tests 3/3. Android builds, JVM/Gradle tests and emulator tests must run on Thales; prepared jobs are not execution evidence.
