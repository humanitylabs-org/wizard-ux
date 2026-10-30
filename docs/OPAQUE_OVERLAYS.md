# Overlay panel material

| Capability | Entry point | Contract |
|---|---|---|
| Overlay panel material | `web/core/base.css`, `--wz-panel`, `--wz-panel-raised`, `web/kit/wizard-tokens.css`, `web/kit/wizard-ui.css` | **Inherited base defaults** give text-bearing floating panels opaque backing. Explicit package skin and My skin materials override those defaults, including authored transparency/blur. Canonical base source: wizard-os `style/tokens.json`, `style/generate_tokens.py`, `style/ui.css`; copy generated token CSS and canonical UI bytes into `web/kit/`. Preserve the existing base tint as an image over `var(--wz-panel, var(--wz-base, var(--bg, #05030c)))`. For inherited base panels, do not rely on hosted canvas, faint surface/glass tokens alone, blur, or persistent element opacity. Scrims may dim; ordinary in-flow rows/cards remain translucent. Guard on the browser worker: `MODE=fixtures node tools/qa-opaque-overlays.cjs`. |

## Owner authority (#703 correcting #658)

James **already explicitly ordered preserving Miguel's skin overrides**. This is not a new
owner decision: do not reask, edit his skins, or force opacity. Base defaults only. Obsidian,
Landscapes and My skin keep their authored transparency/blur. Lower core fallback specificity
rather than adding `!important`, changing skin CSS or inventing policy switches.
`qa-skin-panel-authority.cjs` gates solid inherited defaults and explicit package/My skin
precedence; `qa-skin-panels-shell.cjs` captures actual authored surfaces without treating
intentional translucency as a failure. Neither fixture proof nor old-hash screenshots replace
phone/desktop captures and independent review of the exact revised source.

The guard opens Settings, overview and the real link context menu, and renders the shell/desktop/setup/store/agent/motion/kit panel classes in their production cascade. Each interior is compared byte-for-byte over loud text versus nothing in Nebula, Grove, Tide, Ember and Signal, hosted and standalone. Test fixture visibility/layout is normalized; no tested fill is replaced. `will-change` keeps gradient dithering stable between captures without concealing any alpha leak. Screenshots optionally use `QA_SHOTS` and `QA_PHASE=before|after`; full results use `QA_RESULT`. Run on the browser worker, never on the control host.
