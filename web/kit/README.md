# App kit

`wizard-ui.css` is the live Wizard UI kit for hosted apps (look only: rows, sections, empty state, single-line add field).
Sources of truth: `wizard-os/style/ui.css` and `style/tokens.css`; served at `/wizard-os-home/kit/wizard-ui.css` and `wizard-tokens.css`.
`WizardApp` (`core/app-client.js`) swaps an app's vendored `wizard-ui.css` for this file and layers the active skin
after the app's own styles, so skins and My skin can restyle `.wz-*`. It is not shell CSS and is never loaded by the shell.
