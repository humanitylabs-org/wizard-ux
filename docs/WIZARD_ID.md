# Wizard ID in the active Android shell

Port provenance: archived `wizard-mobile` commit `975c25335628f2ed0ca68231e25392dd4a613272`,
with the September `android-authority` wrap/auth/sign/self-verify/wipe contract. All implementation
and tests are Java; `ai.wizards.os`, minSdk 28, no Kotlin Gradle plugin or second native bridge.

Reuse:
- native transport: REUSE `wizardDevicePort` v1 and its main-frame/current-origin/shell-path checks.
- page calls: EXTEND `WizCore.bridge.call` to route identity/capture to that same existing port.
- Settings: EXTEND `WosSettings.register`, Phone → Wizard ID (not a second web settings app).
- secure identity: NEW native `identity/` adapter behind DeviceBridge; no new web global. Native-only
  secret entry/backup and approval are the explicit WIZARD_ID exception to web-owned feature UI.
- visible capture: EXTEND DeviceBridge for the required WebP byte return, not a new capture port;
  existing user screen-sharing/scroll-capture workflows remain unchanged.

## Contract

`WizCore.bridge.call(method, params)` uses the existing versioned device envelope:

- `identity.info` → `{none:true}` or `{npub,pubkey,name,picture,backed_up}`.
- `identity.setup` → native create/import/settings/backup, `{cancelled:true}` on Back. Success includes
  `npub`, `pubkey` and public metadata; onboarding's approved kind-0 `profile_event` is public only.
- `identity.sign {event}` → NIP-01/BIP-340 signed event or `{denied:true}`. Only normalized event kind,
  tags and content enter the approval UI; requester descriptions/ids/signatures are discarded.
- `view.capture {rect?}` → `{webp_b64,width,height}` for the visible WebView, optional CSS-pixel rect;
  invalid/out-of-bounds/oversized captures return `{denied:true}`. Max 2048 per side / 4 million pixels.

Only the currently configured Wizard origin, main shell frame and shell path may call. Navigation,
WebView replacement, activity destruction or a three-minute timeout invalidates outstanding work.
No native interface named `WizardNative` is added. Hosted frames have no direct signer access.
The private key is never a reply, URL, log, JavaScript variable or unencrypted persisted preference.

## Crypto and platform boundaries

ACINQ secp256k1-kmp 0.19.0 provides real JNI Schnorr signing. Every signature is independently verified
against the stored x-only public key before return. Secret and auxiliary byte arrays are zeroed in
finally blocks. Secret strings needed by Credential Manager/native text/clipboard cannot be reliably
zeroed by Java; native fields are cleared on dismissal, secret screens forbid screenshots, and clips
are sensitive with a 45-second expiry.

The secret is AES-GCM wrapped by Android Keystore, StrongBox preferred with unavailable fallback.
API 30+ keys require per-use `BIOMETRIC_STRONG | DEVICE_CREDENTIAL` authentication through a
BiometricPrompt **CryptoObject**. API 28–29 use the prototype's per-use validity-duration fallback:
Android does not support device-credential CryptoObject authentication there, so strong biometric
is required (disclosed in onboarding). There is no cached-unlock window or weak-biometric fallback.

Android ignores biometric-enrollment invalidation on a key also permitting device credential. A
biometric-only sentinel detects enrollment changes; an ID created before biometrics existed also
refuses unlock after strong biometric enrollment. Device-lock removal still invalidates wrapping.
Hardware StrongBox and enrollment invalidation require separate physical-device acceptance.

Backup: native Credential Manager save-password **then explicit read-back with pubkey match**; saving
alone never sets `backed_up`. No provider/declined save offers native copy/paste-back with the same
pubkey comparison. The exact WIZARD_ID loss warning appears before either path. Declining backup
keeps `backed_up:false`. No ncryptsec decryption or key export through the bridge.

The one approval sheet derives its sentence from kinds 0/1/3/30117/30617, name then d tags; all other
kinds show “Unfamiliar request” and raw event JSON. All kinds require Approve & sign and biometric/PIN.
Back cancels sheets or steps back inside native import/error screens; it never exits the app.
Native sheets take only Appearance colour roles from the current shell, with a dark fallback and
contrast checks. The emulator fixture tests dark and light tokens.

Settings publishes only an owner-approved **public kind-0** event, with relay OK acknowledgement
before a published toast. Relays: `wss://relay.aiwizards.com`, `wss://nos.lol`,
`wss://relay.damus.io`. No skin/app publication or Blossom uploader is introduced by this port.

## Verification

Web: `node --test tests/*.test.mjs` (real checkout; staged Android source is not a git repo).
Android: prepare with `android-build-thales --prepare-only --gradle-dir android` and tasks
`:app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:assembleDebugAndroidTest`.
Run `tools/qa-wizard-id-thales.py <prepared-job>/job.json` under the durable heavy-worker lease with
its inherited lock environment. It builds through the staged worker, creates a disposable API-35
emulator with a synthetic PIN, invokes the real bridge and native onboarding/backup/signing, checks
BIP-340 vector zero, imports the backup on a simulated fresh install, exercises nested/root Back,
refuses frames/foreign origin, cancels on navigation, captures two skins, exports only public evidence,
and independently verifies the kind-30117 signature using pinned @noble/curves 2.0.1.

Pending until the remote receipt: compilation, lint and emulator success are not implied by source
or web tests. Not covered: physical phone/StrongBox, new biometric enrollment, API 28–29 biometric
hardware, a real password-manager provider, live relay publication, shipping/release signing/feed.
