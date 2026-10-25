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
come from the Wizard and update without a new APK. Device abilities beyond the list above (side-button assist,
photo backup, share-in) stay in the full app (`android/app`) until each has a small, optional
capability here that the Wizard can discover.

## Optional device capabilities: `window.wizardDevicePort` v1

One message port, the same versioned envelope as the full app (`docs/android-device-message-port.md`):
`{v:1, id, method, params}` → `{v:1, id, ok, result | error}`. `device.capabilities` lists what this APK offers.
The port is injected only for the selected Wizard's exact origin (`addWebMessageListener`); native answers only the
main frame while the top-level page is that origin's `/wizard-os-home` shell. A Wizard whose web never asks gets
exactly today's behaviour; a Wizard that asks an older APK sees the capability missing and keeps its in-page path.
Code: `device/DevicePort.java` (pure protocol + exact allowlist), `ShellPort.java` (the WebView host).

### `device.recording` v1: background recording

A microphone foreground service (`recorder/RecorderService.java`) with an ongoing notification (Stop), so a take keeps
going with the screen locked or another app in front. Audio goes straight to disk as AAC ADTS
(`recorder/TakeStore.java`), so an app kill loses at most the last frame.

| method | params | result |
| --- | --- | --- |
| `status` | | `{id, ref, state: idle\|recording\|paused\|busy, ms, level, last:{id, state}}` |
| `level` | | `{level: 0..100}` |
| `start` | `{id?, kind, ref}` | `{id}`; asks for the microphone (and notifications) first |
| `pause` | `{id, on}` | status |
| `stop` | `{id}` | `{id, ref, kind, state, ms, bytes, mime}` |
| `cancel` | `{id}` | `{released}` (a take of 20 s or more is kept and stays pending) |
| `pending` | | takes waiting for the Wizard, including `interrupted` ones cut short by an app kill |
| `read` | `{id, offset}` | `{b64, next, size}` in 384 KB chunks |
| `ack` | `{id}` | `{released}`: the Wizard has its own durable copy |

Custody: a take's audio leaves the phone only on `ack`, when nothing was recorded, or on a short Cancel. Each take
belongs to the Wizard that started it; another Wizard (after Change Wizard) can't list, read or acknowledge it.
The web half is `web/core/device-recording.js`: the orb uses it when the capability is present, moves recovered takes
into its durable outbox as held recordings (never sent without a tap), then acknowledges them.

### `device.orb` v1: Wizard Everywhere

The floating orb over other apps (`orb/`). The web's one switch is Settings → Phone → **Wizard Everywhere**
(`web/core/settings.js` drives `web/core/device-orb.js` when the shell offers `device.orb`); there is no second orb row.
Full-app-only controls (side button, voice typing) are hidden in the shell, not shown disabled.

While recording, the unchanged 64dp orb expands its window to show the web page's **Cancel** and **Pause/Resume**
buttons beside it (48dp targets). Tap the orb to start/send; drag still moves it. Hold pauses the take and keeps the
orb and controls visible; idle hold does nothing. Explicit notification Hide / disabling Everywhere stops an orb-owned
take unsent before removing its controls, including a start already in flight. Long Cancels keep the existing native
custody/recovery rule (20 seconds), never the `send` marker.

The isolated overlay's `wizardOrbPort` uses the existing device-port v1 envelope. Only `device.recording.pause`
`{id,on}` and `device.recording.cancel` `{id}` are allowed: no start, send, read, ack or arbitrary device operations.
The source must be the virtual origin's main frame, its top page must be the orb document, and the loaded and selected
Wizard must still match. Every operation rechecks the displayed take's id and owner. ArrayBuffer messages are ignored.
The bundle now loads at the same isolated virtual origin, using native allowlisted asset reads, not a wildcard/file
message-port rule. Redirect/TLS/CSP/network restrictions and the 1.5-second fallback deadline remain unchanged.
Old/mixed web pages without a functional controls API fall back to the APK copy; no usable port means no new mic take.
Words and controls remain in `web/assist/everywhere.html` / `everywhere.js`; their bundled copies must match.

## Home-screen apps: `window.wizardHomeScreenPort`

Hold an app on the Apps sheet or the New desk grid, or hold a one-app desk in Desks, and the Wizard's own sheet
(`web/core/home-screen-apps.js`, unchanged) offers **Add to home screen**. The shell answers the same contract as the
full app: `{op:'status'|'pin', requestId, appId, name?, icon?}` → `{requestId, status: ready|pinned|pending|unsupported|error}`.

- `home/HomeScreenPort.java`: exact origin, main frame, top page the selected Wizard's own `/wizard-os-home/` (never a
  pinned app). A pin needs a fresh native tap plus the page's live activation on its own sheet; then
  `ShortcutManager.requestPinShortcut`. Success is reported only after the launcher's confirmation callback.
- `home/AppSessionActivity.java`: each (Wizard, app) is its own Android document task opening
  `<Wizard>/wizard-os-home/?app-session=<id>`. Status and navigation bars stay; Back stays in the app; tapped public
  links go to the phone's browser; every other page is refused. No connect flow and no device ports there. The floating
  orb stays over a pinned app. A shortcut from another Wizard (after Change Wizard) opens only "App unavailable".
- `home/HomeScreenPolicy.java`: the pure rules (JVM-tested).

Older web that never uses the port sees no change.

Package `ai.wizards.shell` (debug: `ai.wizards.shell.test`), so it installs beside the full app.

```sh
cd android && ./gradlew :shell:testDebugUnitTest :shell:lintDebug :shell:assembleDebug
```

CI: `.github/workflows/android-shell.yml` (unit tests, lint, builds, emulator smoke `tools/android_shell_smoke.sh`).
`tools/qa-shell-orb-controls.cjs` exercises the web controls and packaged copy in Chromium with a **stub port**, including
old-web/mixed-web/no-port negative controls and CSP checks. It does not certify Android WindowManager or mic lifecycle.
The emulator smoke additionally checks Pause/Resume and hold through audio-file growth, plus offline Cancel/no send.
The smoke also drives `device.recording` against a disposable HTTPS fixture Wizard (`tools/android_shell_fixture.py`,
a CA minted per run and trusted only through the debug build's `debug-overrides`): recording continues with the screen
off and with another app in front, and a take survives `am force-stop` and is recovered, read and acknowledged.
It also turns Wizard Everywhere on in the real Settings and checks the orb over another app, and pins an app
through the real sheet (accepting Android's dialog), then launches it into its own task (Back, re-open, orb over it).
Debug builds stream `files/qa_mic.aac` instead of the microphone (the emulator has none). The emulator can't prove
real microphone audio quality, Bluetooth routing or OEM battery killers: those need a real phone.
