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
  `insert(text)` puts text there once, and only if nobody typed in it meanwhile. A rich-text (contenteditable) region
  counts too, by the same rule as a same-origin app (`core/focused-field.js`): the app seals the region's root and its
  caret, and the words go in through the browser's own editing (one input event), never if the region changed. Proof:
  `tests/qa-browser-boundary-rich-text.cjs`.
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
  and attached; Esc inside them comes back over the channel and steps the Welcome back. Each is attached as its
  installed app's window (`WizAppServices.attach` with that app's id and path, and its saved settings in the frame's
  name), so its calls to its own backend, saved settings and IndexedDB go through the shell as in any app window and
  signing in finishes; leaving the step or closing the Welcome lets the window go. Proof:
  `tests/qa-browser-boundary-welcome-signin.cjs`. Settings › Connections is the
  App Manager's own view (`store-install/_connections/`, wizard-app-manager `connections_view.py`), owner code like
  Store: it stays same-origin, loads `core/shell-token.js` first and is armed the same way (its static files load
  without the token; its `api/` calls carry it). Proof: `tests/qa-browser-boundary-welcome-settings.cjs`.
- Own screens (`core/own-views.js`): the owner's own version of an app, served by the Agent Service at
  `/wizard/views/<id>/`, is an app page like any other, so it loads sandboxed and attached as that app's window. The
  shell can't read its document any more, so the Service's answer for the page (checked with the shell's own fetch)
  and the boot script's ready message (from origin `null`, admitted only from that sandboxed window) prove it loaded;
  an error message from it still falls back to the original screen. With the boundary on the Service lets its files
  load without the token (`Origin: null` files get `Access-Control-Allow-Origin: *`; the page never), and gives the
  app list's `view.api`: the original app's API folder. The screen's relative `api/…` calls go there through the
  shell (`net.fetch`), only when that folder lies inside the original app's path and off every owner route, never to
  `/wizard/`. Proof: `tests/qa-browser-boundary-own-views.cjs` and wizard-agent-service `tests/app-views.test.ts`.
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
- Shell notices: a shell update that is ready (`WizardApp.update.onAvailable`) and the fresh-data asks
  (`WizardApp.view.onRefresh`: back in view, to the front, a minute in view, an agent tool for this app) reach a
  sandboxed app as `notice` on its channel (`WizBrowserBoundary.notice`), with the same window checks as the badge.
  Only the update's version string and the ask's reason cross. A document that answers on a new channel hears a
  pending update again. Proof: `tests/qa-browser-boundary-notices.cjs` (real Chromium).
- Receiving shares (docs/SHARE-SHEET.md): `WizardApp.share.receive` registers the app with the shell's share sheet
  (`share.receive`, `share.targets`), always under its window's installed app id, never one the page names. A tap on
  the app or one of its people in the shell's sheet hands it the item: an open app hears `notice` `share` and pulls
  (`share.pending`), the window claims the item and the app acks it once placed (`share.ack`). Only the item's own
  share fields cross (`id`, `kind`, `text`, `url`, `title`, `target`, and for a file `file`, `name`, `mime`, `size`).
  No tap is needed: the owner already chose the app in the shell's sheet. Proof:
  `tests/qa-browser-boundary-share-receive.cjs` (real Chromium, the real share sheet).
- Wizard Music and the fingerprint vault: `WizardApp.audio.duck` lowers Wizard Music for that window (`audio.duck`);
  the window owns the duck, so a new document or closing the window restores the music. `WizardApp.vault.*` (Android)
  answers `vault.has`, `vault.seal`, `vault.open` and `vault.forget` for the window's installed app id (the page never
  names one). The fingerprint prompt shows only while that window is steadily in front, as for a same-origin app, and
  the secret goes back only to the document that asked (`gen`); a reloaded, navigated or closed window gets
  `vault:cancelled`. Only `{ secret }` (up to 4096 characters) or `{ available, saved }` cross; native error codes cross
  as `vault:<code>`. Proof: `tests/qa-browser-boundary-duck-vault.cjs` (real Chromium).
- Wizard ID (Android, docs/WIZARD_ID.md): `WizardApp.identity.info`, `.sign`, `.nip44_encrypt` and `.nip44_decrypt`
  are answered for an installed `kind:wizard` apps.json app only (an owner link is refused), with the same window
  checks. The phone's own approval sheet (biometric/PIN) names the app from the catalog, never from the page; a sheet
  opens only while that window is steadily in front, and the answer goes back only to the document that asked (`gen`).
  Only the owner's public info, a well-formed signed event, `{ ciphertext }`, `{ plaintext }` or `denied`/`cancelled`/
  `none` cross. Desktop answers `{ unavailable: true }`, as before. Proof: `tests/qa-browser-boundary-identity.cjs`.
- Recording (`WizardApp.capture.*`): the shell's one recorder (`core/app-capture.js`) records for the window's
  installed app id, as for a same-origin app, and a sandboxed app gets its sessions over the channel (`capture.sync`,
  `capture.prepare`, `capture.release`, `capture.start`, `capture.call`, `capture.settle`, `capture.pending`,
  `capture.ack`), with the same window checks. A NEW recording needs a real tap in that focused, visible window (the
  same tap as share), or a recording this document prepared on such a tap in the last minute (`prepare()` in the tap,
  as apps already do, then `start({ preparedId })` after the app's own work). Reattaching (`attach()`) or resuming
  (`resumeId`) the app's own take needs none, so a reload never loses a meeting. Only data options reach the recorder
  (no page callback). Levels, PCM, chunks, state and warnings come as `notice` `capture` only to the document that
  started or attached the session; a new document hears nothing until it attaches, and a reload never stops the
  recorder. The app's sync calls (`current()`, `capabilities()`, `getInfo()`) answer from what the shell last sent
  (on every channel and with the events). A recording holds shell updates from before the microphone prompt until it
  stops, also across a reload. Only plain data, Blobs (audio) and binary PCM cross. Proof:
  `tests/qa-browser-boundary-capture.cjs` (real Chromium).
- App keys (`data-wz-key`, docs/ai-apps-view.md › App keys): while the AI apps view runs it calls
  `WizBrowserBoundary.pressAppKeys(frameFn)` with its app in front. Only that sandboxed app (other app windows keep
  their own ⌥ shortcuts) reports its live ⌥ keys (`keys.app`: the key, a
  short label and the control's box in its own window; never the control) whenever its page changes, scrolls or resizes,
  hold back ⌥ + one of those keys and forward it like the shell's own keys (a real keypress, the focused window).
  `appKeys(frame)` gives the view stand-ins: the hold-⌥ guide puts the keycap on the control's box, and a press sends
  `keys.press` (the key only), so the app presses its own control (a field as the target takes focus). Wizard's own
  letters (H W S D V C) are never app keys, ⌥⇧ is never one, and on a Mac ⌥E/U/I in a text field stay accents. In the Classic
  desktop (no app keys) nothing is reported and ⌥ keys stay the page's. Proof: `tests/qa-browser-boundary-app-keys.cjs`.
- The AI apps view's own ⌥ keys: while the view runs it adds its window keys with
  `WizBrowserBoundary.layoutKeys(codes)` (`FRAME_KEYS` in layouts/ai-apps/desktop.js: ⌥H Home, ⌥K search, ⌥L / ⌥R
  fold a side, ⌥O workspaces, ⌥A add an app, ⌥0 the tenth row). A sandboxed app holds them back and forwards them like
  the desktop's own keys (a real keypress, the focused window), so they work with the keyboard in an app, as from a
  same-origin one. The same rule as the desktop's list: only keys that move around the owner's own windows or open the
  view's own panels; ⌥N, ⌥S, ⌥W, ⌥↑/↓, ⌥E/X/Z/B, ⌥P and the voice keys stay the app's while it has the keyboard (a
  click outside it gives them back). An app's own `data-wz-key` for one of these letters still wins while it is in
  front. In the Classic desktop the view is gone and they stay the page's. Proof:
  `tests/qa-browser-boundary-view-keys.cjs` (real Chromium, the real AI apps desktop with the boundary on).
- The app kit's skin layer: a same-origin app copies the shell's skin stylesheets and My skin from its parent
  (app-client `syncSkinLayer`), which a sandboxed app cannot read. Under the boundary the appearance host sends the
  layer with each theme (`WizBrowserBoundary.theme(frame, appearance, layer)`: `core/skins.css` and the loaded, enabled
  skin package sheets as same-origin paths, plus My skin's CSS up to 64 KB), again on every reload, and pushes a new one
  when the skin, a skin sheet or My skin changes. The app takes only same-origin `.css` paths; the live kit swap works
  as before. Theme content only, like the tokens. Proof: `tests/qa-browser-boundary-skin-layer.cjs`.
- Hold to record on a touch screen: the browser counts a touch as a tap only when the finger lifts, so a start on
  touch-down has no tap yet. The app client sends such a start as `press` (a finger is down in the page). The shell
  starts the recorder at once (window in front, one at a time, no computer audio) but HOLDS the take: no level, audio
  or chunk reaches the page until a real tap in that visible window confirms it. The finger lifting is that tap: it
  activates the frame without focusing it, so `lifted` also counts an activation the shell itself did not cause (no
  shell input for 5.5 s, focus not in another frame). The client then asks `capture.confirm`, or the app's own Stop
  comes right then; the held audio follows and the rest is live. Unconfirmed within 2 minutes, stopped without a tap,
  or its document gone, the take is discarded (`cancel`); a take still held when the shell reloads is discarded when
  the app next lists or attaches (`wos.capture.held.v1`, shell storage). Proof:
  `tests/qa-browser-boundary-touch-hold.cjs` (real Chromium, real touch input).
- Voice commands stay closed under the boundary: an app's `voice.commands` claim must answer synchronously while the
  shell parses a held-orb command, which a message channel can't do, and no installed app registers one (apps declare
  spoken words as data, `voice_routes`, which the shell opens itself and which work as before).
- Saved settings: the browser refuses `localStorage` and `sessionStorage` to an opaque page (any use throws), so
  `core/app-client.js` gives the page stand-ins with the same methods (named access, `key()`, `length`,
  `QuotaExceededError` over 512K characters). The shell keeps each app's `localStorage` in its own storage
  (`wos.app-storage.v1.<appId>`, 1.5M characters for all apps together), keyed by the window's installed app id, never
  one the page names (`storage.save` with the page's changes, `storage.load`). A page reads its settings while it
  loads, before any message can arrive, so a new window gets them in the frame's name: `frameAttributes(url, appId)`
  in the phone and desktop markup, `storageName(appId)` for the pinned app. The page keeps both in the name as it
  changes them, so a reload or a link to another page of the app keeps them too; `sessionStorage` never leaves the
  window. The name carries the app's own path: a page outside it (another app on this host) drops it unread, and a
  link or form that leaves that path clears it first (a navigation the app's own scripts make is theirs: they hold the
  data anyway). A window that started without them (the Welcome's frames) asks once and fires a `storage` event; a
  change the shell could not keep (all apps full) is undone in the page, with a `storage` event.
  Not covered: Cache Storage. The copy is deleted when the app is removed (below). Proof:
  `tests/qa-browser-boundary-storage.cjs`.
- IndexedDB: the browser refuses it to an opaque page (`open` throws), so `core/app-client.js` puts a stand-in in its
  place with the same classes (`instanceof IDBRequest` holds, so libraries such as idb work), requests and events:
  object stores with in-line or out-of-line keys and key generators, indexes (unique, multiEntry), the browser's own
  `IDBKeyRange` and `indexedDB.cmp`, cursors in all four directions with `update`/`delete`, `getAll`/`count`,
  `deleteDatabase` and `databases()`. The shell keeps each app's databases in its own IndexedDB (`wos-app-idb-v1`,
  browser-boundary.js `appIdb`), keyed by the window's installed app id, never one the page names. Opening a
  database reads it whole once (`idb.load`); requests run on the page's copy, in order, one transaction at a time; a
  readwrite transaction's changes go to the shell as one list when it ends (`idb.commit`, written all together or not
  at all) and `complete` fires only after that. Over 64 MB for the app (256 MB for all apps) the transaction aborts
  with `QuotaExceededError` and nothing of it stays. After a change, the app's other windows read that database again
  before their next transaction (`notice` `idb`). Values are copies (structuredClone), Blobs included (Music's offline
  clips). They are deleted when the app is removed (below). Not covered: an upgrade does not wait for other open
  connections (they get `versionchange`). `document.cookie` throws in an opaque page too, so the page gets a jar of
  its own for that document (what it writes it reads back; nothing reaches its server, and the owner's cookies stay
  out of reach). Proof: `tests/qa-browser-boundary-idb.cjs`.
- Removing an app deletes that app's saved settings and databases on the device (`web/store/store-remove.js`). The
  Store's own Remove does it at once on that device, once the App Manager and the readback confirm the removal
  (`tests/qa-browser-boundary-forget.cjs`). Every other device, and an app removed by the agent or the box command,
  learns it from the box's app list (`core/apps.js` hands each fresh list to `sweepGone`): an app the Store removed
  there goes on the next read without it; any other app goes once 2 reads at least a day apart both lacked it, because
  a list can miss an app for a moment and deleting is final. A list with no installed app at all deletes nothing.
  Either way the app is noted as removed (`wos.app-removed.v1`), so a window of it opened before writes nothing back.
  Proof: `tests/qa-browser-boundary-sweep.cjs`.
- The app's own backend: an opaque page's own `fetch` to this host goes out with `Origin: null` and no cookies, and the
  browser hides the answer (CORS), so most apps could not load their data. `core/app-client.js` sends a `fetch` to this
  host through the shell (`net.fetch`) and gives the page a normal `Response` (status, headers, body, `url`,
  `redirected`; `AbortSignal` works). `core/app-services.js` makes the call only inside the window's own app path (the
  same rule as its links), never to an owner route (`WizBrowserBoundary.ownerRoute`, the same list as
  `core/shell-token.js`, so the token is never added) and drops a page's `X-Wizard-Shell-Token` header. The browser
  hides where a redirect goes until it has followed it, so only GET and HEAD follow one (an answer from outside the
  path is refused); any other method's redirect is never followed, so a POST is never sent on to another app. An abort
  stops the call in the shell too (`net.abort`, the window's own open call only). At most 8 at once per window, apart from the other services, and 32 MB each
  way. A call open when the window gets a new channel fails instead of running twice. A call the shell never took (it came on the channel the window's load had just ended, e.g. one a page makes while it is still loading) is sent again on the new channel: the shell's hello names the calls it took and has not answered (`took`), and only those fail. An address outside the path
  (another app, an owner route) gets the page's own fetch unchanged, so it still goes out with `Origin: null`, no cookie
  and no token. `XMLHttpRequest` goes the same way: app-client.js puts a stand-in in its place that makes an async
  request through that `fetch` (status, headers, `responseType` text/json/arraybuffer/blob/document, abort, timeout,
  upload events, `withCredentials`); a synchronous one still uses the browser's own. Answers stream: the shell sends
  the status and headers first and the body in pieces of at most 256 KB as they arrive (`notice` `net`: bytes, end or
  error, for that call's key, to the window's current document only). The page's reads say how much it has taken
  (`net.ack`), and the shell reads on only while at most 1 MB waits in between, so a page that stops reading stops the
  stream. At most 16 open calls per window; cancelling the body or aborting stops the call in the shell, and a new
  document ends them all. `EventSource` to this host goes through that streamed `fetch` too (a stand-in with
  `readyState`, named events, `lastEventId`, `retry:` and reconnect with `Last-Event-ID`, `close()`; an answer that is
  not a 200 `text/event-stream` closes it), so a live feed from the app's own backend arrives as it is written; another
  site's stream uses the browser's own. `WebSocket` to this host goes through the shell as well (the Recorder's live
  transcript refuses `Origin: null`): app-client.js puts a stand-in in its place and the shell opens the socket
  (`ws.open`) with this host's origin and cookies, on the same rule (the window's own app path, never an owner route).
  The server's messages and its close come as `notice` `ws` (text or bytes; code, reason, clean) to the window's
  current document only; the page's messages go as `ws.send` (in order, at most 8 on the way, a Blob read first;
  4 MB per message, a server not reading past 16 MB fails it) and its `close(code, reason)` as `ws.close`. At most 8
  open per window; a new document or closing the window closes them at the server. The stand-in keeps `readyState`,
  `protocol`, `extensions`, `binaryType`, `bufferedAmount` and the open/message/error/close events. Another site, an
  address outside the path or a window with no shell channel gets the browser's own `WebSocket`, as before. Proof:
  `tests/qa-browser-boundary-backend.cjs`, `tests/qa-browser-boundary-xhr.cjs`, `tests/qa-browser-boundary-stream.cjs`,
  `tests/qa-browser-boundary-websocket.cjs`.
- Links and pop-ups: the sandbox has no `allow-popups` or `allow-top-navigation`, and the shell cannot patch an opaque
  page's links (`WizLinks.guardFrame`), so a link that opens a new tab or the whole page (`target` `_blank`, `_top`,
  `_parent` or a name no frame of the page has), `window.open`, a link to another site, a link to a page outside the window's app path and an image of this
  Wizard did nothing or loaded into the app's window. Now `core/app-client.js` hands such a tap to the shell
  (`link.open`, the address only) and it opens by guardFrame's rules (`WizLinks.follow` in `core/links.js`, on the
  shell's own sheet): `data-wizard-browse` in the owner's browser, an image in the viewer, a file as a download,
  another site by the sheet's outside route, a page of this Wizard through the deep link or the shell's route (an app
  window, a link desk), else the sheet. The shell names the window's app path in each hello (`home`, from
  `WizAppServices.attach`'s path) so the page knows which links leave it. Like a browser's pop-up rule it needs a real
  tap in that focused, visible window; a page alone, or a tap elsewhere in the shell, opens nothing. In-page anchors
  and the app's own pages stay the page's; a link aimed at the page's own named frame stays there; a form aimed at
  `_top` / `_parent` stays in its window. A `download` link to a file inside the app path (Music's Download clip) is
  saved by the shell: the browser ignores `download` for an opaque page and loaded the file into the window in place
  of the app, so app-client.js hands the tap over (`link.open` with `download: true` and the link's name) and the shell
  saves it the way it does for a same-origin app (`WizLinks.download`), only inside the window's own app path and on
  the same tap rule. A download link outside the app path goes to the shell like any other link that leaves. Proof: `tests/qa-browser-boundary-links.cjs` (real Chromium, the real link sheet).
- Photo viewer and navigation: `WizardApp.media.view`, `nav.back`, `nav.openThread` and `nav.openContextDraft` go to the
  shell as `media.view` / `nav.*` and run on the same rules as for a same-origin app (`core/app-services.js`
  `mediaView`, `navBack`, `threadOpen`, `contextDraft`: the window in view, hosted threads only for the apps the
  launcher lists, reply keys of the window's own app id, a running agent). The viewer opens only this host's own
  http(s) photos outside the owner routes; the page's own `blob:` photos (its opaque origin's) cross as their bytes and
  show under a shell `blob:` URL, revoked on the window's next view and when it closes. These calls answer at once as
  they always have, so the page gets `true` (a context draft: an `unsent-draft` receipt) once the request is on its
  way; a refusal is only logged in the page's console. `threadAgents` / `threadDrafts` read true. Proof:
  `tests/qa-browser-boundary-media-nav.cjs` (real Chromium).
- Browser proof: `tests/qa-browser-boundary-frames.cjs` (real Chromium: opaque origin, `parent.document` and shell
  storage blocked, owner call tokenless with `Origin: null`, Back and theme by postMessage). Unit tests:
  `tests/browser-boundary-frames.test.mjs`.

Not covered yet (next slices, all on #133), so nobody should turn the box switch on yet:
- The app orb (`orb.set`, no shell view draws it) and voice commands (above) stay closed; every other app service is
  answered.
- Phone: the shell has no key forwarding (it has no desktop keys). Pages in the link sheet lose their own storage and
  pop-ups.
- Each real app still needs checking one by one from an opaque origin (wizard-os#385); `fetch` (also streamed),
  `XMLHttpRequest`, `EventSource` and `WebSocket` to the app's own backend, `localStorage`, `sessionStorage`,
  IndexedDB and `document.cookie` work (above). The
  Troubleshooter's own `/troubleshoot/api/` calls already work (wizard-troubleshooter#44: a per-box page key), once
  boxes run that Troubleshooter version.
- `<img>`/`<video>`/download loads of attachments and saved files carry no header; the Agent Service lets exactly
  those browser-marked loads through without the token (wizard-agent-service#479).
- Native bridges (Android/Mac) still reach every frame (wizard-os#387).
