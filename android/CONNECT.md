# Android: connect to an owner's Wizard

The generic `ai.wizards.os` APK has no server or photo-server default. First launch opens **Connect to your Wizard**. Open Setup on the owner's Mac/box, enable phone access, sign in to the same Tailscale account on the phone, then scan the Wizard QR or paste the HTTPS box address. Camera permission is requested by the QR scanner only; pasting needs no camera permission.

## Pairing contract

Matches the phone-setup work in wizard-os PR #38 / wizard-ux PR #15 (launch L2):

- Setup connection QR: `wizard://connect?origin=https%3A%2F%2Fbox.example.ts.net`.
- Plain HTTPS box URLs remain accepted for manual entry and older Setup QR codes.
- The contained address must be HTTPS, have a valid host/port, and contain no user info, query or fragment. Root and the shell path `/wizard-os-home/` are accepted; arbitrary paths are rejected. Port 443 is normalized away. Nondefault HTTPS ports remain part of the origin.
- A QR/deep link only prefills Connect. The user confirms; a read-only GET of `/wizard-os-home/` must return 200 HTML with the Wizard shell markers before anything is persisted. Redirects/login pages, TLS errors and generic HTTP-200 pages do not pass. This is a reachability/product check, **not authentication or cryptographic server identification**. Normal TLS and the server's owner authorization still apply; the app never bypasses either.
- The Tailscale sign-in QR is a different URL and must not be scanned as the Wizard address.

Settings → Connection → **Change Wizard** reopens Connect. The offline screen also offers Change Wizard, so an unreachable old box does not trap the owner. Back at unconfigured Connect stays in the app; when configured it returns to the current Wizard. Cancelling or failing validation never discards the saved server.

The shell, native origin checks, microphone permission, Mizel message allowlist/upload/notification, app APK relay, screenshots, photos settings bridge, native HTTP and updater derive from the stored origin. Restoring a WebView history from another server is refused. Successful connection closes old app-session document tasks so old pages cannot retain privileged bridges.

Native outboxes/recordings are not transferred to another owner. Changing server is refused while native recordings, unsent messages/shares, recoverable takes or retained meeting journals exist. Finish their work on the original box and let meeting retention prune before switching. No recordings are deleted by Connect. Web data stays in the WebView's existing per-origin storage.

## Private owner-build defaults and upgrade migration

Never commit an owner's address or signing values. Supply these through private Gradle properties or inherited environment on the signing worker:

| Gradle property | Environment alternative | Default |
|---|---|---|
| `wizardOrigin` | `WIZARD_DEFAULT_ORIGIN` | empty (Connect) |
| `wizardDeepLinkHost` | derived from `wizardOrigin` | `unconfigured.invalid` |
| `photosServer` | `WIZARD_PHOTOS_SERVER` | empty (no photo server) |

`ORG_GRADLE_PROJECT_wizardOrigin`, `ORG_GRADLE_PROJECT_wizardDeepLinkHost` and `ORG_GRADLE_PROJECT_photosServer` also work through Gradle's normal environment-property support. HTTPS manifest intent filters use `${wizardDeepLinkHost}`, not a checked-in host. The generic build always supports `wizard://connect` but cannot claim every possible owner's HTTPS domain in Android's manifest.

For an existing owner-specific install, build its upgrade with the *same current origin* as `wizardOrigin`, its current photo default as `photosServer`, the same package and established signing key, and a newer versionCode. First native access persists that default without displaying Connect or probing again. A previously chosen stored origin always wins over a later build default. Build generic and owner-default artifacts separately and never replace a feed with a generic artifact for an unmigrated owner.

## Verification

All Gradle, signing and emulator work runs on the approved remote Mac worker. The native project is plain Gradle, not Capacitor. Keep private values out of command transcripts committed to this repo.

- `:app:testReleaseUnitTest :app:lintRelease :app:assembleRelease` (signed generic)
- `:app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest` (separate debug signer)
- `:app:testReleaseUnitTest :app:lintRelease :app:assembleRelease` (signed private owner default)
- `tools/qa_android_connect.py DEBUG_RECEIPT GENERIC_RECEIPT OWNER_RECEIPT OLD_APK OWNER_CONFIG OUT`

Debug only permits a loopback fake (`http://localhost:PORT` / emulator host `http://10.0.2.2:PORT`) for the paste test. Release parsing never allows HTTP. The instrumentation suite tests actual first-run/paste/scanner-cancel/nested Back/root Back/persistence/invalid address/pair-link confirmation against an in-process fake, not the owner's chats. Signed upgrade rehearsal installs the exact previously published APK, upgrades in place, preserves UID/grants, and reads back the silently migrated origin. It deliberately runs offline to avoid owner traffic; online owner authorization and camera-image decoding on a physical phone remain separate coverage.
