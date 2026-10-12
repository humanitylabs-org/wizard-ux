# Opus round 2 review: Thales shell screenshots (12 Oct 2026)

**Verdict: targeted REVISE, one CSS correction (Preview pill on phone viewports).** I accept everything else as rendered. No app layout, palette or token mapping changed in this round.

## Evidence I read

Image review of the following files in `docs/evidence/round1-shell-shots/`:
- `shell-entry.png`, `shell-desktop.png`
- `wisdom-shell-{nebula,paper,original}.png`
- `music-shell-{nebula,original}.png`
- `signal-shell-nebula.png`
- `topics-shell-{nebula,paper}.png`

I ran no browser and no tests. Hermes rerenders these on Thales.

## Findings

### 1. Preview pill on mobile: REVISED

**What the screenshots show.** On mobile, the pill sits top-centre under the host's yellow `STAGING · app-styling` badge, and only its outline peeks out. On desktop it shows correctly below the status bar (`PREVIEW ▾`).

**Cause.** With no status bar, the band above the windows is only `--safe-t + 10px` tall. Its centre is the same slot the host badge takes.

**Change** (`web/demo/preview-controls.css`, one new media block, only when the status bar is absent: `not (min-width:560px and min-height:700px)`):
- `.pv` is anchored at `left:14px; top:var(--safe-t)` with no centring transform. It sits at the left end of the band.
- The pill is 13px tall with 8.5px type. Its hit extension goes ±14px sideways, starts at `top:0` and never extends downward.
- It overlaps at most about 3px of the window's top border. It stays clear of the app icon (y ≈ 16), the title text, the right-hand title-bar buttons and the orb/dock.
- `.pv-sheet` opens down-left from the pill: `left:0; top:18px; width:min(340px, 100vw − 28px)`. It stays on screen at 360–430px widths.
- The 44px sheet controls are unchanged. It is still hidden in immersive full screen and in the overview. The desktop placement is unchanged.

**Suggestion for the parent (not done here).** Show the staging badge only once, at the top level, not inside each iframe. The in-iframe copy crowds the top of each app: it sits between the Wisdom reader's ‹ and A− buttons, and over the Music/Signal/Topics header band. The left-anchored pill no longer depends on where the badge goes.

### 2. Wisdom Meditations opener: ACCEPT (faithful fallback)

- **The blank plate is the source's behaviour.** Shipped `wisdom.js` `img()` renders `<span class="wb-noart">` when an entry has no `art`/portrait. Shipped `wisdom.css:172` paints it as a dark radial plate, with the copy anchored at the bottom. Marcus Aurelius has no supplied portrait.
- **No art was added.** The six supplied JPGs are already attached only to their own samples: Smith, Spinoza, Russell, Korzybski, Avalokiteśvara and Black Mirror. Putting any of them behind Marcus would misattribute art.
- **What differs from Original is palette only.** Unified tints the plate with the skin accent (violet in Nebula, terracotta in Paper). Original keeps the shipped `#3a2c1c` amber plate. Geometry, the `--serif` Georgia stack, the 38–68px display h1 and the italic deck are identical across the three screenshots.
- **Optional for the parent.** To show the portrait path in evidence, open `Ethics` (Spinoza) or `The Wealth of Nations` (Smith) from the shelf. I did not change the default entry, because the Back smoke expects `Begin the morning`.

### 3. Paper: dark reader cover vs cream Topics: ACCEPT, no token change

- **The reader body already uses the token.** `--wb-paper: var(--wz-reader-surface)` (`wisdom.css:25`), and `theme-host.js` supplies `#fffdf8` for light skins. Text and end pages and the top fade therefore go cream in Paper, with ink from `--wz-text`.
- **Only the opener and on-image chrome stay dark.** The opener is a cover: art or the no-art plate, with white on-image ink, as shipped. Flipping it to cream only when a portrait is missing would create a second opener palette that Original lacks, and would break palette-only parity.
- **The Paper shot is on-skin.** It reads as a warm terracotta-tinted cover inside a cream window chrome, with cream pages after the swipe.
- **Residual.** No Paper screenshot of a *text* page exists yet. Hermes should capture page 3/6 in Paper to confirm cream page / dark ink.

### 4. Source parity: ACCEPT

- **Music:** title, sticky search, Sources strip (horizontal scroll, so the clipped second chip is expected), station chips, Recently played art shelf, Liked rows with Play next, persistent mini player with progress. Unified (Nebula) and Original differ only in surface tint.
- **Signal:** sticky topbar with the `Sample feed` pill and refresh, For you/Latest/Discover tabs with indicator, platform/channel selects, hairline `post` rows (context, avatar, head, platform pill, curation note, actions), Add-source FAB, and Feed/Sources/Saved/You bottom nav. This is checked against source `app.js`/`social.css`/`signal.css`. The baseline screenshot is a loading state and is not used as proof.
- **Topics:** brand head with followed/paused meta, edition kicker + date + summary, section rows, cards with source, title, body, Useful/Not useful and deep-dive/details, Follow FAB, and Today/Following/Archive tabs. Paper turns properly cream.
- **No homogenisation:** the four layouts stay distinct (editorial cover reader, media shelf + player, dense timeline, edition cards). No features were added in this round.

### 5. Bridge, Back and architecture: ACCEPT; one stale note

- **Bridge.** `WizardAppearance.setComparison()` is the live route. My `wizard:comparison` event stays as a cancelable fallback with no consumer, which is harmless.
- **Back.** `__wizardCloseOverlay` returns true on a nested step and false at the root, matching the parent's smoke run (reader → `Wisdom library`, stays in the shell).
- **Stale note.** Known issue 6 in `opus-design-notes.md` ("`demo/architecture.html` may be missing") is out of date. The parent's `architecture.html` and `ARCHITECTURE.md` now exist, so the Architecture shortcut opens a real page.

## Residual issues

1. **Small pill.** The pill's touch target is still under 44px tall, because the band is 10px. It is reachable but small, and the 44px controls are in the sheet.
2. **Staging badge inside iframes.** It covers app headers. This belongs to the parent server.
3. **Unverified Paper reader page.** A Paper text page has not been screenshotted yet (see 3).
4. **Back with the sheet open.** This is unchanged from round 1 (notes, known issue 4).
