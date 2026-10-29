# App kit

`wizard-ui.css` is the live Wizard UI kit for hosted apps (look only: frame, rows, sections, empty state, single-line add field,
grid, pills, meters, connector card and the one sheet). `wizard-sheet.js` is the sheet's behaviour (`WzSheet.open(dialog)`:
closes by ×, Esc, tap outside, Back via `window.__wizardCloseOverlay` and swipe down on the grip).
Sources of truth: `wizard-os/style/ui.css`, `style/sheet.js` and `style/tokens.css`, ruled by `style/APP-DESIGN-RULES.md`
(design: Robert; process: Jan). The copies here stay byte-identical; change the source first, then mirror it here.
Served at `/wizard-os-home/kit/wizard-ui.css`, `wizard-sheet.js` and `wizard-tokens.css`.
`WizardApp` (`core/app-client.js`) swaps an app's vendored `wizard-ui.css` for this file and layers the active skin
after the app's own styles, so skins and My skin can restyle `.wz-*`. `wizard-sheet.js` is opt-in: an app that uses
`.wz-sheet` loads it itself. Neither file is shell CSS/JS and the shell never loads them.
