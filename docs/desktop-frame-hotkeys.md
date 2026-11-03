# Desktop app-frame hotkeys

Reuse: EXTEND **Desktop frame shortcuts** (`watchFrame → onKey`, `web/desktop/desktop.js`). No second shortcut table, synthetic key dispatch, postMessage key protocol, nested-frame scan or native wrapper change.

## Failure mechanism

The shell listens on its own window in capture phase. Its same-origin app-frame adapter instead listened on the child **document** (`watchFrame`, old line 645). Keyboard events do not bubble between browsing contexts. An app/editor/modal's child-window capture handler calling `stopPropagation()` therefore prevents the document adapter from ever seeing either keydown or keyup. The app stays focused and shortcuts appear dead; clicking shell chrome returns focus to the working shell-window listener.

Listen on `doc.defaultView` in capture phase, using the original event and the existing `onKey(e, true)` ownership/typing/chord/repeat policy. `stopPropagation()` does not stop other listeners on the same event target. Retain one document-lifetime hook and add frame-window blur cleanup for held-key hints. Pointer focus and dictation binding remain document-local.

This is a reproduced propagation failure, not telemetry identifying which private app James was using. `stopImmediatePropagation()` remains an earlier-listener boundary. **Do not claim `preventDefault()` alone reserves a chord:** the exact original and candidate `onKey` do not check `defaultPrevented`; the source regression records that existing policy without changing it in this fixture-only follow-up. Opaque and nested documents deliberately do not gain a shell shortcut channel. Native `wizard:*` commands in `core/bridge.js` remain unchanged; source QA is not physical Mac/WebView proof.

## Exact-live source and tests

Base: `9e743932bfc0e5799a601d3623103af0e5a57950`, not main. On this revision **Alt+1 selects the first desktop**, Alt+2 the second, and Alt+Backquote selects Home (`core/workspace-navigation.js`). The older Home-on-Alt+1 QA script is obsolete on this live source; its unchanged first-slot failure is not repaired here.

Light checks:

```sh
node --check web/desktop/desktop.js
node --check qa-desktop-frame-hotkeys.cjs
node --test tests/DesktopFrameHotkeys.test.mjs tests/desktop-keys-layout.test.mjs tests/settings-preview-windows.test.mjs
QA_DESKTOP_SOURCE=<exact-base>/web/desktop/desktop.js node --test tests/DesktopFrameHotkeys.test.mjs
```

Candidate: 34/34 focused source tests pass. Original-code control: 3 pass / 4 fail, including the specific app-window capture regression, keyup cleanup and blur cleanup. These use a small propagation model, not a browser.

`qa-desktop-frame-hotkeys.cjs` is a separate real-browser synthetic A/B harness. Its first exact failure oracle is `REGRESSION: frame window capture cannot strand desktop switching`; the runner rejects a baseline failure anywhere else. It checks focused input desk switching, app picker chords, typing/select-all, repeated relative navigation without duplicate dispatch, keydown/up, blur, autorepeat, reload lifetime, nested opaque privacy, two in-shell skins with live redress and opaque-panel raster comparison, phone boot, and a labelled synthetic standalone dark fallback. Every request is intercepted; all writes receive 403. No private content or actual app is loaded.

## Browser fixture repair (no additional product change)

The first admitted A/B run failed the first Alt+2 assertion on **both** sources. Its candidate screenshot shows the synthetic input, desktop 1 selected, no visible Welcome, and no app picker. This image cannot establish the hidden controller state. The old harness returned `{}` for model options/setup and removed `#wosWelcome` rather than closing its controller. Executing the actual `aiConnected`/`boot` functions with those responses opens the disconnected AI step; the exported `active` getter retains the lexical element, so DOM removal does not deactivate it. The real `onKey` returns before shortcuts while `WosWelcome.active` is true. No historical controller telemetry was saved, so this is a demonstrated fixture defect and causal reproduction, not an observed historical controller dump.

Reuse `tools/qa-desktop-frame-fixture.cjs`: seed `wos.welcome.v1=done` via an init script that survives reload without resetting existing desks/skin; supply the actual `providers[].slug/authenticated/auth_type` model-options schema and `first_run:false` setup. Wait for the real `boot:true:done:false` decision and require inactive controller plus absent overlay. Never remove onboarding DOM or force-click through it.

Acceptance uses only exact served shortcuts: Alt+O picker, Alt+[ / Alt+] relative window/desktop stepping, Alt+R frame reload, and Alt+, Settings. Ctrl+Tab is not relative desktop navigation, and Ctrl/Meta+O belong to the OS, not the ordinary browser shell. Three populated desktops make duplicate stepping observable (0→1 versus 0→2, or previous 1→0 versus Home). Settings clicks switch Nebula/landscapes live while preserving frame text. A shell reload rechecks real owner boot and saved desks. Passive fixture-only adapter observers journal trusted key arrival, registration target/capture and callback counts together with Welcome, palette, focus and workspace state; a separate uninstrumented lane must also pass. No second dispatcher is installed.

`node --test tests/DesktopFrameHotkeysFixture.test.mjs` checks the original boot failure and corrected schema against actual owning source functions, shortcut contracts, reload-safe storage, observer identity and the unchanged browser oracle. These are browser-free fixture checks, not browser acceptance. Full source acceptance remains inherited only when original logs and the complete executable/web closure match by hash.

**Browser acceptance and screenshots remain pending until the parent admits the sealed forum job and inspects its output.** No deployment or main merge is authorized by this source-only result.
