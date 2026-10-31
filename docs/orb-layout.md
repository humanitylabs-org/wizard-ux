# Orbs view (layout `orb`, tweaks `miguel/orb-shell` + `miguel/orb-switch`)

Opt-in, desktop only, off by default: Settings › Look › Tweaks › **Orbs view**. The desktop has two equal views,
**Desks** and **Orbs**; switching it off brings the Desks view straight back (no reload). The phone is untouched: the tweak does nothing there.

**Desks | Orbs switch** (`miguel/orb-switch`, its own tweak; tweak ids unchanged so devices keep their choice): a segmented control in the middle of the desktop bar,
in place of the date and time, visible in both modes. It mounts in the core `bar-center` slot (`web/desktop.html`,
`core/slots.json`): while that slot holds anything the clock steps aside (`desktop.css`), and the slot hides under the
voice pill like the clock did. One click switches `miguel/orb-shell` for this device through the same tweak mix as
Settings (`WosExperience.toggle`, via the trusted `api.settings.toggleTweak`, own author only), no reload. The lit side
follows what the desktop really wears (`html[data-layout]`), so a half-loaded Orb shows Classic and one click mends it.
Off by default on main like every tweak; Miguel's release turns it on with a catalog `defaults` entry.

What the Orbs view changes (all in `web/layouts/orb/`, CSS scoped to `html[data-shell="desktop"][data-layout="orb"]`).
It is a port of the approved concept (Files › Pages › `orb-shell-concept`):

- Home (an empty desk or ⌥` Home) is the concept's night scene over the whole window (the bar goes transparent over
  it and takes the scene's ink, so light skins look the same): a starfield sky with a soft glow behind the orb, drawn
  in a canvas like the concept's `drawSky`.
- The **orb** at 46% height, following the take (`voice` events: listening rings, a faster spin while sending, one
  sharp ring when a command take ends or a new thread turns Ready) and the mic level (`api.orb.onLevel`). Click = talk
  (a new chat; click again to send). Hold = a local command (release runs it).
- Its look is a **Style × a Colour**, picked in a quiet **Look** button (live previews of every style in the chosen
  colour; Esc or a click outside folds it), kept per device (`api.storage` `style`, `colour`). Thirteen styles, each
  its own canvas-2D drawing in `web/layouts/orb/styles.js`: **Glass** (default), **Oracle** (a calm face), **Plasma**,
  **Swarm**, **Hologram**, **Glitch**, **Chrome**, and (v6) **Marble** (a classical Greek head in veined white stone:
  a small signed-distance sculpture ray-marched once on the CPU into a lit image with ambient occlusion and a 3D vein
  mask; the veins and the closed eyes light up with the voice and the lips part while it listens), **Sun** (granules,
  a darker limb, a corona of flares that leap with the voice), **Black hole** (shadow, photon ring, a Doppler-bright
  accretion disc bent over the top), **Crystal** (a turning cut icosahedron lit per facet), **Aurora** (curtains
  rippling in a dark glass sphere) and **Planet** (a banded world under a tilted ring). Seventeen colours: Nebula
  (default), Ember, Tide, Gold, Mono, Emerald, Rose, Arctic, Marble, Obsidian, Bronze, Royal, Crimson, Cyber,
  Sunset, Ocean (four stops each, skin-layer tokens `--ob-look-*` in the tweak's `tweak.css`) and Skin accent. All
  drawn in-house: no image assets, no vendored code. Ideas (not code) from Teknium's Uncommon Web for the v4 styles.
- Every installed app with a screen (the shell's own kinds, `WosAppKinds.kinds().apps`: no agent apps, connectors or
  agents; picker order; no cap) floats on two tilted orbits as **just their own mark** (v6: no
  glass plate, ring or bubble behind them; a tile logo stays a tile, a free-form logo or a glyph stands alone, with a
  soft shadow for legibility), each with the shell's own **count badge** (`api.apps.badges(watch)`: the counts on desk
  marks and the dock, live; a running app reports its own through WizardApp badge). When the orbits can't hold them all at a readable size the marks shrink (to 74%),
  and only past that the last ones fold into an **All apps** mark (shown only when something is hidden); alternating rings at even steps, drifting slowly the same way (never sliding onto each other); in front of
  the orb they are bigger and brighter, behind it smaller and dimmer. Label on hover; a click opens the app. Each wears
  its **own logo** (`api.apps.logo(id)` → `store-data/logo/<id>`; template / Runtipi placeholders count as none) in a
  round frame, else its designed glyph in its own colour. Never a letter.
- Under the orb: only a caption line while a take runs (no name label: the orb is the entity). The real keys are the hint line near the
  bottom: `⌥V` to talk (new voice chat; `Right ⌘` in the Mac app) and `⌥N` to type (new chat). The fuel gauge and the
  gear stay top right; the Desks | Orbs switch sits in the bar's centre.
- **Around a fixed orb** (v6, Miguel: "the orb never moves"). The orb stays at the screen's centre whatever is open;
  panels only cover the sides (satellites under them are simply covered). **Left: the stock Chats list, docked** for
  good (v5, "bake the stock session list in"): the same Chats window as everywhere (Archive / Working / Ready, the
  Ready sort Newest / Priority / By subject, search, pins, snooze-someday and every tweak on it), full height under the
  bar, 22% of the width (280-400 px), in a softer glass. It only lists.
- **A chat opens in a column right beside the list** (a click in the list, ⌥↓ / ⌥↑ the next / previous Ready thread,
  ⌥N a new chat, a notification): the same glass, full height, as an extension of the list; it grows out of the list's
  edge and folds back into it. It is as wide as fits before the orb (up to a third of the screen); where it can't fit
  beside a full-size orb (laptop screens) the orb steps down in size where it stands (never below 45%), so it stays
  visible and clickable. Send, Done, Snooze (also ⌥→ / ⌥←), ‹, ✕ or Esc close it and give the keyboard back to the
  list, so ⌥↓ goes straight on to the next one. Another thread replaces it, with a quiet ‹ back.
- **An app opens in the right third** (a satellite, All apps, a link), one at a time (another replaces it, with ‹);
  ✕ or Esc closes it. A chat and an app can be open together; Esc closes the chat first.
- **The orb powers what is open.** The open app's satellite stops drifting and pins between the orb and its panel
  (an app with no satellite gets one while it is open); an electric bolt in the orb's colour runs orb → that icon →
  the panel's edge, and a quieter one orb → the chat column. Jagged arcs with a glow, a second and third strand,
  short forks and a spark running along them, re-struck about ten times a second on the sky canvas in the same
  ~30 fps loop; reduced motion = one still glowing arc. Closing the panel lets the icon go back to its orbit.
- **Resizable:** thin grips on the inner edges of the list, the chat column and the app panel (drag, or ←/→ on the
  focused grip; double-click or Enter = back to the default; kept per device in `widths`; list 260-520 px, chat
  360 px-45vw, app 360 px-60vw; never overlapping; the orb stays put).
- The **Look** picker sits at the bottom of the orb area, right of whatever is open on the left.
- **⌥\\** (or the handle on the list's edge) folds the list to a slim strip with the Ready count; a chat column then
  opens beside the strip. Kept per device.
- **No desks.** The workspace numbers are gone and desk keys do nothing (⌥1…9, ⌥[ ⌥], moving windows, full screen,
  ⌥P); ⌥T just offers the apps. The desks underneath are never touched: turning the Orb off brings them back exactly
  (and the desk you were on).
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
  sends every new window to a panel window outside the desks (`panelOpen`: never tiled, never synced, not restored
  after a reload; `findWin` sees only the panels; desk keys return early); Home stays in front. Released on teardown:
  the panels go and the desk in front before comes back.
- Two content panels (`panelOpen`): a Chats window goes to the **chat** panel (`panel`), anything else to the **app**
  panel (`panelApp`, `data-side="right"`); each holds one window at a time with its own Back list, and both can be
  open. The one in front for keys and Esc is the one holding focus, else the one opened or clicked last, else the chat.
- `api.panel.dock(on)` (after `claim`): the stock Chats list gets its own panel on the **left** for good (`panelList`;
  its bar is hidden, it never closes); `dock(false)` folds it away. Docked, the chat panel is a column beside it
  (`data-side="beside"`). The list only lists: whenever it would show a thread (`syncChatsPane` sees `w.thread`),
  `panelForward` steps it back to the list and opens that thread in the chat panel. When that thread is finished (it
  turns null: Done, Snooze, ‹, a send) `panelThreadLeft` closes it and focus goes back to the list.
- `api.panel.close()` closes the panel in front, `api.panel.back()`, `api.panel.state()` → `{ kind, title, width,
  back, list: { width }, chat: { kind, left, right }, app: { id, title, left, right } }` (each part null when closed;
  stage pixels at rest) or null; `api.route().panel` is the open content kind, `panelList` whether the list is docked
  and `panelApp` the open app's id (a `route` event fires when any changes). The layout sets the panels' widths
  (`--ob-col-w`, `--ob-chat-w`, `--ob-beside-left`, `--ob-app-w` on `<html>`): they depend on the orb's size.
- `api.back.push(close)`: the layout's own overlay (the look popover) joins the shell's Esc order.
- `api.voice.command()`: a local command take (⌥C); call again to run it.
- `api.orb.ready()` loads `orb.js` on a page without it (desktop), so `api.orb.create` works there;
  `api.route().home` is true while Home is in front.

Tests: `tests/orb-layout.test.mjs`.
