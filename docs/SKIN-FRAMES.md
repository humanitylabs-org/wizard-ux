# Skin frame compositions (version 1)

A skin now composes a palette/scenery definition with a window foundation. Designers do not need to fork either shell. Import a local JSON file in Settings → Skin · Window foundation → Import skin JSON. This only changes this origin/device. No network registry, JavaScript, CSS strings, selectors or app permissions are accepted.

```json
{"version":1,"extends":"grove","frame":{"foundation":"borderless","border":0,"radius":0,"gutter":16,"gap":8}}
```

`extends` must name an existing skin: `nebula`, `grove`, `tide`, `ember`, `signal`. `frame` is optional: it inherits that skin's frame, or Standard when absent. Built-in authors can put the same `frame` object on their existing definition in `core/skins.js`; no changes to the shell adapters are needed. Compositions can independently override the foundation's values. Examples in `docs/skins/` are importable as-is.

| Field | Allowed values | Meaning |
|---|---|---|
| version | 1 | Composition format |
| frame.foundation | framed, borderless | Standard titlebar or open app heading + floating X |
| frame.border | number 0–2 | Shell perimeter width, CSS pixels |
| frame.radius | number 0–28 | Window/content corner radius |
| frame.gutter | number 0–16 | Phone tiled layout side clearance |
| frame.gap | number 4–16 | Phone tiled layout inter-window space |

Standard without overrides uses existing adapter geometry. Borderless starts with border/radius 0, side gutter 16 and gap 8. Desktop keeps its existing user-arranged window geometry; border/radius and floating controls apply, but phone-only gutter/gap do not move desktop windows.

All fields are validated before import makes any change; unknown fields, unknown parents, wrong types, out-of-range numbers and invalid JSON reject the complete import. The UI limit is 8 KB. A corrupt saved composition falls back to the safe skin/deployment default. No recursive inheritance in v1. No font/palette import in v1.

## Composition and comparison

`WosSkin.compose(definition)` validates and applies an import. `WosSkin.composition` returns a serializable snapshot. `WosSkin.setFoundation('framed'|'borderless')` chooses a foundation, discarding custom frame numeric overrides. `WosSkin.resetFrame()` restores the current palette's authored frame. Choosing another colour skin preserves the user's explicit frame. Both shell entrypoints load the exact same schema, frame CSS and Settings UI.

The composition is stored as `wos.skin.composition.v1`; the existing palette choice remains in `wos.skin`. Selection changes only root data attributes and numeric CSS properties. Windows, iframe nodes, drafts, focus/Back/voice handlers and lifecycle hooks are not rebuilt. Explicit close still goes through the existing close/audio stop path.

## Breathing room without window chrome

Borderless uses a 12 px top inset and a 64 px open heading area carrying the real app title and one 44 px floating X. There is no titlebar border, ellipsis menu or relocation control. App search/toolbars begin below the heading; phone side gutters default to 16 px, and the content ends exactly at the orb/dock top edge rather than leaving an 8 px gap. Original title double-tap/pinch fullscreen, desktop dragging and Back remain the shell's existing interactions. Contextual bound-view and detach actions retain their direct controls. Normal app routing/settings remain available via Standard and the existing Agents surfaces.

## Preview-only default

The source HTML does not select Borderless. A private deployment may inject `<meta name="wos-frame-preview" content="borderless">` **before** the skin scripts. Only fresh preview storage starts Borderless; a saved explicit choice wins. There is no preview tab, banner or review overlay. Standard/Borderless comparison and skin import live in the existing Settings surface. The previous preview's exact materialized borderless defaults migrate once to the new comfortable gutter; explicit Standard and custom definitions are preserved. The regular build remains Standard by default.

`tools/skin-preview-origin.cjs` serves an immutable checkout behind the existing staging router. It injects only that meta, refuses every non-GET/HEAD request before routing, strips cookies and blocks cross-origin redirects. Configure PREVIEW_WEB, PORT, PREVIEW_SHA, PREVIEW_UPSTREAM (HTTPS), PREVIEW_UPSTREAM_PORT (loopback TLS tunnel), and optionally PREVIEW_GENERATED for untracked data.js/summaries.js. No upstream credentials are carried. Read-only preview cannot verify voice uploads, app writes or production recording delivery.

## Checks

Run `node --test tests/skin-frame.test.mjs` for schema, atomic rejection, isolation/default, persistence and reset. Run focused real-browser checks on the designated remote QA host: registered app rendering; same iframe identity and retained draft while switching; unobscured toolbar and X; orb/dock geometry; fullscreen/Back; desktop drag; JSON import; skin switching and reload. Native keyboard/voice fidelity remains a separate device check.
