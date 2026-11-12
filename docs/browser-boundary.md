# Browser owner boundary (shell side)

Issue: humanitylabs-org/wizard-os#133. App Manager side and the box switch: wizard-app-manager `docs/browser-boundary.md`.
Agent Service side: wizard-agent-service `server/browser-boundary.mjs`.

Off unless the box ran `wam browser-boundary on` (it sets `WIZARD_BROWSER_BOUNDARY=1` and `WIZARD_SHELL_TOKEN_FILE`
for this container). Off: no token file, the page's `<meta name="wizard-shell-token" content="off">` stays as shipped,
`core/shell-token.js` wraps nothing, and nginx serves the pages exactly as before.

On:

- `packaging/entrypoint.sh` reads the token (64 lowercase hex) or refuses to start. nginx writes it into
  `index.html` / `desktop.html` only for a page navigation: `Sec-Fetch-Mode: navigate` with `Sec-Fetch-Dest:
  document` (top level), or `empty` (the same navigation passed on by the shell's service worker). A frame load
  (`iframe`), a `fetch`, a worker or the service worker's own warm-up read gets the empty placeholder. Scripts cannot
  set these headers. The answer is `Cache-Control: no-store`, so the service worker and the HTTP cache never keep
  it; a shell opened from the offline copy has no token (its owner calls then fail until the next online load).
  A shell page that ends up in a frame anyway never arms the wrapper (`window.top !== window`).
- Offline copy: the token never reaches the offline copy of the shell or of a pinned app (`app-session.html`), so
  each device remembers the box's answer instead (`localStorage` `wos.browser-boundary.v1`, never the token).
  `shell-token.js` sets it on a page with a valid token and clears it only when the page says `off`, the value the
  pages ship with and that nginx leaves alone while the switch is off; an empty value (a frame, a warm-up read, the
  offline copy on a box that is on) leaves it as it is. `core/browser-boundary.js` turns the frame sandbox on with
  the token or with that mark, so an offline shell or pinned app still sandboxes app frames (its owner calls then
  fail until the next online load).
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
- Desktop keys and clicks: the app side sends a click (the shell focuses that window), its window losing focus (the
  keys guide hides), Esc, bare ⌥ (the keys guide) and the ⌥ codes the shell names with `WizBrowserBoundary.keys()`,
  never plain typing, with one flag for "a text field has focus" (never which field or its text). Exactly those keys
  are held back from the app page, as the shell's own key handler did before; every other ⌥ chord stays the app's
  alone. `desktop/desktop.js` turns them into its usual `onKey` / keys-guide calls. The shell cannot tell a real key
  from one the app made up, so the desktop names only keys that move around the owner's own windows (⌥1…9, ⌥`,
  ⌥[ ], ⌥⇧← →, ⌥F, ⌥T, ⌥− =, ⌥/); keys that speak, send, open or act on a chat, search or pick buttons work again
  after a click outside the app. The shell takes input only from the focused, visible frame, and a click or a named
  ⌥ key also needs the browser's transient user activation, so a page that only posts messages cannot press them.
  Proof: `tests/qa-browser-boundary-keys.cjs`.
- Other app frames: the pinned single-app session (`core/single-app-session.js`, an app added to the phone's Home
  screen) gets the same sandbox and the same channel through `WizAppServices.attach`; it never reads the frame, so
  its route is not saved across a restart while the boundary is on. Every page opened in the link sheet
  (`core/links.js`) is sandboxed too and is treated like any other-site page: the sheet keeps its own Back stack but
  no longer follows the page's own link clicks or title. Hidden voice-command frames (`core/app-services.js`) are not
  loaded at all, so apps' voice commands are off while the boundary is on. Proof: `tests/qa-browser-boundary-other-frames.cjs`
  (real Chromium) and `tests/browser-boundary-other-frames.test.mjs`.
- The shell's own pages in an app window (Store, Agents, Setup: `/wizard-os-home/` or `/wizard-ux/` +
  `store|agents|setup/`) are shell code, not apps. `WizBrowserBoundary.frameAttributes(url)` gives them no sandbox,
  so they stay same-origin, and each loads `core/shell-token.js` first: in a frame it asks the top-level shell
  (`WizShellBoundary.armFrame(window)`) to wrap that page's `fetch`/`XMLHttpRequest` the same way, so their owner
  calls carry the token without the token ever being written into the page. `armFrame` arms only a same-origin frame
  under this top-level shell whose path is one of those pages; a sandboxed app frame cannot reach it, and any
  same-origin frame could already call the shell's own `fetch`, so it opens nothing new. Backstop: if such a window
  ever lands on another same-origin page (none of these pages navigates its frame today), it is reloaded sandboxed
  and attached like any app frame. Proof: `tests/qa-browser-boundary-shell-frames.cjs` (real Store, Agents and
  Setup pages in Chromium) and the unit tests in `tests/shell-token.test.mjs` / `tests/browser-boundary-frames.test.mjs`.
  Opened as a top-level tab (not in a Wizard window), Store, Agents and Setup are a real page load like the shell page:
  each ships the same `off` meta, nginx writes the token into it, and `shell-token.js` arms that page itself. A pinned
  single app never shows them (`WizHomeScreenPolicy.isShell` refuses shell pages), so there is nothing to arm there.
- Welcome (`core/welcome.js`): the AI provider's sign-in page and the Importer are app pages, so they load sandboxed
  and attached; Esc inside them comes back over the channel and steps the Welcome back. Settings › Connections is the
  App Manager's own view (`store-install/_connections/`, wizard-app-manager `connections_view.py`), owner code like
  Store: it stays same-origin, loads `core/shell-token.js` first and is armed the same way (its static files load
  without the token; its `api/` calls carry it). Proof: `tests/qa-browser-boundary-welcome-settings.cjs`.
- Troubleshooter window (`core/reach.js`): the repair page shows repair chat output, so it loads sandboxed and
  attached like any app page. The shell no longer reads it to prove it loaded: the page's `ready` on the boundary
  channel is the proof (`WizBrowserBoundary.ready(frame)` and the `wizard:boundary-ready` event on the frame; an error
  page never answers). No answer within 8 s keeps local help open and offers the direct line, as before. Proof:
  `tests/qa-browser-boundary-troubleshooter.cjs` and `tests/troubleshooter-boundary.test.mjs`.
- Badge and title bar: a sandboxed app sets its own unread count (`WizardApp.badge.set`) and its own window-bar tools
  (`WizardApp.titlebar.set`) over the channel. `core/app-services.js` is the one server (`WizBrowserBoundary.serve`);
  it gets only the frame element and accepts it when the element is still the registered app window, its `src` is
  inside that installed app's path, the document in it is one the shell loaded (a page that navigated its own frame,
  e.g. a link to another app, is refused until the shell loads the window again, since `src` keeps the old URL) and
  the frame answered `ready` on its current channel. Relative title-bar links resolve against the page's own address
  (sent by its client) and must still stay inside the app. The app id is the window's,
  never the page's word; tools are the same validated data as before. A tap goes back as `tool` on the current
  channel (`WizBrowserBoundary.tool`). Every load clears that window's tools (`onReset`), and the app's client sends its
  last badge and bar again on the new channel. Proof: `tests/qa-browser-boundary-services.cjs` (real Chromium) and
  `tests/browser-boundary-services.test.mjs`.
- Share out and transcription: a sandboxed app's `WizardApp.share.text`, `WizardApp.share.file` and
  `WizardApp.voice.transcribe` go over the channel to the same server, with the same window checks. Sharing out also
  needs the browser's transient user activation (a real tap or key in that app window) and a visible window, and it
  always opens the shell's own share sheet (never `direct`), so the owner picks where it goes; the app gets only the
  outcome (`shared`, `copied`, `cancelled`, `unsupported`). Only `text`, `title` and `url` cross; a relative link
  resolves against the page's own address inside the app. Transcription uses the box's one transcriber within a
  per-app budget (2 at once, 30 files or 150 MB in any 10 minutes); the app gets only `{ text }` or `{ unavailable }`.
  An answer is never sent to a newer document in that window (it is dropped when the channel changed), and a window
  has at most 4 of these open at once. Proof: `tests/qa-browser-boundary-share-transcribe.cjs` (real Chromium).
- Share to Wizard and update holds: `WizardApp.share.wizard` needs the same tap in that focused, visible window and
  opens the shell's own Send to <agent> sheet (`WizShareWizard`), where the owner reads it and sends or cancels. Only
  `files`, `text` and `title` cross; the sheet sends only while the same document is still the verified app in that
  window (`WizBrowserBoundary.gen(frame)`), and a shell update waits while it is open. `WizardApp.update.hold` makes a
  shell update wait for the app's unsaved work (`update.hold` / `update.release`, at most 64 per window). Holds belong
  to the document now in the window: every new channel drops them in the shell, and the app's client places its
  holds again on its next channel (the app's own hold id stays the same). No keep callback crosses the boundary, so
  such a hold is never skipped. Proof: `tests/qa-browser-boundary-share-wizard-holds.cjs` (real Chromium).
- Browser proof: `tests/qa-browser-boundary-frames.cjs` (real Chromium: opaque origin, `parent.document` and shell
  storage blocked, owner call tokenless with `Origin: null`, Back and theme by postMessage). Unit tests:
  `tests/browser-boundary-frames.test.mjs`.

Not covered yet (next slices, all on #133), so nobody should turn the box switch on yet:
- Dictation into rich-text (contenteditable) fields of a sandboxed app (text inputs and text areas work), and the
  app services receiving shares, capture, orb, vault, identity, the update-available notice and voice commands are
  closed under the boundary (only `ready`, `badge.set`, `titlebar.set`, `share.text`, `share.file`, `share.wizard`,
  `voice.transcribe`, `update.hold` and `update.release` are answered).
- Desktop: a layout's ⌥ keys that press an app's own marked controls (`data-wz-key`), the layouts' own ⌥ keys
  (⌥H, ⌥K, ⌥\, Orbs hold-⌥ letters) and the app kit's live skin layer while a sandboxed app has the keyboard; the phone shell has no key forwarding (it has no desktop keys).
  Pages in the link sheet lose their own storage and pop-ups.
- Most apps still need their own storage and backend calls to work from an opaque origin (wizard-os#385). The
  Troubleshooter's own `/troubleshoot/api/` calls already work (wizard-troubleshooter#44: a per-box page key), once
  boxes run that Troubleshooter version.
- `<img>`/`<video>`/download loads of attachments and saved files carry no header; the Agent Service lets exactly
  those browser-marked loads through without the token (wizard-agent-service#479).
- Native bridges (Android/Mac) still reach every frame (wizard-os#387).
