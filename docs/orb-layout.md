# Orb desktop (layout `orb`, tweak `miguel/orb-shell`)

Opt-in, desktop only, off by default: Settings › Look › Tweaks › **Orb desktop**. Switching it off brings the
classic desktop straight back (no reload). The phone is untouched: the tweak does nothing there.

What it changes (all in `web/layouts/orb/`, CSS scoped to `html[data-shell="desktop"][data-layout="orb"]`):

- Home (an empty desk or ⌥` Home) is one scene over the skin's own wallpaper: the shell's real orb (`orb.js`)
  large in the middle, following the take and the mic level. Click = talk (a new chat; click again to send).
  Hold = a local command (release runs it): the classic "tap to talk, hold for a command". A tap never runs a
  command (James, 21 Oct: `core/commands.js`), so "Hey <name> …" is handled inside a held take
  (`WizConfig.stripAddress`), not by routing a tap.
- The owner's quick apps (Home's app chips, `desktopQuick`) orbit the orb; a click opens the app in its normal
  window; the last item opens every app (⌥O).
- Working and Ready threads sit under the orb as pills (spinner = working, amber = ready for you). A pill opens
  the stock Chats thread window; Snooze / Done run Chats' own `threadAct` (so `miguel/snooze-someday` applies).
  No second composer or transcript.
- Any window takes over; closing the last one brings the scene back. With windows open a small orb top left goes
  Home. The bar keeps only the AI fuel gauge, update notices and Settings; every key still works.

## Layouts a tweak can wear

A tweak with the `layout` capability wears a built-in layout with `api.layout.use(id)` (`two-orb`:
`wizard/two-orbs`, phone; `orb`: `miguel/orb-shell`, desktop); turning the tweak off releases it. A stored layout
that no live tweak wears after tweaks load goes back to Classic, so a device can never get stuck in it.

Layouts are shell code: they get the skin API plus the shell's own lists and actions (copies, no DOM), in
`shellApi` (`web/core/skin-host.js`), wired by the desktop adapter (`web/desktop/desktop.js`):

- `api.sessions.list()` → `{ working, ready }` rows `{ id, title, kind, needs, unread, snoozed, at, actions }`
  (`actions`: what Chats offers on that thread, `snooze` / `done` only); `null` while connecting.
- `api.sessions.act(id, 'snooze' | 'done')`, `open(id)`, `openList('ready' | 'working')`.
- `api.apps.list()` → `{ id, name, icon }`; `open(id)`; `all()` (⌥O).
- `api.desk.home()` (⌥`), `api.desk.look()` (Settings › Look), `api.desk.emptyHome()`: closing the last window of
  a desk goes Home instead of to another desk (`WosSkinHost.emptyHome`, read by `closeWin`); released on teardown.
- `api.voice.command()`: a local command take (⌥C); call again to run it.
- `api.orb.ready()` loads `orb.js` on a page without it (desktop), so `api.orb.create` works there;
  `api.route().home` is true while Home is in front.

Tests: `tests/orb-layout.test.mjs`.
