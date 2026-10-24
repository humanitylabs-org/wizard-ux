# Wizard Shell (Android)

The thin Android client: one WebView on the owner's Wizard, plus only what a web page cannot do itself.

Native, and nothing else:

- Choose the Wizard: a Connect screen (paste an address) and `wizard://connect?origin=…` Setup links; launcher
  shortcut **Change Wizard**. Any HTTPS origin, any port. Changing Wizard starts a fresh WebView.
- A can't-reach screen (Try again, Open Tailscale for `*.ts.net`, Change Wizard).
- Microphone and camera, granted only to the selected Wizard's exact origin.
- File picking for uploads; downloads and other sites go to the phone's own apps.
- Hardware Back is handed to the Wizard (`window.__wosNativeBack`); the app never exits on Back.
- System-bar and keyboard insets.

There is **no JavaScript bridge**. The Wizard sees an ordinary Android browser (user agent adds
`WizardOS-Android/<v> WizardShell/<v>`), so chats, apps, Food, Photos, the orb's look and every other feature
come from the Wizard and update without a new APK. Device abilities beyond the list above (background recording,
the floating orb, side-button assist, photo backup, share-in) stay in the full app (`android/app`) until each has a
small, optional capability here that the Wizard can discover.

Package `ai.wizards.shell` (debug: `ai.wizards.shell.test`), so it installs beside the full app.

```sh
cd android && ./gradlew :shell:testDebugUnitTest :shell:lintDebug :shell:assembleDebug
```

CI: `.github/workflows/android-shell.yml` (unit tests, lint, builds, emulator smoke `tools/android_shell_smoke.sh`).
