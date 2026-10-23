# Play edition build contract

Baseline: `origin/main` (`96ce5454`), direct APK 0.10.2/65. Parallel release history already
reserves 0.10.3/67 and 0.10.4/68. This PR builds but does not publish either edition.

REUSE: existing AppsBridge trusted-origin/main-frame validation, openPlay handoff and device protocol.
EXTEND: Android distribution source sets and the existing native update integration seam.
NEW: no new user-facing capability or web module; distribution-specific adapters only.

- `sideload` is the default. Existing self-updater/third-party APK installer implementations move
  byte-for-byte to `src/sideload`; applicationId, release signing, version and private defaults stay unchanged.
- `play` has no updater/installer implementation, boot receiver, install-result receiver or install/update job.
  Native Android Apps `install` calls open Play, with the existing HTTPS fallback if Play is absent.
- Play overrides ORIGIN/HOME_URL/PHOTOS_SERVER to empty and deep-link host to unconfigured.invalid,
  independently of owner Gradle properties. Fresh installs open Connect.
- Shared web settings show a static Play-managed version row instead of the APK-update button.
- Reserve codes below 1,000,000 for direct APKs; Play starts at 1,000,069 (0.10.5), then increments
  monotonically within its reserved range. These same-ID/same-key editions replace each other, not coexist:
  moving from Play back to a lower-code direct APK needs uninstall/reinstall (potential local-data loss).
  Do not allocate a direct release in the Play range. QA update fixtures remain in the direct range.
- Historical Gradle entry points are sideload-only aliases; new automation uses explicit flavor names.

Acceptance: Thales-only signed Play AAB + direct release APK, both release unit/lint suites, bundletool
manifest dump, jarsigner verification + cert SHA-256, generated BuildConfig and DEX audits. No Play
Console upload, APK publication, deployment or physical-phone changes are authorized by this task.
