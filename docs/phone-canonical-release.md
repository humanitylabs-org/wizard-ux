# Canonical Android phone release

REUSE: `android-build-thales` source manifests, WOS release signing, aapt2/apksigner audits, shared durable Thales lease, and the existing `qa_phone_release.py` / `qa_upgrade.py` pipeline conventions.
EXTEND: `tools/phone_release.py` adds generic-artifact validation, canonical `phone.json`, draft-only GitHub staging, and `qa_phone_origin_upgrade.py` for real persisted-origin custody.
NEW: no app/runtime capability, UI, origin store, installer, or public feed implementation. The small DEX reader inspects actual encoded BuildConfig static values; it does not infer emptiness from missing strings.

## Source and ownership gates

Use a clean release worktree, and trace the previous APK digest back to its **actual signed build receipt**, not a branch's name. A newer branch with the same version is not necessarily the artifact already installed on phones. Never reset another worker's release branch or merge feature commits into a version-only candidate.

The canonical release keeps the established app ID and signer. Both artifact `ORIGIN` and `HOME_URL` must be empty; `PHOTOS_SERVER` must also be empty. The manifest must contain the placeholder `unconfigured.invalid`. A nonempty origin environment or source Gradle property is refused, including values loaded by the private signing environment.

The Thales shared Gradle home may contain owner-specific `gradle.properties`. The canonical worker sets `-Dgradle.user.home` to a new job-owned directory (higher priority than the runner's `GRADLE_USER_HOME`) and shares **only** the dependency and wrapper caches. It never copies or edits shared properties or init scripts, never sets a blank origin to conceal a configured one, and never edits the private signing environment.

## Prepare, admit, collect

No Gradle, SDK, emulator or signing execution runs on the controller. Supply the established private WOS signing-env path as an argument; never commit machine paths or credentials.

```sh
python3 tools/phone_release.py prepare \
  --source "$RELEASE_WORKTREE" --output "$PRIVATE_EVIDENCE/build" \
  --signing-env "$PRIVATE_THales_SIGNING_ENV" \
  --previous-apk "$PREVIOUS_SIGNED_APK" --previous-sha256 "$PREVIOUS_SHA256" \
  --notes 'This release pairs on first launch and keeps existing connections.'
```

`prepare` uses `android-build-thales --prepare-only --wait-for-lock`, stages the release tool and origin QA alongside (not inside) the source manifest, and writes `canonical-prepared.json`. Submit its exact `argv` and `cwd` once through the durable heavy worker. Finish the conversational turn on admission; resume from its completion receipt. Do not start a duplicate job or run an untracked SSH build.

The signed worker independently reads aapt2 badging, verifies the APK signature against the pinned established SHA-256 signer, reads BuildConfig directly out of all DEX files, and computes SHA-256 and size from the final bytes. It then exercises those **same** APK bytes on an isolated API35 ARM google_apis emulator.

```sh
python3 tools/phone_release.py collect --job "$REMOTE_JOB" \
  --output "$PRIVATE_EVIDENCE/release" --draft
```

Omit `--draft` for private collection only. Draft staging refuses to overwrite any existing release. It creates `android-v<version>` targeting the 40-hex source commit, reads the release back to check `isDraft` and target, then downloads and hashes both uploaded assets. It never publishes, edits a live pointer, or writes a private box feed.

`phone.json` has precisely these keys: `app`, `versionCode`, `versionName`, `sha256`, `bytes`, `signer`, `asset_url`, `notes`, `min_box_snapshot`, `source_commit`. The default minimum is `0.3.40`. Notes are one plain public sentence. Private origin values are never included.

## Exact upgrade-origin proof

The baseline APK digest is mandatory and the old/new signer is verified before installation. The test:

1. Installs the origin-baked previous **release**, launches MainActivity and reads its real `wizard_server.xml` using root on the isolated test image. It does not seed or restore preferences.
2. Compares the persisted origin with the baseline artifact's encoded `BuildConfig.ORIGIN`.
3. Runs `adb install -r` with the generic signed APK. Reads the same preference file **before launch** and again after launch; requires both values equal the original baked origin.
4. Requires MainActivity, no Connect screen, a live process, no crash buffer exception, the new installed version and Back retaining the app. Captures screenshots, UI XML and activity state.
5. Uninstalls completely, installs the same new APK fresh and requires ConnectActivity plus its rendered Connect title, a live process and no crash.

The receipt records only the origin SHA-256 and equality facts. The original preference XML and screenshots remain **private evidence** because they can expose the paired address. Do not attach that directory to a public PR or release. Copy it back privately with the exact remote build receipt.

## Controller-only regression tests

```sh
python3 -m unittest discover -s tools -p test_canonical_phone_release.py -v
```

These tests use explicitly labeled unit fixtures, never run Gradle, and cover metadata, signer ambiguity, origin refusal, version/source consistency, notes, DEX constants and refusal to overwrite existing releases. They are not a substitute for the signed Thales build and exact-byte emulator proof.

## App Link audit for the first generic release

**Used as an external URL entry mechanism, not needed for native notification or internal shell navigation.** The live source's HTTPS filter explicitly has `android:autoVerify="false"`; it is not a verified App Link deployment. Changing the baked host to the placeholder removes even the owner host's matching URL-handler eligibility. If the owner enabled “Open supported links”, or used a chooser/browser handoff for those URLs, that native entry path is lost. A waiver is needed before promotion; this does not block building or staging a draft.

| Surface | Relevant code | Dependence / effect |
|---|---|---|
| External HTTPS thread and meeting links | `android/app/src/main/AndroidManifest.xml`, MainActivity's VIEW handling | `/wizard-os-home/` and `/mizel-live/` match only the compiled host. Owner-host links tapped outside Wizard now stay in the browser (or fail to offer Wizard); they no longer implicitly open the native app. |
| Chat/session links rendered by the shell | `web/core/chat-kit.js:sessionHtml`, `web/core/deeplink.js`, `web/core/links.js`, `web/core/chats.js`, desktop routing | Relative canonical session links route in the current shell/WebView. No OS App Link resolution. A copied/opened-in-browser version has the external limitation above. |
| Native chat reply notifications | `notify/ReplyWatcher.java:post` | Explicit `MainActivity` plus ACTION_THREAD/EXTRA_THREAD; unaffected. |
| Native meeting recording/problem notifications | `mizel/MeetingRecorderService.java:openMeeting` | HTTPS URL plus explicit `.setClass(...MainActivity.class)`; unaffected by manifest host eligibility. |
| Audio media notification and home-screen app shortcuts | `audio/BackgroundAudioService.java`, `HomeScreenShortcuts.java` | Explicit MainActivity / AppSessionActivity component; unaffected. |
| Screen search “open external” | `everywhere/ScreenMode.java:openExternal` | Implicit ACTION_VIEW; an owner-host thread/meeting URL loses its app-handler route and opens in browser. Ordinary other web URLs unaffected. |
| Web scheduled-reminder notifications | `web/core/scheduled-reminders.js` | onclick focuses existing window and calls internal deep-link routing; no App Link requirement. |
| Phone setup / QR | `web/setup/setup.js`, ConnectActivity, manifest `wizard://connect` filter | QR/pair action uses the separate custom scheme; unchanged. Service emits a shell URL / origin, not a package-specific verified App Link. Browser shell remains reachable. |
| Agent Service | `server/phone-setup.mjs`, source-wide notification/assetlinks searches | Supplies shell origin/URL and setup state. No assetlinks publisher, verified-link dependency, browser push notificationclick handler, or app-opening HTTPS notification emitter found in the audited service tree. |

Preserved pairing solves authenticated WebView routing but cannot add a manifest host at runtime. A future shared public host and assetlinks deployment is separate work; do not add one to this version-only release. Browser authentication/cookies may differ from the native shell, and opening an affected link in the browser does not activate native-only controls there.
