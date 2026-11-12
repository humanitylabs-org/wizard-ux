# Browser owner boundary (shell side)

Issue: humanitylabs-org/wizard-os#133. App Manager side and the box switch: wizard-app-manager `docs/browser-boundary.md`.
Agent Service side: wizard-agent-service `server/browser-boundary.mjs`.

Off unless the box ran `wam browser-boundary on` (it sets `WIZARD_BROWSER_BOUNDARY=1` and `WIZARD_SHELL_TOKEN_FILE`
for this container). Off: no token file, the page's `<meta name="wizard-shell-token" content="">` stays empty,
`core/shell-token.js` wraps nothing, and nginx serves the pages exactly as before.

On:

- `packaging/entrypoint.sh` reads the token (64 lowercase hex) or refuses to start. nginx writes it into
  `index.html` / `desktop.html` only for a page navigation: `Sec-Fetch-Mode: navigate` with `Sec-Fetch-Dest:
  document` (top level), or `empty` (the same navigation passed on by the shell's service worker). A frame load
  (`iframe`), a `fetch`, a worker or the service worker's own warm-up read gets the empty placeholder. Scripts cannot
  set these headers. The answer is `Cache-Control: no-store`, so the service worker and the HTTP cache never keep
  it; a shell opened from the offline copy has no token (its owner calls then fail until the next online load).
  A shell page that ends up in a frame anyway never arms the wrapper (`window.top !== window`).
- `core/shell-token.js` is the first script on both pages. It takes the token out of the page, keeps it in a closure,
  and adds `X-Wizard-Shell-Token` to `fetch` and `XMLHttpRequest` calls from the top-level shell to owner routes on
  this origin: `/wizard/`, `/api/`, `/v1/`, `<prefix>api/` and `<prefix>store-install/`. App paths (`/notes/`, …)
  and other origins never get it, so no app backend learns it.

## Sandboxed app frames (on only with the box switch)

- `core/browser-boundary.js` loads right after `shell-token.js` and turns on only when that script armed
  (`window.WizShellBoundary`). Then phone and desktop app windows (`iframe.appframe` in `app.js`, the app iframe in
  `desktop/desktop.js`) get `sandbox="allow-scripts allow-forms allow-downloads"`, never `allow-same-origin`: the app
  page has an opaque origin (`self.origin === 'null'`), cannot read the shell's DOM, storage or globals, and its own
  calls to owner routes go out with `Origin: null` and no token.
- The shell never reads an app document. `WizAppServices.attach()` gives every sandboxed app frame a channel
  (`WizBrowserBoundary.attach`): a fresh random channel per load, `hello` from the shell, `ready` from the app.
  Messages are admitted only from that frame's own `contentWindow` on the current channel; origin `null` is never an
  identity.
- App side: `core/app-client.js` loads `core/browser-boundary-client.js` when its document is opaque and framed, and
  hands it `WizardApp`'s own Back and theme functions. No app change is needed.
- Back: `WizAppServices.back(frame, onRoot)` asks the app (`back`), returns `pending`, and runs `onRoot` (the shell's
  own next Back step) only when the app answers `atRoot`. No answer within 1.2 s stays put. An app without the client
  is `notReady`, so the shell's own steps still run. Back never leaves Wizard.
- Appearance: `appearance-host.js` pushes the Appearance v1 context with `WizBrowserBoundary.theme()`; the window is
  marked `.wz-themed` only after the app acknowledged that revision, and the last context is sent again on reload.
- Field insertion: `WizBrowserBoundary.pinField(frame)` seals the focused text field of the focused app frame;
  `insert(text)` puts text there once, and only if nobody typed in it meanwhile.
- Browser proof: `tests/qa-browser-boundary-frames.cjs` (real Chromium: opaque origin, `parent.document` and shell
  storage blocked, owner call tokenless with `Origin: null`, Back and theme by postMessage). Unit tests:
  `tests/browser-boundary-frames.test.mjs`.

Not covered yet (next slices, all on #133), so nobody should turn the box switch on yet:
- Dictation into a field of a sandboxed app is not wired to `pinField` yet (the orb sees no focused field in a sandboxed app), and the
  app services `share.*`, `voice.transcribe`, titlebar, badge and capture are closed under the boundary (only
  `ready` is answered).
- Desktop: Esc and ⌥ keys typed inside a sandboxed app, click-to-focus and the app kit's live skin layer need
  postMessage too. Other frames (link sheet, Welcome, Settings embeds, single-app session) are not sandboxed yet.
- Most apps still need their own storage and backend calls to work from an opaque origin (wizard-os#385).
- Shell pages that run inside a frame (Store, Agents, Setup) send no token; `<img>`/`<video>` loads of
  `/wizard/attachments/…` cannot carry a header.
- Native bridges (Android/Mac) still reach every frame (wizard-os#387).
