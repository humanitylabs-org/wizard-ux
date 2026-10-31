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
- The **orb** at 46% height, following the take (`voice` events: listening rings, a faster spin while sending, one
  sharp ring when a command take ends or a new thread turns Ready) and the mic level (`api.orb.onLevel`). Click = talk
  (a new chat; click again to send). Hold = a local command (release runs it).
- Its look is a **Style × a Colour**, picked in a quiet **Look** button bottom right that opens a popover (live
  previews of every style in the chosen colour; Esc or a click outside folds it) and kept per device (`api.storage`
  `style`, `colour`; the v3 `look` carries over once). Seven styles, each its own canvas-2D drawing in
  `web/layouts/orb/styles.js`: **Glass** (the concept's glassy orb, default), **Oracle** (the concept's calm face; the
  mouth follows the voice), **Plasma** (a soft nebula cloud, no rim), **Swarm** (a turning sphere of points with a few
  constellation links), **Hologram** (a lattice sphere in dashed rings and ticks), **Glitch** (an ordered-dither
  entity that tears while you speak), **Chrome** (a liquid-metal blob whose outline ripples). Nine colours: **Nebula**
  (default), **Ember**, **Tide**, **Gold**, **Mono**, **Emerald**, **Rose**, **Arctic** (four stops each, skin-layer
  tokens `--ob-look-*` in the tweak's `tweak.css`) and **Skin accent** (four shades of the skin's `--wz-accent`).
  Drawn in-house; ideas (not code) from Teknium's Uncommon Web: Bayer dithering (dithercn, dither-avatar), a
  Fibonacci dot sphere (Cobe), constellations (tsParticles), sliced glitches (PowerGlitch), liquid chrome (Paper
  Shaders' LiquidMetal), the Tron hologram (ENCOM Globe). No vendored code.
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
- **No desks.** The workspace numbers are gone and desk keys do nothing (⌥1…9, ⌥[ ⌥], moving windows, full screen,
  ⌥P); ⌥T just offers the apps. Whatever opens (a pill, `+N more`, the Working pill, a satellite, All apps, a new or
  voice chat, a link) shows in **one panel** that slides in from the right over the scene, like the concept's
  conversation panel: the real Chats thread (its own header, Snooze / Done, composer) at 460 px, an app wider
  (62%). The scene moves to the middle of what is left (the orb steps down a little next to a wide app). ✕, Esc or a
  click on the bare sky slides it away; opening another thing replaces it, and a quiet ‹ in the panel goes back to the
  one before. The desks underneath are never touched: turning the Orb off brings them back exactly (and the desk you
  were on).
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
- `api.panel.claim()`: no desks while held (`WosSkinHost.panelMode`; the adapter's `panelMode(on)`). desktop.js then
  sends every new window to one panel window outside the desks (`panelOpen`: never tiled, never synced, not restored
  after a reload; `findWin` sees only it; desk keys return early); Home stays in front. Released on teardown: the panel
  goes and the desk in front before comes back. `api.panel.close()`, `api.panel.back()`, `api.panel.state()` →
  `{ kind: 'thread' | 'list' | 'app', title, width, back }` or null; `api.route().panel` is the same kind (a `route`
  event fires when it changes).
- `api.back.push(close)`: the layout's own overlay (the look popover) joins the shell's Esc order.
- `api.voice.command()`: a local command take (⌥C); call again to run it.
- `api.orb.ready()` loads `orb.js` on a page without it (desktop), so `api.orb.create` works there;
  `api.route().home` is true while Home is in front.

Tests: `tests/orb-layout.test.mjs`.
