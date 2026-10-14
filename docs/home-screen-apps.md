# Mobile home-screen apps candidate

## Shape

The normal Wizard launcher and workspace remain on `MainActivity` (`singleTask`). Installed frontend app tiles/rows in mobile Apps gain a 450 ms hold; moving >8 px, scrolling, a second pointer, cancellation or an early lift prevents the action. The opening lift cannot activate the action under the finger. The existing sigil and a single small Add to home screen action are reused; no launcher/window restyle. Ordinary taps retain existing `launch()` placement.

The bounded product direction was obtained **before** UX edits from first-party Claude Fable with tools empty; transcript at `/home/telos/context/sources/projects/wizard-os/claude-transcripts/20261014-home-screen-interaction-response.json` (`claude-fable-5-1`, success, no permission denials).

`wizardHomeScreenPort` is an exact-primary-origin WebView message listener. It rejects subframes, non-shell paths, pinned-session callers, malformed IDs/request IDs, oversized messages/icons, and pin requests without a recent native touch and current main-document user activation. Its only operations are status and pin. The payload never includes a launch URL. A stable shortcut ID is SHA-256(box primary origin + newline + app ID). Status reads `ShortcutManager.getPinnedShortcuts`; dispatch acceptance is only pending. The OS-confirmation receiver checks an opaque request token and the actual pinned state. Resume checks pinned status before showing success; canceled OS sheets close silently. Unsupported launchers/browsers say they cannot add on this device.

`AppSessionActivity` uses `documentLaunchMode=intoExisting` with a canonical component/data URI per box/app. It inherits the existing native WebView, sharing, capture and safe-inset/Reach behavior. Re-taps receive `onNewIntent` without resetting the WebView. Recents label/icon comes from the pinned shortcut and its original sigil PNG. Hardware Back is always consumed, including while loading; off-session main-frame navigation cannot reveal the workspace. Renderer recovery restarts the same app-session URL.

The same web entry selects a dedicated single-app session **before first paint**. `app.js` exits before workspace initialization. The session resolves the current registered frontend URL via the existing app registry and mounts exactly one iframe, never a duplicate frontend or nested Wizard shell. Removed/invalid/out-of-route apps show an unavailable view. The session has no desks, dock, orb, launcher, resize/pinch or bottom-edge escape bindings. Shared App Services and Appearance remain attached. SDK Back handles app overlays/routes, with a bounded in-app history fallback; repeated root Back consumes forever.

Durable state uses `wos.single.v1:[origin,appId]`, a distinct frame/window identity, and localStorage for hosted reading checkpoints. Ordinary window reading retains sessionStorage. Current registered-route boundaries gate restored URLs; a route change discards stale incompatible checkpoints. Wisdom also keeps paginated **screen position** in `wisdom:*:pos:*`; the native document-start hook scopes only those presentation keys to the app session. Size/theme, highlights, content/read state and all other app keys remain shared. No normal workspace keys are copied into session state. Recreated frontend history retains domain state with a fresh SDK mark and zero prior depth, allowing app-level parent/root fallback rather than an invalid traversal into the shell.

Sessions do not take ownership of Wizard's global voice/recorder/updater callbacks. Foreground presence is an identity-owner set, so one task stopping cannot make another visible task appear backgrounded.

## Candidate release boundaries

- Default production package/version/origin remain `ai.wizards.os`, `0.9.12` / 36, `https://wizard.tailc0f369.ts.net`.
- Preview: `ai.wizards.os.preview`, code 1001, `0.9.12-homescreen.1-preview`; compiled ordinary-launch home/origin `https://home-screen-apps.staging.wizard001.com/wizard-os-home/`.
- Preview updater does not read/install the production feed; preview cannot fall back to the production legacy origin.
- Music production37 and Shared Services38 remain outside this branch; no merge, live service/feed write, publication or physical-phone install.

## Tests and verification gates

Lightweight source/unit checks: `node --test tests/*.test.mjs`, `git diff --check`, manifest XML parse. `tests/home-screen-apps.test.mjs` exercises identity/route boundaries, no workspace boot/global shell preference mutation, durable presentation isolation, movement/cancellation/release guards, pending-vs-confirmed pin UI and root/overlay/in-app Back. These use explicit VM/DOM/port fixtures; **they are not real Android, real browser gesture, launcher or signing proof**.

Native rules: `HomeScreenPolicyTest` under the normal JUnit runner. Gradle test/lint/build/signing **only** through `android-build-thales --wait-for-lock --java 17 --gradle-dir android`, expected signer `3bf74d0b597bc170761079909d3692428702ba057f753ee1ffd62da3c76ed1fd`, Thales private signing env `/Users/thales/.hermes/secure/wizard-os/signing.env`. Signed preview tasks `:app:testPreviewUnitTest :app:lintPreview :app:assemblePreview`; debug signing is a separate job.

`qa-home-screen-apps.cjs` is a Thales-only focused browser suite against real staging GET data (optional exact candidate/baseline **shell-only** overlay, no app fixtures). All non-GET/HEAD requests are aborted and recorded, never accepted as fabricated write successes. It records session/fullscreen/root/nested Back, registered routes, shell-refresh route restore, original workspace isolation, trusted hold/release/unsupported-OS behavior, screenshots and errors. Run candidate and daily negative control, then affected `qa-immersive.cjs`, `qa-launcher-still.cjs`, `qa-hosted-back.cjs`, `qa-app-reading-position.cjs` regressions under the shared Thales lease.

Actual API35 emulator acceptance remains separate: exact signed-preview ordinary launcher to durable staging/real Wisdom and Signal, OS pin confirmation/icons, three independent Recents tasks/re-taps/Home switching, nested/root Back, force-stop/process recreation/frame refresh/position, camera/IME, removed-app/recovery and source/artifact identity. Debug WebView inspection can aid diagnosis but cannot substitute for the signed-preview launch check.

## Known verification limits / checkpoint

See `CHECKPOINT.md` and the external evidence directory for actual execution. The Thales filesystem route was blocked on existing lock open, new-file open, and a reversible rename attempt; the attempt was canceled and the original inode read back unchanged. No sibling workload was killed or lock bypassed. Until remote compile, lint, real browser and API35 checks complete, this is a **source candidate, not a verified signed Preview**. A document-start WebView capability is required for early Wisdom paginated-position isolation; browsers without that hook are not used as proof of Android position isolation. Legacy-origin production fallback behavior also needs a dedicated device regression before later production promotion.
