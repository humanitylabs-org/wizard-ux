# Opus design notes: sample app styling candidate (12 Oct 2026)

**Scope.** This changes colour, background and surfaces only, on the existing anatomy of four apps. Fonts, sizes, spacing and markup are the same in both comparison modes. The shell itself is unchanged: orb, gestures, title bars, window anatomy and every `core/*` / `app.js` file are untouched.

**Not done here.** No tests, builds or browsers were run by this author, because there was no shell access. The parent runs all QA on Thales. No visual QA is claimed.

## Files

| Path | What |
|---|---|
| `web/demo/apps/{wisdom,music,signal,topics}.html` | Fixture pages: `data-app` = `wisdom` / `wizard-music` / `wizard-signal` / `topics`; each loads `../theme-client.js` + `../ui.css` |
| `web/demo/apps/*.css`, `*.js` | Each app's own colour layer + interaction |
| `web/demo/apps/shared/fixture.js` | Bounded shared harness: Back contract, standalone sentinel, `?comparison=` for standalone tabs |
| `web/demo/preview-boot.js` | First script: phone shell, sample registry/desks, read-only + no-mic guards |
| `web/demo/preview-controls.{css,js}` | Preview pill and sheet: skin, comparison, open |
| `web/index.html` | Candidate wiring (see below) |
| `web/data.js`, `web/summaries.js` | Empty fixtures (both gitignored) |

## Colour-only mapping

Each stylesheet first maps the app's **own variable names**, taken from its source, to the Wizard tokens. Every rule then reads only those app variables. `html[data-comparison="original"]` re-points the same variables to the shipped palette. No selector differs between the two modes.

| App variable(s) | Unified ← token | Original (shipped) |
|---|---|---|
| `--bg` (Wisdom, Signal, Topics, Music) | `--wz-canvas` | `#0d0c0b` / `#000` / `#06040f` / `#0f1014` |
| `--raised`, `--bg-raised`, `--card-2`, sheets/toasts | `--wz-surface-raised` | `#1a1816` / `#16181c` / `rgba(32,22,66,.86)` / `#16171d` |
| Topics `--card` | `--wz-surface` | `rgba(22,15,46,.72)` |
| `--ink`, `--text`, `--wb-ink` | `--wz-text` | `#e7e9ea` / `#ebecf2` / `#f4f0ff`, Wisdom page ink `#ece6dc` |
| `--ink2`, `--text-2`, `--ink-2` | `--wz-text-secondary` | per app |
| `--muted`, `--text-dim`, `--ink-3`, `--wb-mute` | `--wz-text-muted` | per app |
| `--line`, `--line-strong`, `--line-2`, `--wb-edge` | `--wz-border` (hairlines at ~55–70%) | per app |
| `--accent`, `--wb-gold`, `--wiz`, `--cyan`/`--violet` | `--wz-accent` | Wisdom gold `#e8b46a`, Signal blue `#4aa8f2`, Music `#a48bfa`, Topics cyan/violet |
| `--accent-ink`, Topics `--on-hi` | `--wz-on-accent` | per app |
| `--accent-soft`, `--wiz-soft`, Topics `--hi-soft` | `--wz-accent-soft` | per app |
| Wisdom `--wb-paper` (reader page) | `--wz-reader-surface` | `#0d0c0b` |
| UI sans | `--wz-font-ui` in **both** modes | (same system stack as shipped) |

**Kept fixed in both modes:**
- **Content and meaning.** Album art, topic-group swatches, avatar tones, and status green/amber/red. On light skins the status colours darken a little.
- **Anything painted on photographs or dark shades.** That covers hero/cover/opener text, the cream `wb-primary` pill and the round reader buttons. They sit on imagery, so they keep the on-image palette.
- **Wisdom's no-portrait plates** (`--wb-noart`, `--wb-initial`) stay dark and are only *tinted* by the accent. Covers therefore read as art in every skin.

**Light skins (Paper).** These are handled by tokens plus `html[data-color-scheme="light"]`:
- Wisdom's book-hero fade ends in a dark tone instead of the cream page, so white hero text never sits on cream.
- Status colours deepen.

**Own canvas in every presentation.** Each app paints its own root background, overriding `ui.css`'s window-mode transparency for that app only. The reason is the shell's `.appframe`: it paints a fixed `#0f1014` behind the document. A transparent page would put Paper's dark ink on near-black. **The parent may want to revisit this in `ui.css` or `styles.css`.**

## Why the comparison works this way

`original` and `unified` render the *same DOM, type and sizes*, so a reviewer sees only the palette change. Unified does not flatten identity:
- Wisdom stays a serif editorial library with a full-page paged reader.
- Music keeps the artwork shelf, rows and persistent mini player.
- Signal keeps the dense hairline timeline.
- Topics keeps the edition/panes/sheets.

Identity carries through **structure, type, imagery and app semantics**; the skin decides only what colour those surfaces are.

## Source structures retained

**Wisdom** (`static/wisdom.js`, `wisdom.css`, `collections.css`, `app.css`):
- `--serif: Georgia,"Iowan Old Style",Charter,"Times New Roman",serif`, exact.
- `--wb-text`/`--wb-display` resolve to it. The WB web fonts are not shipped, which is the same fallback the source uses.
- Kept: hero, Currently reading, Suggested shelf of 2:3 poster covers with New/form tags, search, picks, library view tabs, `wb-row` cards with Star/Done/Archive, and the Browse grid (Books/Thinkers/Themes).
- Kept: collection page (`wb-book-hero` + `wb-toc` episodes).
- Kept: the full-screen paged reader using the shipped `layout()` (one CSS column per page): opener → epigraph → text pages → end page (rating, next chapter, star), progress bar and page counter. Swipe/tap/arrow keys turn pages; A−/A+ resizes the text.

**Music** (`MusicApp.tsx`, `music.css`, `app.css`):
- `music-shell` head and the sticky `music-search`.
- Sources strip, station chips, Recently played `music-shelf` tiles, Liked and "On your Wizard" `music-row`s with Play next.
- `music-mini` persistent player.
- `music-now` dialog: hero art, seek, thumbs/prev/play/next/like, Played toggle, Up next.

**Signal** (`static/app.js`, `social.css`, `signal.css`):
- Sticky topbar with the `connection` pill (here: "Sample feed").
- For you / Latest / Discover tabs and platform/channel selects.
- `post` rows with context line, avatar, head, platform pill, curation note, depth tiers + markers, and actions.
- Sources list with Following/Paused and health; You settings; bottom nav; Add-source FAB; sheet modal.
- Additions: a **post detail** view (tap a post) and a **channel** view (tap a name). Both use the same `post` markup.

**Topics** (`web/app.js`, `styles.css`):
- Fixed top, three swipeable panes (Today/Following/Archive) and bottom tabs.
- Edition head, sections, `card`s with Useful/Not useful and reasons, and Earlier editions.
- Following search + grouped `trow`s; Archive search + filter chips.
- Topic, item (report/detail with deep dive), day and follow sheets.

## Back contract (fixtures)

`window.__wizardCloseOverlay()` (and its alias `__wizardBack`) returns `true` only when the app took a nested step; at the app's root it returns `false`. Every step changes what `frameSig()` reads, so the legacy 180 ms check agrees:

| App | Back sequence | What changes in `frameSig()` |
|---|---|---|
| Wisdom | reader → library | `<h1>` changes (library has a visually hidden "Wisdom library" h1) |
| Wisdom | browse / collection / library tab → previous | `<h1>` changes |
| Music | Now Playing → home | `[role=dialog]` count |
| Signal | sheet | dialog count |
| Signal | post / channel | `<h1>` + `aria-label="Back to …"` |
| Signal | tab route → feed | `<h1>` |
| Topics | open reasons | `.reasons.open` count |
| Topics | sheet stack | dialog role toggles; back label "Back to …" changes |
| Topics | pane → Today | `<h1>` gains a visually hidden " · Pane" suffix |

- **Hosted:** no history entries at boot and no CloseWatcher in the app; the shell arms its own.
- **Standalone tab:** a root sentinel + CloseWatcher. The first Back at root shows "Press back again to exit" and stays; only a second Back within 2 s leaves.

## Candidate index decisions

- **`core/shell.js` not loaded.** `preview-boot.js` sets `WIZ_SHELL='phone'` instead, so the phone shell holds at any width without writing the sticky `wux.shell`.
- **`core/tour.js` not loaded,** and `wos.coached` / `wos.tour.v1` are set.
- **`pwa-install.js` and the manifest not loaded.** On a shared origin they would register the production `sw.js` at `/wizard-os-home/`.
- **Added:** `core/skins.css` and `demo/preview-controls.css`. `core/skins.js`, `demo/theme-host.js` and `demo/preview-controls.js` load right after `app.js`.
- **Seeding:**
  - `wux.apps.v1` is seeded on every load with the four fixture ids/URLs under `/wizard-os-home/demo/apps/`.
  - The desk strip (Home · **Wisdom (in front)** · Music · Signal · Topics, no remembered frame URLs) is seeded once per preview version or on `?preview-reset`.
  - Before the first seed, the existing layout keys are copied to `wos.preview.backup`; `WosPreview.restore()` puts them back. No other storage is touched.
- **Safety guards (preview only):** `fetch` with any method other than GET/HEAD is refused, `sendBeacon` is off, and `getUserMedia` is refused. The orb therefore cannot record or send. Each refusal is listed in `WosPreview.refused`.
- **Preview controls:**
  - A 16 px "Preview" pill in the free band above the title bars. It is hidden in immersive mode and in the desk overview.
  - It opens a sheet of 44 px controls: six skins via `WosSkin.set(id)`, Unified/Original, and Wisdom/Music/Signal/Topics/Architecture.
  - Comparison dispatches a cancelable `wizard:comparison`, sets `html[data-comparison]`, and calls `WizardAppearance.setComparison()` unless the event was claimed.
  - Open dispatches a cancelable `wizard:open`. If nobody claims it by the next task, it runs through the shell's own deep-link route (`?open=<id>`), or `__wos.openLinkDesk()` for `demo/architecture.html`.
  - On boot, unless the URL carried `?open=`/`?session=`/`?view=`, the Wisdom desk is brought to the front.

## Known issues / for the reviewer

1. **Small pill hit area.** The pill's touch area is about 17 px tall, because it must not reach into the 18 px band above window title bars; it is about 100 px wide. The 44 px controls are inside the sheet.
2. **The fetch guard also blocks the shell's own writes.** Typed or voiced sends land in the outbox as failed. This is intended for a read-only preview.
3. **Shared-origin storage.** If the preview is served on the same origin as production, the seeded `wos.*`/`wux.apps.v1` keys are shared. The backup and `restore()` mitigate this, but a separate origin is safer.
4. **Back with the preview sheet open.** Without CloseWatcher, Back closes the sheet *and* takes the shell step.
5. **Minor source deviations:**
   - Wisdom's end-page rating button is renamed `.wb-thumb-btn`, to avoid the shipped `.wb-thumb` name clash with row thumbnails.
   - Wisdom omits the request-a-collection block and the mic buttons, Signal omits the video player, and Topics omits starting deep dives or follows. Anything that cannot work is either absent or a disabled control labelled "sample only".
   - A few Topics controls gained `min-height` for touch.
6. **`demo/architecture.html` belongs to the parent.** If it is missing, the Architecture shortcut opens a link desk showing the server's 404.
7. **Sample content:**
   - Meditations is the George Long translation (public domain, lightly abridged).
   - The Spinoza quotation is Elwes, 1883.
   - Everything else is sample prose, invented records, posts and topics written for this preview, labelled in place.
