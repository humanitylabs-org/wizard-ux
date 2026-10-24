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
come from the Wizard and update without a new APK. Device abilities beyond the list above (the floating orb,
side-button assist, photo backup, share-in) stay in the full app (`android/app`) until each has a small, optional
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

Package `ai.wizards.shell` (debug: `ai.wizards.shell.test`), so it installs beside the full app.

```sh
cd android && ./gradlew :shell:testDebugUnitTest :shell:lintDebug :shell:assembleDebug
```

CI: `.github/workflows/android-shell.yml` (unit tests, lint, builds, emulator smoke `tools/android_shell_smoke.sh`).
The smoke also drives `device.recording` against a disposable HTTPS fixture Wizard (`tools/android_shell_fixture.py`,
a CA minted per run and trusted only through the debug build's `debug-overrides`): recording continues with the screen
off and with another app in front, and a take survives `am force-stop` and is recovered, read and acknowledged.
Debug builds stream `files/qa_mic.aac` instead of the microphone (the emulator has none). The emulator can't prove
real microphone audio quality, Bluetooth routing or OEM battery killers: those need a real phone.
