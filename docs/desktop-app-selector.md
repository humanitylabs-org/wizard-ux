# App icons and the desktop app selector

James asked for three things: a keyhole on the private agent hat that you can actually see, an Agents icon that can't be mistaken for the private agent, and a desktop app selector that opens on every new desktop. This note records the design; Hermes holds the QA evidence.

## Private agent hat (`hat-private`)

- The outer silhouette is the supplied company hat, pixel for pixel, on the same 1394×1876 canvas. Ink bounds match the main hat exactly. CSS sizes both with the same rule (`mask-size: auto 62%`), so the private hat is always the main hat's size.
- The door is filled and a keyhole is cut in its place, on the door's axis (x = 704):
  - head: a circle of radius 250 centred at y = 1245, so 500 px across (the old one was 200)
  - stem: a trapezoid from y = 1390 (120 px half-width) to y = 1676 (180 px half-width)
  - sill: 200 px of solid hat stays under the keyhole
  - walls: at least 190 px of hat remain on each side
- The cut is about 36% of the hat's height and 55% of the body's width at that height. The round head and closed sill keep it from reading as the main hat's open, pointed door.
- **Optical size step for tiny tiles.** Tiles of 24 px and under draw the whole hat family (main, private and Agents together) at 80% of the glyph box instead of 62%. These are window bars, phone window icons, Home chips, ⌘K rows, xs agent chips and thread badges. Main and private stay the same size as each other, and the supplied geometry only scales.

  | Tile | Hat height | Keyhole head | Walls |
  |---|---|---|---|
  | 16 px | ≈ 9.0 px | ≈ 2.4 px | ≈ 0.9 px |
  | 18 px window bar | ≈ 10.4 px | ≈ 2.8 px | ≈ 1.1 px |
  | 22 px | ≈ 12.3 px | ≈ 3.3 px | ≈ 1.3 px |
  | 32 px (62%) | ≈ 13.9 px | ≈ 3.7 px | ≈ 1.4 px |
  | 48 px (62%) | ≈ 20.8 px | ≈ 5.5 px | ≈ 2.1 px |

  Bare dock and bar marks (`.dsg`, 21 px) already draw the hat 13 px tall.
- **Floor at 16 px.** The keyhole can't be made more than ~2.4 px wide at 16 px. Its width is bounded by the hat's own body, which is about 4.4 px wide at keyhole height even at 80%, and that body has to keep a wall on each side. Going further would mean drawing the hat beyond its box or changing the supplied silhouette.
- Colour is unchanged: the agent's hue, green (`hsl(160 72% 62%)`) for the private agent by default.

## Agents app (`agents`)

- The mark is two supplied hats, layered. The main agent's purple hat (`hsl(265 72% 62%)`) stands in front, full size, with its door. The private agent's green hat (`hsl(160 72% 62%)`) stands behind and to the left, at 84%, solid, on the same ground line. About 83% of it stays visible, including its tip and right slope. Neither hat has a keyhole.
- A 100 px knockout gap separates the back hat from the front one. That is about 1 px on a 48 px tile.
- Both hats are alpha masks on one shared 2174×1876 canvas, so a single `mask-size: auto 62%` keeps them registered. The front hat's ink height equals the main hat's. The pair is 16% wider than it is tall.
- The tile glass is a quiet periwinkle, `#9BB1F5` (house tone: hue 270, chroma 0.10). It is neither the main purple nor the private green, so both hats read on it.
- It reaches every consumer through the house sigil registry (`WizSigil.of({ id: 'agents' })`): the phone launcher, dock and overview; the desktop bar, window headers, Home chips and the app selector.

## Desktop app selector

The app selector is a second mode (`data-mode="apps"`) of the existing palette box, so ⌘K is unchanged.

- **Opens with:**
  - ⌘O or Ctrl+O, which also prevents the browser's Open File
  - every new desktop: the + button, ⌘T, Ctrl+T, ⌥T, the next ⌥ digit, and the "New desktop" command
  - the "Open an app" command, and `?view=apps`
- **Never opens** on boot, on restore, or on ordinary desktop and Home navigation.
- **Empty desktops are reused.** If the current desktop is already empty, a new-desktop action reuses it rather than adding another blank.
- **Layout:**
  - the same 640 px card and search box, with "Search apps" focused
  - below it, a grid of square tiles, six columns of at least 96 px
  - each tile is a 56 px squircle sigil (the phone launcher uses 58 px) with its name under it, two lines at most
  - the selected tile gets the palette's violet wash and a 2 px light ring
- **Order:** Chats first, then installed apps in registry order, then Inbox, then Agents, System and App Store. A query ranks apps the way ⌘K's Apps group does.
- **Keys:**
  - ←↑↓→ move through the grid. The moves are spatial and reversible, and ↓ above a short last row lands on its last tile.
  - ↵ opens the selected app; ⇧↵ opens it in a new window.
  - With no matching app, ↵ widens to ⌘K and keeps the query.
  - ⌘K switches to full search and keeps the query. ⌘O again closes the selector.
  - ⌥ window-manager chords (⌥Enter, ⌥2…9, ⌥[ ], ⌥W, ⌥F…) close the selector and then act.
  - Esc, browser Back and a click outside close only the selector. Back keeps its existing owner.
- **Focus:**
  - Opening the selector remembers the focused element (after Resources hands focus back to its opener).
  - Closing puts focus back on that element: the same composer node, untouched.
  - If that element is gone, focus goes to the focused app, else Home, else the empty desktop's surface (a `role=region` element with `tabindex=-1`).
  - Launching an app focuses its window.
- **Tied to its desktop.** A selector opened by a new desktop belongs to that desktop. When an app lands there, or the desktop is left or closed, the selector steps aside.
- **Placement is unchanged.** Apps still open through `openApp`: an app that is already open is focused wherever it is, and an empty desktop left behind is pruned as before.
- **Accessibility:**
  - The card is a `dialog` with `aria-modal` and a mode-specific name: "Open an app" or "Search and launch".
  - The input is a named `combobox` ("Search apps", or "Search apps, threads and commands, or ask …") controlling `#palList`. `#palList` is a `listbox` of `option`s, with `aria-selected` and `aria-activedescendant`. In ⌘K mode each section is a `group` labelled by its heading.
- **Tab containment:**
  - The search box is the dialog's only tab stop. Options carry `tabindex="-1"`, and Tab and ⇧Tab are caught on `#palette`, so focus never reaches the page behind.
  - An option focused by a click or script is still a native button: ↵ and Space activate it. It takes the selection, and arrows or Tab return focus to the search box.
  - ⌘K, ⌘O, ⌥ chords and Esc are handled first by the shell's capture listener, so they behave as before.
- **Resources:** opening the selector closes the Resources sheet, which keeps its existing ownership.
- **Phone:** the phone's + and launcher are untouched.

## Generators

Run these on the build host with Pillow installed, then commit the PNGs:

```
python3 tools/sigils/private_hat.py   # web/brand/wizard-mark-private.png
python3 tools/sigils/agent_hats.py    # web/brand/wizard-mark-agents-front.png, wizard-mark-agents-back.png
```

`tools/sigils/build.py` (with `skia-pathops` and `fonttools`) regenerates `web/core/sigils.css` and `web/core/sigils.js`. Its outputs were edited by hand in parity with `style.css`, `sigils.template.js` and the `agents` house entry, so a rebuild should produce no diff.
