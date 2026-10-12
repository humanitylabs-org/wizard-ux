# Appearance: shell, skin, app

**Status: layering locked (James, 12 Oct 2026). Appearance v1 tokens and transport: approved by James, implemented in the isolated preview; Miguel to confirm the `wizard.md` field.**
Preview: `https://app-styling.staging.wizard001.com/wizard-os-home/` (tailnet, read-only). Decisions #50–#53.

Every app you open should feel like part of one operating system, and changing the skin should re-dress every app at once, without flattening what makes each app itself.

## Three layers

| Layer | Owns | Never owns |
|---|---|---|
| **Shell** (`shell` slot, [SHELL.md](SHELL.md)) | How you move: orb, desks, windows and tiles, fullscreen, outer Back stack, launcher, the backdrop every window sits on | What an app shows or how it lays it out |
| **Skin** (`~/.wizard-os/theme.json`) | How the whole system looks: colours, window material, surfaces, ink, accent, type roles, radius, motion | Navigation. A different way of moving is a different shell, not a skin |
| **App** | What you do: content, layout, interactions, its own state, intentional typography (Wisdom's serif) and content art | The canvas behind it, or which shell it runs in |

An app never imports shell code and never checks which shell it is in. The shell resolves the active skin and hands each app a small appearance context. Swap the skin: every open app re-dresses live. Swap the shell: the same app runs unchanged.

## The rule that makes it seamless

**When hosted, an app's canvas is transparent. The shell owns the backdrop.**

An app sits on the same window material as Chats. It never paints its own full-page background, because one opaque fill (`#000`, `#0f1014`) is exactly what makes an app look pasted on. Inside the canvas an app draws only semantic surfaces (cards, chips, bars, sheets) from the skin. Standalone (opened in a plain tab) it paints its own base colour so it still works alone.

Content art keeps its own treatment: album covers, portraits, photographs with a shade for white type. Where there is no art, the app falls back to the skin's surfaces, not a black plate.

## Appearance v1

The shell posts one typed message to each app frame; the app's small client validates it and writes `--wz-*` CSS properties.

```json
{"type":"wizard:appearance","appearance":{"version":1,"revision":12,"skin":"nebula","colorScheme":"dark","presentation":"window",
 "tokens":{"canvas":"transparent","base":"#05030c","chrome":"rgba(12,8,26,.82)","overlay":"rgba(28,19,58,.72)",
  "surface":"color-mix(in srgb,#f3efff 6%,transparent)","surface-raised":"color-mix(in srgb,#f3efff 10%,transparent)",
  "text":"#f3efff","text-secondary":"#b9b0d8","text-muted":"#7d74a3","border":"rgba(205,190,255,.24)",
  "accent":"#b99bff","accent-soft":"color-mix(in srgb,#b99bff 16%,transparent)","on-accent":"#05030c","reader-surface":"transparent"}}}
```

| Token | Meaning |
|---|---|
| `canvas` | Page background. `transparent` when hosted; the shell's window shows through |
| `base` | The skin's solid ground colour: text on light buttons, standalone pages, anything that must be opaque |
| `chrome` | The window material itself: sticky bars and headers (usually ~70% with a blur) |
| `overlay` | The shell's sheet material: in-app sheets, full players, toasts (with a blur) |
| `surface`, `surface-raised` | Cards, chips, inputs: ink tints, so they work on any material |
| `text`, `text-secondary`, `text-muted`, `border` | Ink and hairlines |
| `accent`, `accent-soft`, `on-accent` | The skin's one accent colour and its pairings |
| `reader-surface` | Behind long-form reading (same as canvas today; a skin may deepen it) |

- `presentation` is `window`, `immersive` (fullscreen) or `standalone`. It describes the host; it never dictates the app's layout.
- The app announces `wizard:appearance:ready`; the shell replies with the current context; the app acknowledges each applied `revision`. Stale revisions are ignored. Changes are pushed, never polled, and never reload the app (scroll, reading position and playback survive).
- Both sides check exact origin, source window and schema. Token values are colours only (no `url()`, no `;{}`); an appearance message grants no data, API, microphone or agent rights.
- Iframe colour schemes must match the host (`color-scheme: inherit` on the frame) or the browser paints an opaque backdrop.

## Type without flattening

Skins supply type **roles** (`font-ui`, `font-reading`, `font-display`, `font-mono`); apps declare which roles they accept. Small controls usually take `font-ui`. Wisdom keeps its own reading and display serif. A skin change never rewrites every element's font.

## Building an app that conforms by default

1. Start from the app template, which includes the appearance client and the shared primitives (`@wizard/ui`: buttons, inputs, panels, tabs, sheets, empty/loading states) wired to the tokens above.
2. Background rule: `html, body { background: var(--wz-canvas) }`. Bars use `--wz-chrome`, sheets `--wz-overlay`, cards `--wz-surface`.
3. Declare it in `wizard.md`: `appearance: 1` and the accepted type roles (field to confirm with Miguel).
4. The checker mounts the app in a test host under a dark and a light skin, window and fullscreen, and fails on an opaque full-page canvas, horizontal overflow, contrast below AA, or a Back that leaves the app.

Apps that don't adopt the client still open in themed window chrome; the shell never reaches into an unknown app's DOM to guess at its styling.

## State, updates and Back

- The skin choice is owner configuration in `theme.json`, reapplied on every connect; apps never store it.
- App Back closes its own overlay or nested view first and reports handled / at-root; the shell then leaves fullscreen or changes desk; a single Back never exits Wizard.
- Pin the appearance version. Older hosts or no host: the app runs on its standalone defaults.

## Next

1. Persist the skin in `theme.json` and resolve it in `wizard-ux` (not only the preview origin).
2. Extract the tokens and primitives into `style/` as `@wizard/ui`; add the template and checker step to `wizard-app-builder`.
3. Migrate apps one at a time, keeping each layout and typography: Topics, Music, Signal, Wisdom first (preview-proven), then Calendar, Projects, Mizel, Android Apps; Files gets its makeover on this foundation.
4. Cross-origin pairing for installed apps through the App Manager (exact origins, no query-string trust).
