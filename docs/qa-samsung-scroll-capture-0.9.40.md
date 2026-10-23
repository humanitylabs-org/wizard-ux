# Samsung scroll capture 0.9.40 / 65 — QA contract

The visible-band capture design replaces the scroll-proxy experiment. Samsung acceptance still requires the owner's physical One UI device; neither Chromium nor an AOSP emulator is a Samsung emulator.

## Local evidence

- `npm test`: 513/513.
- `tools/qa-scroll-capture.cjs`: 40/40, helper-off and helper-on at Samsung-like DPR 2.625, no page errors. All existing non-proxy cases remain.
- `test_qa_paths.py`: 3/3; `test_scroll_diagnostics.py`: 5/5.
- Python compilation: all 45 top-level `tools/*.py` plus `scroll_diagnostics.py`.
- Lightweight Java syntax parsing: helper, WebView and instrumentation test. This is not a Gradle compilation.
- API35 SDK inspection on Thales confirms the public `ScrollCaptureSession` constructor and the five-argument `ImageReader.newInstance` used by instrumentation.
- Independent Opus source review: repairs re-reviewed, final PASS WITH NITS. No claim of native execution.

## Contracts added or replaced

The browser contract rejects retired proxy commands and requires no port messages across refresh, navigation, mutations and captures. Real-shell fixtures exercise overlapping full-width header/composer chrome, padding at both scroll limits with original message spacing, exact priority/scroll restoration, an unregistered 56px floating button, full occlusion with sanitized blocker labels, hidden-document moves without animation frames, pagehide, same-height versus height-changing mutations, resized ports, and fresh diagnostics after geometry rejection.

The AOSP SystemUI suite retains its three original long screenshots and adds an overlapping-header/composer capture, including decoded first and last fixture row markers. Its expected receipt is `status: ok` plus 38 `checks[]` entries with `ok: true` (previously 28). **This new emulator case is staged, not executed locally.**

The native gate keeps its filename/test class for runner compatibility but now compares SelectionWebView against a real stock WebView, with standards-mode HTML. Inner DOM scrollability must not spoof the native View; native root scrollBy/scrollTo must remain stock. The test also requests an unpaused control tile and two paused PixelCopy tiles into an ImageReader, requiring real nonempty buffers and different valid-pixel checksums. Numbered fixture rows make the content nonperiodic. Resume uploads must reach the origin-pinned fake server, survive exact-byte persistence, remain bounded/content-free, contain the real native search/start events, and show proxy=false. FLAG_SECURE, non-overflow, untrusted origin, native Back three times, and no crashes remain gates.

The release chain pins 0.9.40/65, the established signing certificate, and the published 0.9.39 upgrade APK SHA256 `3500b8c3b0a3dd2b2eed02082f22b5e3ee86dff8781449511e1e47a52ec4e9c2`. It retains the referenced ScrollProxyMetrics class/tests even though the View proxy is disabled.

## Defects fixed while exercising the design

- Sample midpoint band edges could include up to four pixels of wide chrome. Bounds now stay within sampled-clear rows.
- Capture validation did not notice a changed scrollport height when scrollHeight stayed constant.
- Retired proxyScroll could still run candidate/token logic; it now explicitly returns false without a port.
- Geometry rejection could retain previous hit-test diagnostics; each discovery clears them.
- Native WebView.onPause still cancelled capture despite the JS visibility fix. Pause alone no longer cancels; pagehide, detach, explicit cancellation, geometry failure and watchdog still restore.
- New native diagnostic fields were not admitted by the receiver, rejecting the entire upload. Search detail is now structured (not truncated JSON text), with bounded allowlisted geometry/labels and validated start-result fields. **Deploy the compatible receiver alongside/before this APK when rollout is approved.** This work does not deploy it.

## Remote boundary

Both release and debug/instrumentation jobs must be prepared from the same final pushed revision. Signing, Gradle, emulators and SystemUI/native acceptance run only through the Thales durable worker. Preparation is not submission or a passing release receipt. No feed publication, merge or phone installation is part of this task.
