# AI apps view

An opt-in shell view for the phone and the desktop that copies the layout the ChatGPT, Claude and Perplexity apps
converged on, with Wizard's apps where they put Projects / GPTs / Spaces. Off by default: nobody's shell changes until
they switch it on, and switching it off brings the stock shell (Desks) back exactly.

## Switching it on

Settings › Look › Tweaks › **Different shell view - AI apps** (tweak id `miguel/ai-apps`, by Miguel). It is an
ordinary off-by-default tweak, so anyone can turn it on, on any skin, with no other tweak needed. Shell views are one
at a time: turning it on turns Orb and Apps off; turning it off goes back to Desks. The choice follows the owner's Look
(per owner when look sync is present, per device otherwise).

## What it looks like

Phone (`web/layouts/ai-apps/layout.js`, `layout.css`, `home.js`):
- Top bar: ☰ (with the Ready count) · Home · the workspace switcher. An edge swipe or ☰ opens the left drawer.
- Drawer: search (chats and apps), the chat list in the stock Chats sections (Archive, Working, Snoozed, Ready; a long
  press gives Pin, Rename, Mark unread, Snooze, Archive / Restore through Chats' own actions), New chat at the bottom.
- Main screen: the chat, edge to edge, with the stock composer as a pill (+ · field · model chip · the orb as the mic ·
  Send). Home = a New chat with no greeting.
- Home: the pinned apps live in a dock just above the composer (a subtle glass plate from skin tokens, up to 2 rows ×
  4 icons at the grid's size, names under; more than 8 pins page sideways with dots; it steps away while the composer
  is typed in). The grid above shows only the open apps that are not pinned, then + = a picker of installed apps
  neither pinned nor open (For people / For agents; Get more opens the App Store); nothing else open = just +. Hold and
  drag within the dock, within the grid, or between them (into the dock pins it at that spot, out of it unpins); a hold
  without moving = the app's menu (Pin / Unpin, …). Every open app wears a 4 px running dot; a pin not open has none.
- Under +: "Unused apps close after 24h · Change" opens a sheet with the tidy sentence (below). A tidy shows a toast
  "Closed 3 apps you hadn't used in 24 hours · Undo".
- Drawer Ready: in the stock Chats Filter order (Priority / Newest / Oldest, the control on Ready's header; the desktop
  offers only Newest / Oldest inside each status group, below).
- An app fills the screen under the same top bar; the orb sits in the app's own bottom row (Orb bar standard).
- A take (tap the orb) uses the stock voice controls, painted with the skin's tokens.

Desktop (`desktop.js`, `desktop.css`):
- Left: the chats sidebar (search, sections, New chat), foldable to a 52 px rail of counts (Snoozed, Ready and Ready's
  statuses). The open sidebar is built on the rail: Ready's count sits on its header (the rail's amber disc, none on
  ◫), Ready is grouped by the rail's statuses (sub-headers with counts, its chats under each in the chosen order),
  Snoozed shows only when it holds chats, and the headers sit at the rail items' heights, so folding only widens or
  narrows. Headers and status sub-headers are small and muted (12 / 11 px, normal weight; Archive the quietest); only
  Ready's amber count stands out, so the chat titles lead.
- The folded rail works on its own (nothing expands but ◫): a click on Snoozed, Ready or a status opens that group's
  first chat in the docked chat column; the same item again opens the next one (wrapping). The current group is marked
  and shows its place ("2/3"). Hovering an item for 300 ms shows a flyout of its chats (title, time); a click opens one;
  Esc closes it. Nothing advances on send (stock has no such setting).
- Order inside each status group (the grouping already is the priority): Newest first / Oldest first in Settings ›
  Chats & app screens › AI apps view, saved where stock Chats keeps its order (`api.sessions.order / setOrder` →
  `wos.chats.readyOrder.v1`; a stock Priority or By subject reads as Newest here). "Show sort control in sidebar"
  (off at first) adds a small Newest / Oldest menu on Ready's header. The group is mounted through the layout API's
  `desk.setting(id, node)` (core/skin-host.js).
- Middle: the chat in a centred column with the composer.
- Right: one apps column = Pinned · Open · + (drag to rearrange; ⌥1–⌥0 and ⌥[ ] through the shell's own key guide). An app
  opens as a panel beside the chat; panels resize by grips. An open pin wears the same 4 px running dot as the phone.
  At its foot a small "Tidy: 24h" line expands into "Tidy up: close apps you haven't used in [24 hours ▾]. Pinned apps
  always stay open." (Off / 12 hours / 24 hours / 1 week).

## Keys (desktop)

One base key, ⌥ (Option / Alt), plus one mnemonic letter; ⇧ only for the reverse of a plain key (round 21). Hold left ⌥:
a small keycap sits ON each thing a key acts on, where it is (icons and buttons at their top-left corner, the next /
previous Ready rows at their start, app rows 1–9 / 0 on the icon, [ ] on the rows they go to). No legend card and
nothing in the middle; a key with nothing on screen to point at (⌥V, ⌥C) has no keycap. App count badges step back while
⌥ is held. With the app picker or Settings in front only its own key (⌥A, ⌥S) and Esc work; its ✕ wears that key.

| Key | In the AI apps view (keycap on) |
| --- | --- |
| ⌥H | Home: both sides, the chat and the app away; again = back exactly as it was (the workspace name; ◫ at the top left while away). ⌥` the same |
| ⌥O | Workspaces (the ▾ next to the name) |
| ⌥K | Search chats and apps (🔍) |
| ⌥L | Fold / unfold the left sidebar (its ◫); Ctrl/⌘⇧S too |
| ⌥N | New chat (+) |
| ⌥S | Settings (the cog); again closes it |
| ⌥↓ / ⌥↑ | Next / previous Ready item as the sidebar draws it, notification rows included (on those rows; folded: on the rail word holding it) |
| ⌥1–⌥9, ⌥0 | The first ten apps in the right column (on each icon) |
| ⌥[ / ⌥] | Previous / next app, wraps; every row past ten (on those rows) |
| ⌥⇧[ / ⌥⇧] | Move the app in front up / down |
| ⌥A | Add an app (the + row); again closes the picker |
| ⌥T | Tidy (the Tidy line) |
| ⌥P | Pause what played last in any app; again plays it (Now playing tweak: the small bars on that app's icon in the apps column) |
| ⌥R | Fold / unfold the right apps column (its ◫) |
| ⌥W | Close the app in front (a pinned one hides), else the docked chat / notification (✕ / —) |
| ⌥F | App wide / back to the side (⤢) |
| ⌥− / ⌥= | App narrower / wider (the panel's edge) |
| ⌥← (⌥Z) | Snooze the item in front (Snooze); ⌥← again in the snooze sheet = Someday |
| ⌥→ (⌥E) | Archive it, then the next Ready item opens (Archive) |
| ⌥X | Resolve the notification ("Have <agent> handle it"), then the next |
| ⌥B | Where this app's notifications go (the "From … · shows in …" line) |
| ⌥Space | Talk (the orb) |
| ⌥D | Dictate into the box (the composer) |
| ⌥V / ⌥C | New voice chat / command (the shell's own; no keycap) |

Every other ⌥ key does nothing here (no ⌥G letters, no ⌥/ pinned guide, no app letters, no desk keys), so
nothing acts unseen on a hidden desk. While typing, ⌥E / ⌥U / ⌥I and ⌥← / ⌥→ stay the field's (accents, word jumps).
Everything else in both panels (the Archive / Working / Snoozed / Ready headers, every chat row and its ⋯) is a plain
button Tab reaches, in order, from ⌥K's search; the right column's rows are ⌥1–⌥0 and ⌥[ ].

Ready is one flat list in priority order by default (a tiny muted tag on Needs you / Your call rows); Settings › Chats
& app screens › AI apps view › "Group Ready by status" brings the per-status sub-headers back. Notification rows wear a
small amber bell and amber unread dot (folded per app, e.g. "Money (48) · …"); an opened notification reads as a quiet
thread (`--wos-note-quiet`): its source line, a thin amber edge, and one muted "From X · shows in Chats ▾" line whose
menu is the shared `WosBell.picker`.

## How it is built

- The tweak only calls `api.layout.use('ai-apps')` (`web/tweaks/miguel/ai-apps/tweak.js`); everything else is the
  layout, loaded only while worn (`html[data-layout="ai-apps"]`).
- It reads the shell through the layout API in `core/skin-host.js` (adapters in `web/app.js` and
  `web/desktop/desktop.js`): `sessions.*` (list, open, newChat, act), `apps.*` (list, kinds, logo, badgeText, open,
  openDesk, close, inset, store, get, homeScreen), `desks.*` (list, close, move), `workspaces.*`, `voice.*`, `orb.*`,
  `keys.*`, `phone.*`, `gesture.*`, `storage.*`. These hooks are inert unless a layout is worn.
- The app picker is the shared view chrome (`web/layouts/apps/chrome.js`, `viewChrome().open({ exclude, people })`),
  grouped by `WosAppKinds`.
- Per-device state (the layout's own `api.storage`): `pins`, `vtManual`, `used`, `tidy`, `sections`, `folded`,
  `tabsFolded`, `widths`, `appKeys`.

## Skin rules

- Colours come only from skin tokens (`--wz-*`, `--ink*`, `--bg`, `--sk-*`, `--amber`, `--line*`); the only literal
  colours are colour-neutral shadows/scrims (`color-mix(... black N%, transparent)`) and the white glyph on a full-colour
  app tile. `tests/ai-apps-view.test.mjs` checks the desktop CSS for literals.
- Light skins (`-light` ids and Sepia) get full-colour app tiles with white glyphs; dark skins keep tinted plates.
- The skin background must stay still and unveiled behind the view (`tests/skin-background-stable.test.mjs`).
- Every change is checked on a dark and a light skin, phone and desktop, before it ships.

## Tests

`tests/ai-apps-view.test.mjs` (layout behaviour in a fake DOM), `tests/shell-view-setting.test.mjs` (one view at a
time), `tests/skin-background-stable.test.mjs`, `tests/tweak-packages.test.mjs` (the tweak contract), and
`tests/voice-controls-skin.test.mjs` (the take's controls follow the skin; separate fix PR).
