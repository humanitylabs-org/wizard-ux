# Wizard Motion Kit v1

The Live Mode feel (approved by James, 9 Oct 2026) as one small, dependency-free JS + CSS kit, so every Wizard surface moves the same way.

**Stable URLs (private, tailnet):**
- `https://legacy.wizard.example/wizard-os-home/motion/wizard-motion.js`
- `https://legacy.wizard.example/wizard-os-home/motion/wizard-motion.css`
- Live demo of every primitive: `https://legacy.wizard.example/wizard-os-home/motion/`

**Source:** `/home/developer/apps/wizard-os-home/web/motion/` (git: `/home/developer/apps/wizard-os-home`). Same-origin Wizard PWAs can load it by URL; other surfaces (a native lock screen, WebView) copy the two files and keep the version in sync.

```html
<link rel="stylesheet" href="/wizard-os-home/motion/wizard-motion.css">
<script src="/wizard-os-home/motion/wizard-motion.js"></script>
<script> const M = window.WizardMotion; </script>
```

## Primitives

| Call | What it does |
|---|---|
| `M.orb(el).set('live' \| '')` | Breathing ring while listening (`data-wm-ambient="live"`). |
| `M.orb(el).notice()` | One shockwave from the orb: "something was noticed". |
| `M.words(canvas, { anchor, lanes, max, dim })` | Faint words drift in free lanes. `.add(text)`, `.hot(text)` (bright, above the anchor), `.gather()` (falls into the orb), `.count`, `.clear()`, `.destroy()`. `anchor()` returns the orb centre `{x, y}`. |
| `M.card(cardEl, layerEl)` | `.rise()` springs a `.wm-card` up from the orb; `.sink()` dismisses; `.send()` shrinks it into the orb. `layerEl` is a `.wm-layer` scrim. |
| `M.signRing(button, ringCircle, { holdMs: 300, onSign(via), enabled })` | Mockup thumbprint: a quick tap or a ~300 ms hold fills the ring and signs (`via` = `'tap'` or `'hold'`). The whole button is the target. No real fingerprint or WebAuthn. `.reset()`. |
| `M.spread(target, { onOut, onIn, enabled, threshold: 50 })` | Two-finger spread → `onOut` (deeper/open), pinch → `onIn` (shallower/close). |
| `M.moons(orbHost, { radius: 50 }).set([{ id, title, state }])` | Lights orbiting the orb: `working` (violet), `done` (green), `failed` (red), `needs` (amber). |
| `M.hint(el)` | One plain pulsing hint per step: `.show(text, key, holdMs, force)`, `.clear()`, `.text`. |
| `M.haptic(name \| pattern)` | `tick`, `press`, `notice`, `sent`, `soft`, `error`. |
| `M.chime(name \| freq, dur, vol)` | Soft three-partial tones: `notice`, `sent`, `open`, `tick`, `soft`. Audio unlocks on the first pointerdown. `M.sound.muted = true` silences it. |
| `M.reduced()` | `prefers-reduced-motion`; the kit already honours it. |

## CSS classes
`.wm-words`, `.wm-layer` (+`.open`), `.wm-card` (+`.on/.gone/.sent`, children `.wm-k/.wm-m/.wm-s`), `.wm-sign` (+`.pressing`), `.wm-hint` (+`.on`), `.wm-moons/.wm-moon`, `.wm-zoom` (+`.on/.deep`, rows `.wm-zi` with `.t` and `small`), `.wm-pill` (+`.paused`).

Theme via custom properties on any ancestor: `--wm-violet-2`, `--wm-green`, `--wm-red`, `--wm-amber`, `--wm-ink*`, `--wm-ease`, `--wm-spring`, and `--wm-bottom` (how far above the bottom the card and hint sit, i.e. above your orb).

## Rules that come with it
- **One hint per step**, plain words ("touch the print to send", "spread two fingers").
- **Back never exits**: card open → Back closes the card; zoom list → Back goes shallower → home. Your surface owns the Back stack; the kit only animates.
- **No backdrop blur over a WebGL orb.** Android Chrome can leave the orb canvas white after a blurred layer passes over it; the kit's scrim is opaque-gradient for that reason.
- The drifting-words canvas reapplies its transform every frame (Android drops/restores 2D canvases under memory pressure).

## Used by
- Wizard OS Home, Live Mode preview: `/wizard-os-home-preview/` (`web/live-mode.js`).
- Next: the lock-screen orb ("Redesign GrapheneOS lock screen AI interaction" thread), Chats/Wizard surfaces.
