# Orb desktop (layout `orb`, tweaks `miguel/orb-shell` + `miguel/orb-switch`)

Opt-in, desktop only, off by default: Settings › Look › Tweaks › **Orb desktop**. Switching it off brings the
classic desktop straight back (no reload). The phone is untouched: the tweak does nothing there.

**Classic | Orb switch** (`miguel/orb-switch`, its own tweak): a segmented control in the middle of the desktop bar,
in place of the date and time, visible in both modes. It mounts in the core `bar-center` slot (`web/desktop.html`,
`core/slots.json`): while that slot holds anything the clock steps aside (`desktop.css`), and the slot hides under the
voice pill like the clock did. One click switches `miguel/orb-shell` for this device through the same tweak mix as
Settings (`WosExperience.toggle`, via the trusted `api.settings.toggleTweak`, own author only), no reload. The lit side
follows what the desktop really wears (`html[data-layout]`), so a half-loaded Orb shows Classic and one click mends it.
Off by default on main like every tweak; Miguel's release turns it on with a catalog `defaults` entry.

What the Orb desktop changes (all in `web/layouts/orb/`, CSS scoped to `html[data-shell="desktop"][data-layout="orb"]`).
It is a port of the approved concept (Files › Pages › `orb-shell-concept`):

- Home (an empty desk or ⌥` Home) is the concept's night scene over the whole window (the bar goes transparent over
  it and takes the scene's ink, so light skins look the same): a starfield sky with a soft glow behind the orb, drawn
  in a canvas like the concept's `drawSky`.
- The concept's **glassy orb** at 46% height (canvas: halo, swirling colour inside, glass highlight, rim), following
  the take (`voice` events: listening rings, a faster swirl while sending, one sharp ring when a command take ends or
  a new thread turns Ready) and the mic level (`api.orb.onLevel`). Click = talk (a new chat; click again to send).
  Hold = a local command (release runs it). Four looks from the concept, chosen by four quiet swatches bottom right and
  kept per device (`api.storage` `look`): **Nebula** (default), **Ember**, **Tide**, **Oracle** (a calm face whose
  mouth follows the voice). Colours are skin-layer tokens in the tweak's `tweak.css` (`--ob-look-*`, `--ob-*`).
- The owner's apps (picker order, up to 10 + All apps) are the concept's **round glass satellites** on two tilted
  orbits, alternating rings at even steps, drifting slowly the same way (never sliding onto each other); in front of
  the orb they are bigger and brighter, behind it smaller and dimmer. Label on hover; a click opens the app. Each wears
  its **own logo** (`api.apps.logo(id)` → `store-data/logo/<id>`; template / Runtipi placeholders count as none) in a
  round frame, else its designed glyph in its own colour. Never a letter.
- Under the orb: the agent's name, a caption line while a take runs, then the concept's **pills**: every Ready thread
  glows amber, with Snooze and Done appearing on hover (Chats' own `threadAct`); at most two rows, the rest fold into
  a quiet `+N more` that opens the Ready list. **Working** is one quiet spinner pill (`1 working`; a click opens it, or
  the Working list when there are several).
- The real keys as the hint line near the bottom: `⌥V` to talk (new voice chat; `Right ⌘` in the Mac app) and `⌥N` to
  type (new chat). The fuel gauge and the gear stay top right.
- Any window takes over (stock windows); closing the last one brings the scene back. With windows open a small orb top
  left goes Home.
- Motion: one ~30 fps loop, only while the scene is in front and the page is visible. Reduced motion: still frames.

## Layouts a tweak can wear

A tweak with the `layout` capability wears a built-in layout with `api.layout.use(id)` (`two-orb`:
`wizard/two-orbs`, phone; `orb`: `miguel/orb-shell`, desktop); turning the tweak off releases it. A stored layout
that no live tweak wears after tweaks load goes back to Classic, so a device can never get stuck in it.

Layouts are shell code: they get the skin API plus the shell's own lists and actions (copies, no DOM), in
`shellApi` (`web/core/skin-host.js`), wired by the desktop adapter (`web/desktop/desktop.js`):

- `api.sessions.list()` → `{ working, ready }` rows `{ id, title, kind, needs, unread, snoozed, at, actions }`
  (`actions`: what Chats offers on that thread, `snooze` / `done` only); `null` while connecting.
- `api.sessions.act(id, 'snooze' | 'done')`, `open(id)`, `openList('ready' | 'working')`.
- `api.apps.list()` → `{ id, name, icon }`; `open(id)`; `all()` (⌥O); `logo(id)` → a local URL or null.
- `api.desk.home()` (⌥`), `api.desk.look()` (Settings › Look), `api.desk.emptyHome()`: closing the last window of
  a desk goes Home instead of to another desk (`WosSkinHost.emptyHome`, read by `closeWin`); released on teardown.
- `api.voice.command()`: a local command take (⌥C); call again to run it.
- `api.orb.ready()` loads `orb.js` on a page without it (desktop), so `api.orb.create` works there;
  `api.route().home` is true while Home is in front.

Tests: `tests/orb-layout.test.mjs`.
