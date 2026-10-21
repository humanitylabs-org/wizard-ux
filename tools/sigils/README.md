# App sigils: every app gets one

Every app shows one mark (its sigil) in the same box everywhere: launcher tiles, the phone dock and orb, desktop bar, window title bars and search rows. A sigil is one solid silhouette with one bite of negative space, drawn as a CSS mask over a lit gradient of the app's colour. Skins restyle it by painting `.sgi` (for example with their ink colour). The shape and box never change.

## The standard

1. **Every app that ships in the Wizard App Store gets a designed sigil before it ships.** That means a glyph in `glyphs.py` plus a `HOUSE` entry in `build.py` keyed by its app id. CI enforces this: `tests/sigils-every-app.test.mjs` lists the known store apps (`STORE_APPS`) and fails when one has no `HOUSE` entry. When you publish a new app, add its id there in the same PR.
2. **Fallbacks never look broken.** An app the shell doesn't know yet (a third-party app installed today) is resolved in this order:
   1. the app's launcher entry names an existing glyph (`"icon": "<glyph>"`, optional `"colors": ["#hex"]`)
   2. the `HOUSE` entry for its id
   3. the app's own same-origin icon file (`"icon": "/<app>/icon.svg"`, also `.png` or `.webp`), used as the silhouette at 78% of the box
   4. a disc with the app's initial cut out, on a stable hue picked from its id

   Every one of these is a mask in the same box, so a fallback can't come out bigger, square, opaque or outside the selected ring. Never render a fallback as painted text or an `<img>`. Skins must never set `mask: none` on `.sgl`; the test checks every `skin.css`.
3. **Never hand-edit `web/core/sigils.css` or `web/core/sigils.js`.** They are generated. Edit `glyphs.py`, `build.py`, `style.css` or `sigils.template.js`, then rebuild. The test fails when the generated files are stale.

## Adding a sigil for a new app

```sh
# 1. Draw the glyph (512 grid, boolean ops: U union, D difference, I intersect; see the primitives at the top)
#    @glyph('cloud', 'A plain cloud: your Cloudflare accounts.')
#    def g_cloud(): return P("M166 220A70 70 0 1 0 166 360H348A78 78 0 0 0 348 204A96 96 0 0 0 166 220Z")
#    Reuse an existing glyph if one already says what the app does.
# 2. Give the app id a glyph and a hue in build.py HOUSE:
#    'wizard-cloudflare': ('cloud', 62, None),   # (glyph, OKLCH hue 0-360, chroma or None for vivid)
#    Pick a hue that isn't taken by a neighbouring app; quiet system apps use a low chroma (0.04-0.12).
# 3. Rebuild and test
uv run -q --with skia-pathops --with fonttools python3 -I tools/sigils/build.py
npm test
```

4. Look at it before shipping. Render the launcher and the dock with the app selected, at phone width (390 px) and desktop, in a dark skin and a light skin. Check that it reads at both 58 px (tile) and 21-36 px (dock).
5. Add the app id to `STORE_APPS` in `tests/sigils-every-app.test.mjs`.

## Files

| File | What it is |
|---|---|
| `glyphs.py` | glyph shapes (`@glyph(name, description)`) |
| `build.py` | `HOUSE` (app id → glyph, hue), colour maths, writes the generated files |
| `style.css` | tile and mark styles, copied to the top of `web/core/sigils.css` |
| `sigils.template.js` | `WizSigil` API template → `web/core/sigils.js` |
| `agent_hats.py`, `private_hat.py` | brand-mask hats (Chats, private agent, Agents) |
| `showcase.py` | preview sheet of all glyphs |
