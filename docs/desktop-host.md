# Desktop lifecycle host

`core/desktop-host.js` loads only in desktop.html, before desktop/desktop.js.
The shell attaches once; `window.WizDesktop.host` is null before attachment.
It is a frozen contract over the existing lifecycle, not a second window store.

- `windows()` returns a frozen array of frozen records: `id`, `kind`, `appId`,
  `desk` (current index, -1 for non-desk panels), `deskId` (stable identity or
  null), `title`, `thread`, `focused`, `visible`, `tiled`. `tiled` identifies
  windows participating in their desk layout (including hidden desks), excluding
  monocle-hidden windows, floating HUD and detached panels. Read again after changes;
  never save these snapshots as window state. No Classic element or mutable W
  record is exposed.
- `frame(id)` returns the existing app iframe, or null for unmounted, closed or
  non-frame windows. The shell still owns bridge/load/focus hooks and custody.
  A layout must not replace or destroy that document to change placement.
- `frameReady(id)` checks the retained document: loading/about:blank is not ready,
  a loaded cross-origin document is ready, and a missing frame is not. Native
  non-frame surfaces are ready once registered. No iframe is recreated.
- `renderTools(id, slot)` projects AppServices' validated titlebar model into a
  layout-owned slot, returning whether tools exist. The canonical renderer keeps
  unchanged controls in place, binds actions to the verified app document, and
  clears closed/non-app surfaces. App tool updates use `onChange`, not a DOM observer.
- `openApp(appId)` uses the current registered-app opener and routing/admission.
  Returns whether the request was handled, not a network-ready promise.
- `focus(id, {scroll=true})` invokes the original synchronous focus path; false
  means absent/refused/not focused. First pointerdown uses `scroll:false`, so
  the app control receives that same click without shell focus stealing.
- `close(id)` uses the original leave/recording checks, cleanup and panel logic.
  Returns true only if the window was removed synchronously; a refused or
  confirmation-pending close returns false. It does not bypass a custody check.
- `onChange(fn)` returns an idempotent unsubscribe. State saves, render and host
  focus coalesce into a microtask with the latest immutable windows snapshot,
  after synchronous paint. Unsubscribing cancels pending delivery to that
  subscriber. A failing listener cannot abort shell work. Consumers render an
  initial snapshot themselves; subscription does not invoke immediately.
- `panes` is the existing `WizCore.panes`, not a copy of its geometry/state.

Classic pointer focus, iframe focus, close and the existing skin adapter's app
opener use this boundary. Slice 2 migrates AI apps' frame selection, keyboard
focus, readiness, tools, frame fitting, multi-window group counts and companion
window lifecycle onto the same host. Its remaining Classic selectors are pinned in
`tests/fixtures/ai-apps-classic-selectors.json` and guarded by
`tests/ai-apps-classic-boundary.test.mjs`. Reduce that list, never expand it to
hide a new dependency. Four layout.js entries belong to phone-only markup;
those must not be confused with the desktop migration's remaining 18 sites.

Still pending: app/group surface mounting, minimize/presentation lifecycle,
Chats/composer/Settings mounts, layout selection before rendering, separate
Classic/AI apps renderers, removal of boot veil and obsolete override CSS.
Classic rendering still runs under AI apps. This slice does not yet claim
independent layout rendering or remove the existing override CSS.
