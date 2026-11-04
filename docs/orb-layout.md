# Orbs view (layout `orb`, tweak `miguel/orb-shell`)

Opt-in, off for everyone by default (no view tweak is a catalog `default`, and no migration turns one on). Three equal
shell views, **Desks** (the stock shell), **Orb** and **Apps**; choosing Desks brings the stock shell straight back (no
reload). On the phone (experimental) Orb changes Home only; see **Phone** below (and **Apps view** for the third view).

**Try it:** Settings (the gear) › Look › Tweaks › Miguel's › **Different shell view - Orb** (or **- Apps**). Ways
back to Desks: switch it off again (the gear stays in the bar on the desktop and at the top of Home on the phone in
every view), or the scene's **Look** button › **Back to the Desks view** (`api.desk.classic()`).

**Two ordinary tweaks, mutually exclusive** (1 Nov 2026, replaced the Settings › Look › Shell view row, which had
replaced the `miguel/orb-switch` bar / phone-Home switch): each view is a normal switch in Miguel's Tweaks list. A tweak
whose manifest names a `view` (`"view": "Orb"` on `miguel/orb-shell`, `"view": "Apps"` on `miguel/apps-home`) is one of
the exclusive views; core names no view. `WosExperience.toggle` of a view switches it on and every other view off in one
pass (one apply), or every view off (Desks); per device, survives a reload (`wos.skin-tweaks.v1`). The per-author quick
button leaves views alone, and a device that stores two on wears only the first in catalog order. The desktop bar
centre is the clock (`bar-center` stays a core slot).

With both tweaks off the desktop is the stock Desks view: every core hook added for this layout (`panelMode`,
`bar-center`, `leaveOnSend`, `WosSkinHost.key`, `commandUi`) is a no-op until a layout claims it.

What the Orbs view changes (all in `web/layouts/orb/`, CSS scoped to `html[data-shell="desktop"][data-layout="orb"]`).
It is a port of the approved concept (Files › Pages › `orb-shell-concept`):

- Home (an empty desk or ⌥` Home) is the concept's night scene over the whole window (the bar goes transparent over
  it and takes the scene's ink, so light skins look the same): a starfield sky with a soft glow behind the orb, drawn
  in a canvas like the concept's `drawSky`.
- The **orb** at 46% height, following the take (`voice` events: listening rings, a faster spin while sending, one
  sharp ring when a command take ends or a new thread turns Ready) and the mic level (`api.orb.onLevel`). Click = talk
  (a new chat; click again to send). Hold = a local command (release runs it).
- Its look is a **Style × a Colour**, picked in a quiet **Look** button (live previews of every style in the chosen
  colour; Esc or a click outside folds it), kept per device (`api.storage` `style`, `colour`). v7 (Miguel: "Plasma is
  my favourite; that quality or higher"): **eight styles**, each a small WebGL fragment shader in
  `web/layouts/orb/styles.js` on one shared offscreen GL context (copied onto each 2D canvas): **Plasma** (the v6 cloud,
  now drawn per pixel with a fine warped-noise texture), **Glass** (a lit glass sphere: a refracted warped nebula, a
  Fresnel rim, two highlights), **Oracle** (the glass with the concept's calm face), **Chrome** (liquid metal: a
  wobbling blob reflecting a banded studio sky with chromatic fringes), **Marble** (polished stone: ridged-noise veins,
  a cloudy body, gloss and light glowing through it), **Sun** (boiling granules, limb darkening, a streaming corona),
  **Planet** (a lit banded gas giant with a storm, an atmosphere and a ring passing in front) and **Black hole** (a
  horizon, photon ring, Doppler-bright disc in front and its far side lensed over the top). Swarm, Hologram, Glitch,
  Crystal and Aurora were retired (below that bar); a device that wore one gets Plasma. No WebGL: canvas-2D Plasma /
  Glass / Oracle stand in. Cost: at most 640² shader pixels a frame (Plasma at half resolution), only in the one ~30 fps
  loop. Seventeen colours: Nebula (default), Ember, Tide, Gold, Mono, Emerald, Rose, Arctic, Marble, Obsidian, Bronze,
  Royal, Crimson, Cyber, Sunset, Ocean (four stops each, skin-layer tokens `--ob-look-*` in the tweak's `tweak.css`)
  and Skin accent. All drawn in-house (our own value noise / fBm, no vendored code); ideas from Teknium's Uncommon Web
  (Paper Shaders' Warp and LiquidMetal).
- **Satellites are status, not a launcher** (v7). Only apps **running** in the panel (shown, or closed and still
  running) and **regular apps with an unread count** float; nothing else. Regular = the shell's kinds
  (`WosAppKinds`): never agents, connectors, agent apps, system apps (`isSystem`: Files, Notifications, Transcriber,
  Browser, Secret Drop, ChatGPT, Claude…) or in-development apps (`inDev`). Nothing running and nothing new: just the
  orb. Every app stays one step away through the **search pill** at the bottom ("Search apps or ask…"): it opens the
  shell's launcher in its apps-first mode (⌥O; installed apps listed, type a name, ↵ opens it in the right third; no
  app by that name widens to ⌥Space to find a thread or ask). Also a command and the ⌥ letters.
  Each is **just its own mark** (no plate; a tile logo stays a tile, else its glyph in its own colour; never a letter),
  with the shell's own **count badge** (`api.apps.badges(watch)`; bigger on a badge-only app). On two tilted orbits,
  alternating rings at even steps, drifting slowly the same way; past what fits at 74% size the rest stay in the search
  pill (no All apps satellite). A click opens (or brings back) the app.
- **Apps are desks** (v8, Miguel: one-to-one with desks). An app opened in the Orbs view is a real desk with that one
  app on it, saved and synced like every desk, so looking away, a reload or another device never closes it; every
  desk with an app is one satellite (its focused app, else its first; desks opened in the Desks view float too), and
  the Desks view shows the same desks. Opening an app that already has a desk brings that desk back, never a copy.
  (Before v8 the app panel lived outside the desks, in memory only: a reload, or a tweak reload, which disposes and
  re-runs every tweak and so turned the panel off for a blink, closed every running app. A tweak reload or a layout
  load now holds the panel until it settles: `panelHold` in `core/skin-host.js`.)
- **Closing an app only hides it**: ✕, Esc or ⌥⇧A slide its panel away but its desk stays open and its window stays
  mounted out of sight (`panel-parked`: frame alive, music keeps playing, still counted as open for its mic), and its
  satellite keeps a soft halo on its own mark and a tiny dot under it, never a ring or plate around it (three tiny
  bars in the dot's place while a same-origin audio/video element plays). Its satellite, a
  command or opening it again brings it back exactly as it was. **Right-click a satellite**: Open, Close (Close closes its
  desk: `api.panel.quit(id)`; the satellite leaves). Turning the Orbs view off keeps them: the Desks view shows the
  same desks (each app's page reloads once as it moves between the views).
- **Commands (⌥C, or hold the orb)** are the orb's own (v7): the same on-device grammar as everywhere
  (`core/commands.js`, never sent to the agent; a tap is still a message). The orb tightens into a brighter core inside
  a turning ring, the caption under it says what it is doing ("Say a command · let go or ⌥C to run it", then "Working
  it out…"; the words appear once transcribed: there is no live interim transcript), and the result lands there:
  an opened app's satellite pins and the bolt runs to its panel ("Opening Music"), music says "♪ Now playing · …", no
  match says "No command for “…”" with **↵ ask <agent> instead** (Enter or a click sends the same words as a new chat,
  `api.voice.ask`). No toast and no bar voice pill for it here (`api.voice.onCommand`; `html.voice-cmd`).
- Under the orb: only a caption line while a take runs (no name label: the orb is the entity). The real keys are the hint line near the
  bottom: `⌥V` to talk (new voice chat; `Right ⌘` in the Mac app) and `⌥N` to type (new chat). The fuel gauge and the
  gear stay top right; the Desks | Orb | Apps switch sits in the bar's centre.
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
- **An app opens in the right third** (a satellite, the search pill, a link), one at a time (another replaces it, with ‹);
  ✕, Esc or ⌥⇧A hide it (it keeps running, see below). A chat and an app can be open together.
- **The orb powers what is open.** The open app's satellite stops drifting and pins between the orb and its panel
  (an app with no satellite gets one while it is open); an electric bolt in the orb's colour runs orb → that icon →
  the panel's edge, and a quieter one orb → the chat column. Jagged arcs with a glow, a second and third strand,
  short forks and a spark running along them, re-struck about ten times a second on the sky canvas in the same
  ~30 fps loop; reduced motion = one still glowing arc. Closing the panel lets the icon go back to its orbit.
- **Resizable:** thin grips on the inner edges of the list, the chat column and the app panel (drag, or ←/→ on the
  focused grip; double-click or Enter = back to the default; kept per device in `widths`; list 260-520 px, chat
  360 px-45vw, app 360 px-60vw; never overlapping; the orb stays put).
- The **Look** picker sits at the bottom of the orb area, right of whatever is open on the left.
- **Keys** (v7; none of them a desktop binding; on their things in the ⌥/ guide via `api.keys.guide`):
  | Key | Does |
  | --- | --- |
  | ⌥\\ (or the handle on the list's edge) | list open ⇄ folded to a slim strip with the Ready count (from wide: back to open) |
  | ⌥⇧\\ | list wide (to the orb's edge; the orb stays put) ⇄ open; a chat opened meanwhile uses the usual width |
  | ⌥⇧C | close the chat column |
  | ⌥⇧A | hide the app panel (it keeps running) |
  | Esc | the top thing: the menu / Look popover / caption, then the panel holding the keyboard (else the chat, then the app) |
  | hold **left** ⌥ (~300 ms, no other key) | every floating app shows a bare letter and the others show theirs in a quiet row under the orb; that letter (⌥ still held) opens the app, over the desktop's own ⌥ keys only then. Released, any other key or a blur: gone at once. Right ⌥ never shows them; a quick ⌥V / ⌥C keeps its meaning. One plain letter per app (its name's first free letter), kept per device (`keys`), collision-free (`keys.js`) |
  | ↵ | after a command with no match: ask the agent instead |
  Fold, wide and widths are kept per device.
- **No desks.** The workspace numbers are gone and desk keys do nothing (⌥1…9, ⌥[ ⌥], moving windows, full screen,
  ⌥P); ⌥T just offers the apps. Desks are still the model underneath (an app = a desk, above); turning the Orb off
  shows them (and the desk you were on).
- Motion: one ~30 fps loop, only while the scene is in front and the page is visible. Reduced motion: still frames.

## Phone (experimental, 31 Oct 2026)

The same tweak and the same layout: `layout.js` hands the phone shell to `phone.js` (+ `phone.css`, loaded by it), and
the view is switched on in Settings › Look › Tweaks. Per device, no reload.

- **Home** shows the desktop scene: the same sky, the same orb in the device's stored Style × Colour (no picker on the
  phone yet: Glass · Nebula unless chosen on that device), the same status satellites, and Home's own top (which
  Wizard, Desks | Orb | Apps, the fuel gauge, the gear for Settings). The stock Home content and the other machines-home tiles
  are hidden from the first frame (`orb-shell/tweak.css`), with the night sky as the placeholder.
- **One source with the desktop** (`shared.js`): `lookOf`, `palettes`, `starsFor` / `paintSky` and `orbitApps` (which
  apps float). The phone adapter (`app.js`) answers the same layout calls: `apps()` (the desktop's row shape and kinds),
  `panelRunning()` (the app on each desk, one per app) and `route().home`. So when the desktop's satellites change
  (`orbitApps`, or what `api.panel.running()` means), the phone follows.
- **Simple Home (1 Nov 2026)**: the orb is FIXED in the middle of Home (it only slides with the Home desk; it never
  flies to the dock and back, a take included). The satellites are plain still buttons (48 px) on one ring clear of
  the orb: tap = open that app (its desk). One big Chats pill (56 px) under the orb, where the dock sits, with the Ready
  count, opens the stock Chats list. No bottom bar on Home (the stock dock steps aside there only), no spin, no bolts:
  Miguel found the three-slot bar round (orb jumping between centre and bar, tiny corner targets, spin fighting swipes)
  impossible to use. Off Home everything is the stock phone, with the dock orb drawn in the same look by `phone.js`
  inside `#orbWrap` (the stock drawing steps aside while `html[data-orb-phone]`). The stock gestures stay on the dock
  orb: a press on the centre orb is handed to `#orbWrap` as it starts (same pointer id), so tap, hold and the swipes are
  the dock orb's own (the hidden dock still takes it: dispatched events need no hit test).
- **Hold for a command** (core, every view): a press held still on the orb for 90 ms opens the browser mic early
  (`warmMic`, only once the mic is known to be allowed, never with the native recorder), so the take that starts
  (a 380 ms hold = command, or a tap = message, unchanged) records at once; any other end of the press closes it.
- Layout-only hosts: `api.phone.home()` (the Home desk section; the sky lives there and slides with the desks),
  `api.phone.orb()` (the dock orb's box), `api.phone.desks()` (one `{ desk, id, name }` per desk) and
  `api.phone.mark(id)` (the dock's own mark for an app). Desks (the tweak off) removes every node and flag: the stock
  phone is back.

## Apps view (phone and desktop, 1 Nov 2026)

A third view, `miguel/apps-home` wearing the `apps` layout (`web/layouts/apps/`), picked with the same switch, which
reads **Desks | Orb | Apps** on both shells (three equal options, mutually exclusive: the switch asks every view tweak
that must change in the same turn, one tweak reload).

- **Phone:** Home becomes a standard phone home screen: a four-column grid of app icons, ONE per desk (each desk is one
  app) in desk order, each with its logo (else the dock's mark in its colour), its name and its live count; a tap opens
  that desk. Chats is always the first icon, with the Ready count, and opens the stock Chats list; a **+** tile ends the
  grid. Home's top stays (which Wizard, the switch, the fuel gauge, the gear).
- **Desktop:** Home is a launchpad over the wallpaper (`desktop.js`): one icon per open app / desk (logo, name, live
  count), Chats first, **+** last; a click opens that app's desk (the stock window, the full desk). Back to the grid:
  the round Back beside the orb or the shell's own Home key ⌥` (no new binding). The orb floats at the bottom centre on
  every screen (the shell's own orb drawing: click talks, hold commands, a sideways drag steps desks) and windows end
  above its row. The bar keeps the switch, the fuel gauge and the gear; the desk numbers step aside.

**View chrome shared by Orb and Apps** (`web/layouts/apps/chrome.js` + `chrome.css`, scoped to `html[data-view-chrome]`):

- Phone, Orb and Apps: the stock desk switcher (dots, scrub, pill glass) is gone on every screen; only the dock orb is
  left, at the same spot with its stock gestures. On Orb Home the centre orb is the orb (the dock fades out there).
- A round 48 px **Back** beside the orb (phone: in the dock row, left; desktop: left of the floating orb) on any opened
  app / thread / Chats screen; it goes Home (the ring in Orb, the grid in Apps).
- **+** (Apps: the grid's last tile; Orb: a small button beside the Chats pill) opens a sheet of every installed app not
  open yet: `api.apps.list()` (the stock picker's Apps group, `WosAppKinds.kinds().apps`: no agents, agent apps,
  connectors or in-development copies) minus Chats and every app open on a desk. A pick opens it on a desk of its own
  (`api.apps.openDesk`: the phone gives a new app its own desk; the desktop adapter's `openAppDesk` starts a fresh desk,
  or goes to the app's desk if it has one); it then shows as its own icon / satellite.
- Layout-only API added: `api.desks.list()` (one `{ desk, id, name }` per desk on either shell: phone `phoneDesks`,
  desktop `deskApps`) and `api.apps.openDesk(id)`.

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
- `api.desk.home()` (⌥`), `api.desk.look()` (Settings › Look), `api.desk.classic()` (back to the Desks view: switches
  off the tweak wearing the layout for this device, like its Settings switch; resolves false once the layout is gone), `api.desk.emptyHome()`: closing the last window of
  a desk goes Home instead of to another desk (`WosSkinHost.emptyHome`, read by `closeWin`); released on teardown.
- `api.desk.attention(watch?)` → `{ n, label }` or null: what the Settings cog carries (`WosBell.attention`, as on the
  phone's gear and the desktop's cog); `watch` follows `wizard:notify-attention`, released on teardown.
- `api.panel.claim()`: no desks while held (`WosSkinHost.panelMode`; the adapter's `panelMode(on)`). desktop.js then
  sends every new window to a panel (`panelOpen`): an app (a frame or a page) to its own desk shown in the app panel
  (`panelDeskShow`; its window lives in the panel layer while the Orbs view is on, so it never moves or reloads there);
  a Chats window or a built-in view to a panel window outside the desks (never synced). `findWin` sees only the
  panels; desk keys return early; Home stays in front. Released on teardown (after a tweak reload settles): the chat
  panels go, the apps' desks stay, and the desk in front before comes back.
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
- `api.voice.command()`: a local command take (⌥C); call again to run it. `api.voice.onCommand(fn)`: the layout draws
  the take; its result comes to `fn({ result: 'done' | 'miss' | 'silent' | 'kept', text, action, app, music })` instead
  of the shell's toast (`WosSkinHost.commandUi` / `commandResult`). `api.voice.ask(text)`: those words as a new chat
  (the launcher's `ask`, quiet). QA seam: `__wux.commandText(text)` runs a finished take's words (no microphone).
- `api.keys.on({ down, up, hold })`: every key the desktop gets (app frames too) before its own bindings (`down`
  returns true when used; `WosSkinHost.key` / `keyUp` from `onKey`); `hold: true` keeps the shell's own hold-⌥ chips off
  (`WosSkinHost.holdKeys`). `api.keys.guide(fn)` → `[{ el, key, word }]` chips added to the ⌥/ guide (`keyChips`).
- `api.panel.close('chat' | 'app')` closes that one (`panelCloseKind`). An app's desk always only hides on close
  (`panelPark`; opening it again shows the same window); `api.panel.park(on)` decides that for a built-in view;
  `quit(id)` closes the app's desk (`panelQuit` → `panelDeskClose`); `running()` →
  `[{ id, open, playing }]`. `api.apps.list()` rows also carry `system`, `dev`, `connector`, `agent` (the shell's kinds).
- `api.orb.ready()` loads `orb.js` on a page without it (desktop), so `api.orb.create` works there;
  `api.route().home` is true while Home is in front.

Tests: `tests/orb-layout.test.mjs`.
