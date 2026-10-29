# Skin frame compositions (version 1)

A skin now composes a palette/scenery definition with a window foundation. Designers do not need to fork either shell. Import a local JSON file on the phone in Settings → Windows → Import skin JSON. This only changes this origin/device. No network registry, JavaScript, CSS strings, selectors or app permissions are accepted.

```json
{"version":1,"extends":"grove","frame":{"foundation":"borderless","border":0,"radius":0,"gutter":0,"padding":16,"gap":8}}
```

`extends` must name an existing skin id from `core/skins.js` (for example `nebula`, `grove`, `tide`, `ember`, `signal`, `obsidian`, `landscapes`). `frame` is optional: it inherits that skin's frame, or Standard when absent. Built-in authors can put the same `frame` object on their existing definition in `core/skins.js`; no changes to the shell adapters are needed. Compositions can independently override the foundation's values. Examples in `docs/skins/` are importable as-is.

| Field | Allowed values | Meaning |
|---|---|---|
| version | 1 | Composition format |
| frame.foundation | framed, borderless | Standard titlebar or open app heading + floating X |
| frame.border | number 0–2 | Shell perimeter width, CSS pixels |
| frame.radius | number 0–28 | Window/content corner radius |
| frame.gutter | number 0–16 | Phone tiled layout side clearance |
| frame.padding | number 0–32 | Side inset of the open app heading and X; app content stays full-bleed |
| frame.gap | number 4–16 | Phone tiled layout inter-window space |

Standard without overrides uses existing adapter geometry. Borderless starts with border/radius 0, outside gutter 0, heading inset 16 and gap 8. Desktop keeps its existing user-arranged window geometry; border/radius and floating controls apply, but phone-only gutter/gap do not move desktop windows.

All fields are validated before import makes any change; unknown fields, unknown parents, wrong types, out-of-range numbers and invalid JSON reject the complete import. The UI limit is 8 KB. A corrupt saved composition falls back to the safe skin/deployment default. No recursive inheritance in v1. No font/palette import in v1.

## Composition and comparison

`WosSkin.compose(definition)` validates and applies an import. `WosSkin.composition` returns a serializable snapshot. `WosSkin.setFoundation('framed'|'borderless')` chooses a foundation, discarding custom frame numeric overrides. `WosSkin.resetFrame()` restores the current palette's authored frame. Choosing another colour skin preserves the user's explicit frame. Both shell entrypoints load the exact same schema, frame CSS and Settings UI.

The composition is stored as `wos.skin.composition.v1`; the existing palette choice remains in `wos.skin`. Selection changes only root data attributes and numeric CSS properties. Windows, iframe nodes, drafts, focus/Back/voice handlers and lifecycle hooks are not rebuilt. Explicit close still goes through the existing close/audio stop path.

## Breathing room without window chrome

Borderless fills the full available screen with one continuous app background and uses 12 px internal top padding and a 64 px open heading area carrying the real app title and one 44 px floating X. There is no titlebar border, ellipsis menu or relocation control. App search/toolbars begin below the heading. The app canvas itself is full-bleed: the shell never pads around an app, because any shell inset shows the window material as a contrasting band beside art-led or opaque app backgrounds. Text breathing room is the app's own content padding (hosted apps are already laid out for a phone-width viewport). The heading stands on the app's own background: the shell measures the same-origin app's top edge on load, on in-app navigation and when images finish loading. A full-width opaque header, top gradient colour or hero image (average of its top rows) becomes `--frame-top` for the heading band only; otherwise opaque apps lend their page background (`--frame-bg`) and themed transparent apps stay on the skin's window material. No different-coloured strip frames an app, and below the heading the skin material is unchanged. `tools/qa-borderless-canvas.cjs` checks this with screenshot pixels on the Wisdom library and Critical Buddhism detail. Content ends exactly at the orb/dock top edge rather than leaving an 8 px gap. Original title double-tap/pinch fullscreen, desktop dragging and Back remain the shell's existing interactions. Contextual bound-view and detach actions retain their direct controls. Normal app routing/settings remain available via Standard and the existing Agents surfaces.

## Defaults by shell

Phone: Borderless is the default (James, 17 Oct 2026: "borderless mode on mobile, keep the borders on desktop; a toggle in settings, on by default"). Settings → Windows → **Borderless apps** switches the phone between Borderless and Standard; the saved choice wins over the default and survives reload. A skin that authors its own `frame`, or an imported composition, still applies on the phone.

Desktop: always Standard. The desktop shell ignores any saved composition (one origin's localStorage is shared by both shells) and Settings shows no Windows section there, so user-arranged windows keep their borders and title bars.

## Checks

Run `node --test tests/skin-frame.test.mjs` for schema, atomic rejection, shell defaults, persistence and reset. `tools/qa-borderless-default.cjs` (phone default, Settings switch, reload, desktop stays framed) and `tools/qa-borderless-canvas.cjs` (pixels) take `QA_URL` plus optional `CAND_DIR` for a pre-deploy candidate. Run focused real-browser checks on the designated remote QA host: registered app rendering; same iframe identity and retained draft while switching; unobscured toolbar and X; orb/dock geometry; fullscreen/Back; desktop drag; JSON import; skin switching and reload. Native keyboard/voice fidelity remains a separate device check.
