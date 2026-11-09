# Browser panel trial (`links.panel`)

James, 9 Nov 2026: "Can we try panel as a test to see if I like it?" A trial, off by default for everyone.

**What it does.** With WizardOS settings.json `"links": {"panel": true}` on a Wizard, a tapped outside http(s) link in a chat, a Search result or a hosted app, inside the WizardOS Android app (0.10.36 or later), opens in a browser panel over Wizard: an Android Custom Tab drawn by Brave when it is installed (his Brave speed and logins), else by the phone's default browser if it offers Custom Tabs, else the existing default-browser open. The panel's X or Back returns straight to the chat the link was tapped from. Dark toolbar (`#05030C`), page title shown, the browser's default share button.

**Unchanged.** Desktop (a normal new tab), Wizard's own pages (their in-Wizard routes), other Wizards and private/LAN hosts (the existing browser escape), files (downloads), the explicit "Open in your browser" choices (`data-wizard-browse`, long-press, Reader's own button) and Browser Reader (`links.reader` still wins for the links it routes). An older APK without the `openInPanel` bridge keeps `openInBrowser`.

**Where.** Shell: `outside()`/`panelLinks()` in `web/core/links.js`. Native: `Bridge.openInPanel` → `MainActivity.openPanel` and the pure choice `PanelLinks.pick` (`android/app/src/main/java/ai/wizards/os/`), manifest `<queries>` for `android.support.customtabs.action.CustomTabsService`. The setting reaches the shell through the Agent Service's `normalizeSettings` `links` block (wizard-agent-service `server/wizard-os-settings.mjs`).

**Tests.** `tests/browser-panel-links.test.mjs` (shell), `PanelLinksTest` (JVM), `PanelE2eTest` + `tools/qa_android_panel.py` (forum x86_64 emulator with the current Brave release APK: a Custom Tab over WizardOS, one Back returns).

**Turn it off** (no code change): remove `links.panel` from `~/.wizard-os/settings.json` or set it to `false`. The Agent Service reads the file on every request; the next shell load (reopen the app or pull to reload) opens links as before. **Scrap it:** revert the PR; the bridge is inert without the setting.
