# Android Photos backup

Original Wizard code implementing the documented Immich v3.3.3 REST contract. No Immich mobile code or AGPL component is embedded. Immich is an external service, not an Android dependency.

## Owner flow

Shared Settings → Photos backup opens a native child screen. Camera and Screenshots are selected by default. Backup is opt-in, Wi-Fi (unmetered) only by default, and the first complete scan waits for charging by default. Back leaves Albums, then returns to Wizard Settings, then the existing shell handles Back without exiting.

Wizard Sign-in calls `/api/oauth/authorize` with an independently generated state, S256 PKCE and `ai.wizards.os://photos/oauth-callback`. Register that exact redirect on the OIDC client. Immich v3.3.3 accepts it per request (its mobile override only rewrites the Immich-specific scheme). Callback validates route, state, age and code, consumes the encrypted pending record, exchanges through `/api/oauth/callback`, creates a per-device key with `asset.upload`, `asset.read`, `user.read`, then logs out the short-lived session. Server/key/account are bound together in Android Keystore AES-GCM storage; Android app backup is disabled. No credential or media is exposed to JavaScript.

The build's default server comes from `-PphotosServer=https://your-server` (never a committed owner hostname). Advanced configuration also accepts server + key. Release accepts HTTPS only; debug additionally accepts loopback HTTP for an adb-reversed disposable test server. Disconnect stops future work/removes the saved key, but does not delete server originals or revoke the key remotely; the UI explains revocation in Immich account settings.

## Custody and scheduling

MediaStore metadata enumerates images/videos in selected buckets, excluding pending/trashed entries. Android 14 selected-only permission is supported and labelled. Missing original-location permission pauses backup: it never substitutes a redacted stream. `MediaStore.setRequireOriginal` preserves EXIF/GPS, motion-photo trailers and original video bytes. Separate live-photo companion files are backed up independently (not heuristically paired); embedded Android motion originals are unmodified. No transcoding or large in-memory payloads.

SQLite records acknowledgments per server+account and media identity (URI, size, modification time and generation). SHA-1 bulk check handles duplicate files, interrupted acknowledgement, reinstall and later overlapping imports. Immich v3.3.3 has removed `deviceId` / `deviceAssetId`; do not send these obsolete fields. The upload sends documented multipart fields and `x-immich-checksum`, with fixed-length, bounded-buffer streaming and a second SHA-1 check to reject a changed source. Trashed server duplicates are reported, not silently counted as backed up. Local acknowledgments represent successful backup, not continuous verification that a user has not subsequently deleted server files.

WorkManager provides 15-minute periodic recovery and rearmed one-shot content-URI triggers. Both use network and initial-charge constraints. The uploader additionally checks actual Wi-Fi (including VPN underlay), current generation, charging and cancellation between items and stream chunks. Per-item acknowledgments survive retries; one bad file does not prevent the rest. Foreground progress is used for the initial/full scan; Android may still delay/stop work under system quotas, Doze or force-stop. Reopen or Retry recovers.

## Verification and provenance

Acceptance must run on Thales against a disposable Immich project and an isolated emulator, never a real phone or real account. Unit/Android/Back tests accompany this change. Test fixtures are generated; server metadata may be read only from the disposable test account. A passing compile is not end-to-end acceptance.

New dependencies (linked, Apache-2.0 AndroidX): `androidx.work:work-runtime:2.10.1` (persistent constraints/foreground worker), `androidx.browser:browser:1.8.0` (Custom Tabs). Source/release and license: https://android.googlesource.com/platform/frameworks/support/ and https://developer.android.com/jetpack/androidx/releases/work / https://developer.android.com/jetpack/androidx/releases/browser . Maven artifacts and source jars retained in the Thales Gradle cache; release-specific hashes/SBOM must be retained with the release receipt. API reference: https://api.immich.app/ . Protocol version is pinned to server 3.3.3, not the latest schema.
