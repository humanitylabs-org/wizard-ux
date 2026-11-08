# App kit

`wizard-ui.css` is the live Wizard UI kit for hosted apps (look only: frame, rows, sections, empty state, single-line add field,
grid, pills, meters, connector card and the one sheet). `wizard-sheet.js` is the sheet's behaviour (`WzSheet.open(dialog)`:
closes by ×, Esc, tap outside, Back via `window.__wizardCloseOverlay` and swipe down on the grip).
Sources of truth: `wizard-os/style/ui.css`, `style/sheet.js` and `style/tokens.css`, ruled by `style/APP-DESIGN-RULES.md`
(design: Robert; process: Jan). The copies here stay byte-identical; change the source first, then mirror it here.
Served at `/wizard-os-home/kit/wizard-ui.css`, `wizard-sheet.js` and `wizard-tokens.css`.
`WizardApp` (`core/app-client.js`) swaps an app's vendored `wizard-ui.css` for this file and layers the active skin
after the app's own styles, so skins and My skin can restyle `.wz-*`. `wizard-sheet.js` is opt-in: an app that uses
`.wz-sheet` loads it itself. Neither file is shell CSS/JS and the shell never loads them. Settings uses the generated reset-free `controls.css` and `shell-tokens.css` bridge instead; this reuses the same rules without introducing global resets or `--ink`/`--wz-text` alias cycles.

The [canonical app style guide](https://github.com/humanitylabs-org/wizard-os/blob/main/style/APP-DESIGN-RULES.md) owns all visual decisions. Size/type/panel roles are CSS defaults, not an Appearance message extension. CI runs its changed-line style ratchet; existing app debt warns, new/changed violations fail.

CI consumes the byte-identical canonical scanner/policy distribution in `tools/style/` (pin/hashes in `source.json`). The app gate reads it from trusted public wizard-ux main: a caller-scoped GitHub token cannot read private wizard-os. Refresh with the canonical source sync, never edit policy rules here.
