# Orb desktop (layout `orb`, tweaks `miguel/orb-shell` + `miguel/orb-switch`)

Opt-in, desktop only, off by default: Settings › Look › Tweaks › **Orb desktop**. Switching it off brings the
classic desktop straight back (no reload). The phone is untouched: the tweak does nothing there.

**Classic | Orb switch** (`miguel/orb-switch`, its own tweak): a small two-way chip at the start of the desktop bar,
visible in both modes. One click switches `miguel/orb-shell` for this device through the same tweak mix as Settings
(`WosExperience.toggle`, via the trusted `api.settings.toggleTweak`, own author only), no reload. The lit side follows
what the desktop really wears (`html[data-layout]`), so a half-loaded Orb shows Classic and one click mends it. Off by
default on main like every tweak; Miguel's release turns it on with a catalog `defaults` entry.

What the Orb desktop changes (all in `web/layouts/orb/`, CSS scoped to `html[data-shell="desktop"][data-layout="orb"]`):

- Home (an empty desk or ⌥` Home) is one scene over the skin's own wallpaper with a **living entity** in the middle:
  an irregular shape that drifts gently round the centre and follows the take (`voice` events) and the mic level
  (`api.orb.onLevel`). Click = talk (a new chat; click again to send). Hold = a local command (release runs it).
  Three looks, picked bottom right and kept per device (`api.storage` `look`):
  - **Nebula** (default): Paper Shaders' `metaballs` fragment shader on its vanilla `ShaderMount`
    (`vendor/paper-shaders/`, Apache-2.0, LICENSE + NOTICE beside it; loaded only when picked). Balls kept in the
    middle two thirds so it stays one body; louder speech = more balls and faster.
  - **Glitch**: a dithered pixel entity (4×4 Bayer) with an RGB split, scanlines and sliced tears that fire more often
    while listening; in the spirit of Archimedes' glitch look (PowerGlitch's slice / shake idea, drawn in a canvas).
  - **Swarm**: ~190 motes circling an irregular breathing centre, faint constellation links.
  The entity's colours are skin-layer tokens `--ob-v1…5` in the tweak's `tweak.css` (Wizard violet on every skin).
- The owner's apps (picker order, up to 12 + All apps) float at loose spots round it: best-of-N random candidates
  seeded by app id, never on the entity's whole drift area or its name, never on each other or the edges, each with a
  slow wander. Each wears its **own logo** from the Store's logo route (`api.apps.logo(id)` → `store-data/logo/<id>`;
  the template / Runtipi placeholder pictures count as no logo) or, without one, its designed glyph in white on a
  lit tile of its own colour. Never a letter tile.
- **Ready** threads under it, all of them (wrapped, scrolls past ~30% of the height), each with Snooze and Done
  (Chats' own `threadAct`). **Working** is one quiet chip (`1 working`); a click shows them compactly with a link to
  the Working list.
- Any window takes over; closing the last one brings the scene back. A lone window opens as a centred card
  (`--desktop-window-max-height`, read by `desktop.js` layout for one window). With windows open a small blob top left
  goes Home.
- Motion: one 30 fps loop, only while the scene is in front and the page is visible; Nebula's own loop sleeps with it.
  Reduced motion: no drift or wander, one still frame.

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
