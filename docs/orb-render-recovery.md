# Recurring white/cyan floating orb: bounded renderer repair

## Evidence boundary

The screenshot shows a nearly white disc, cyan halo and tiny cyan centre, not the normal galaxy. It contains no GL error or renderer state. **The exact field trigger is not proven**: forced context loss is a lifecycle negative control, not a claim to reproduce that colour pattern. No phone GPU trace was captured. Do not call this a verified Samsung/WebView driver fix.

The published Wizard OS 0.10.18 (82) APK has SHA-256 `5e8be00bd7161e07786e7d716698d4c12cc8450f12c8ab7f3906a97009d3161d`, matching its update feed. All eight packaged `assets/assist/` files match commit `7da6c821c63c48d7156abd9edec86e440fa8f883` byte-for-byte. Its `orb.js` SHA-256 is `61d75b6316f00dec47b8cdb1e19766f68728ed8010cb475e9f42e365fb9c5e90`. This proves assist-asset provenance, not a full reproducible APK build.

`EverywhereService.attach()` creates a hardware-layer transparent WebView, blocks network loads, admits only `file:///android_asset/assist/`, and loads `everywhere.html`. That bundled page sets radius `.64`, freezes idle, and calls the shared `Orb` API. The floating orb therefore **does not obtain a repair from a hosted web-only deployment**. A signed update through the existing in-app feed is needed. Live-source baseline: `2d4a928e61beaee8a4589f59f1beca74aedf86a2`.

## Confirmed source faults

1. The published and current fragment shaders use four reversed-edge `smoothstep` calls, including the entire sphere's alpha edge. [Khronos](https://registry.khronos.org/OpenGL-Refpages/es3.0/html/smoothstep.xhtml) explicitly defines `edge0 >= edge1` results as undefined in GLSL ES 1.00 too. A successful shader compile does not make these expressions portable. The repair expresses the same intended descending Hermite ramps as `1 - smoothstep(low, high, x)`, preserving stars, rim, highlight and edge widths. This removes actual undefined shader behaviour; it does not establish which result the field driver produced.
2. Context loss nulls the GL handle and shows the existing PNG but has no restoration listener. A restored context cannot recreate the old program, buffer or uniform locations; the renderer remains on fallback until page recreation. `Orb.webgl` also remains the stale startup value. The focused old-code tests reproduce both defects.
3. A failed shader initialization leaves a partial program eligible for drawing. Failure now clears invalid GL state and stops scheduling, retaining the existing fallback. Unit injection proves no draw is attempted after initialization failure.

## Reuse and scope

- **EXTEND** `Orb.create`'s existing shader and lifecycle; mirror its Android asset byte-for-byte. No parallel renderer.
- **REUSE** the current PNG fallbacks, modes, voice controls, skin/app-icon core and shine policy, radius, scheduling and sleep API.
- **NEW** only focused tests and a synthetic acceptance runner, not product UI or infrastructure.
- Restore recreates GPU objects and wakes a frozen orb while retaining mode, level and host sleep. Failed restore stays on fallback without a redraw loop.
- No native Java, input gestures, recording/routing, colours, layout, icons or version/feed fields changed. Do not add an unproven time wrap or amplitude workaround.

## Focused verification

Local: `node --test tests/orb-render-recovery.test.mjs tests/orb-icon-core.test.mjs tests/owner-skins-guard.test.mjs` passes 18/18. An additional unchanged orb-routing regression file brought the focused run to 30/30. Before repair, the new test file passed 1/6 and failed the exact reversed-ramp, stale-status, absent-restoration and invalid-program checks.

The staged forum runner `tools/run-orb-render-recovery.py` first verifies complete immutable candidate/baseline export inventories, modes and pinned browser dependencies. It runs the same unit negative control against both published APK assets and live source. `tools/qa-orb-render-recovery.cjs` loads the **actual bundled** Everywhere page at 64/76px using a synthetic local-only origin. It freezes only shader time, measures noncollapsed galaxy pixels in eight modes, compares the intended appearance to live source, forces two GL loss/restore cycles per variant and requires the exact old permanent-fallback failure. Candidate additionally must recover, honor host sleep and refreeze idle. Expected browser total: 62 case records. Screenshots and receipt are written only by an admitted run.

This browser job is prepared, **not executed or accepted**, at initial PR creation. It proves Chromium/SwiftShader lifecycle and visual invariants, not the Samsung driver's original failure or native physical capture. The parent must admit the exact staged spec, inspect the before/after screenshots and receipt, then own merge/live-source parity and signed native-update delivery. No separate APK should be sent as the fix.
