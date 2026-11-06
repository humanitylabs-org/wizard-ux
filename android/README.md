# Wizard OS for Android

This is a native WebView shell, not a Capacitor Android project. Run Gradle/builds on your Android build
machine, not a small control-plane VPS. `npm test` runs the lightweight source/configuration guards.

## Build-time server configuration

Set `wizardOrigin` in the build machine's **private** `$GRADLE_USER_HOME/gradle.properties` (normally
`~/.gradle/gradle.properties`), or set `WIZARD_ORIGIN` in the environment of the actual Gradle process:

```properties
wizardOrigin=https://wizard.example.ts.net
# Optional: empty or omitted means photos backup has no preconfigured server.
photosServer=https://photos.example.ts.net
```

The Gradle property takes precedence over `WIZARD_ORIGIN`, including an explicitly empty property.
`ORG_GRADLE_PROJECT_wizardOrigin` and `ORG_GRADLE_PROJECT_photosServer` also supply standard Gradle
project properties. An empty property is useful to override a shared build machine's user properties
for an unconfigured debug build. Do not commit the owner's properties or `.env` files.

Direct Gradle invocation on a build machine supports:

```sh
export WIZARD_ORIGIN=https://wizard.example.ts.net
cd android
./gradlew :app:testDebugUnitTest :app:assembleDebug
# Or use -PwizardOrigin=https://wizard.example.ts.net -PphotosServer=https://photos.example.ts.net
```

Use an HTTPS origin with no path, query, credentials or explicit port. The existing native trust policy
supports HTTPS port 443 only. A trailing slash is removed. One value drives `BuildConfig.ORIGIN`,
`BuildConfig.HOME_URL` (`origin + /wizard-os-home/`) and both manifest app-link hosts. No personal
hostname is compiled in by default. Android currently has **no runtime server-setup/pairing screen**:
its connection UI retries the built-in address or opens Tailscale. With no address, debug/unit-test
builds use the non-routable `https://wizard.invalid`; release's `preReleaseBuild` fails with a clear
configuration error. Release unit tests also require configuration because they share that prerequisite.

An omitted `photosServer` is safe: backup starts disabled, and the native Photos settings can connect
an HTTPS server before enabling it. Saved photo-server credentials/preferences remain unchanged on
upgrade. The backup switch and Wizard Sign-in both ask for a server when none is configured.

## Remote runner

For `android-build-thales`, pass only task names after `--` (the runner rejects `-P` options), use
`--gradle-dir android` and **do not** use `--cap-sync`. Set private properties in the runner's actual
`GRADLE_USER_HOME`, not the machine's default `~/.gradle`. Consult your installed runner configuration
for that directory. Environment settings must reach the remote worker; exporting them only on the
control-plane machine does not send them over SSH.

`--prepare-only` stages source and returns a worker argv/cwd without running Gradle. Submit/run that
command separately only when the build is authorized. A source/configuration test pass is not Android
compilation, manifest-merger or device proof.
