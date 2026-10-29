# Unified share: exact-live signed candidate handoff (not a release)

## Source custody

- Runtime integration: `b1b9fdf344e66924a04575a573dc49c9dbc0f8be`, based on the actual serving `9e4cadfb21fe9096546a4956c2e5b3f6792c8734`.
- Feature delta comes from approved `96d61760c5384c783897ed84986bfaed26bdb18d`, fork `863a9946139404be9e1d72879fbb3c157ce3464d`. Three-way application preserved concurrent live Chats routing. Native orb assets already match the approved candidate; no replacement was necessary.
- REUSE: `WizShareWizard`, `WizCore`, `ShareQueue`, the existing forum Android worker, native-share coordinator and Connect upgrade runner. EXTEND: Connect runner gains bounded signed-only upgrade mode and native forum architecture/lease selection. No new emulator implementation or product capability.
- Do not merge broad main into this live derivative. PR686 remains draft and conflicts with upstream main; this separate live-based branch neither merges nor promotes that PR.

## Release identity and stop gates

The approved candidate already says **0.10.20 / code84**. It is retained here, NOT newly reserved. Open late-voice PR681 also stages code84; approval-sheet PR714 stages code85. Parent must resolve order and native source custody with those owners before authorizing a signed build. If code83 ships first, the current-baseline packet must be regenerated against its exact bytes. Never relabel an APK or leapfrog a staged sibling.

Snapshot feed: **0.10.18 / code82**, APK SHA256 `5e8be00bd7161e07786e7d716698d4c12cc8450f12c8ab7f3906a97009d3161d`, signer `3bf74d0b597bc170761079909d3692428702ba057f753ee1ffd62da3c76ed1fd`. Bytes are pinned independently. Its encoded ORIGIN/HOME_URL are empty. Do not call its offline Connect appearance lost credentials or paired-origin proof. Trace the original successful signing receipt before authorization; feed metadata alone is not source provenance.

Private owner config is generated from current installation settings, never committed. The new signed owner artifact must encode that exact origin. Generic empty-default builds are not owner-feed candidates. Legacy baseline **0.9.38 / code62** is additionally pinned at `b2b27b055533da79e25dd65b4361668b65939dd1c45d570a6bb8078b0e610502` to prove skipped-version baked-origin recovery without seeded preferences.

## Prepared host execution

`tools/qa_unified_share_release_packet.py` is only a sealed orchestration adapter. It refuses VPS execution, wrong durable lease, input drift, absent independent parent approval, wrong signing identity, reused job paths and insufficient capacity. It never submits, publishes, changes a feed or deploys web source.

Packet seal binds both source archives/manifests/job configs/workers, committed coordinators, exact baseline bytes and private origin configs. Parent receives exact `host/cwd/argv/key/timeout/lane` and seal hash outside Git. Do not execute the raw worker argv in the prepared helper receipts: use the sealed coordinator only after independent review.

Forum spec: SDK `/srv/work/android-sdk`, JDK `/usr/lib/jvm/java-21-openjdk-amd64`, API35 google_apis **x86_64 with KVM**; source/builds stay in `/srv/work`. Signing path is the forum-only protected Wizard OS environment, never the legacy Mobile key. It must exist mode600 with WOS_KEYSTORE/WOS_STORE_PASSWORD/WOS_KEY_ALIAS/WOS_KEY_PASSWORD names. No secret values are printed. Thales is preferred for signing when available; changing hosts requires a new prepared packet rather than editing this seal.

Capacity refusal preserves **200 GiB + 22.25 GiB**: 12 GiB for both Gradle working sets, 9 GiB for three retained AVDs, 1 GiB APK/log allowance and 256 MiB staging allowance. Recheck actual disk before admission. No unrelated cleanup is authorized.

Execution reuses these gates in order:

1. Signed `testReleaseUnitTest`, `lintRelease`, `assembleRelease`, with the exact owner origin and isolated forum Gradle home. Aggregate actual JUnit XML; no skipped/failing/empty suites.
2. Fresh source-equivalent debug/native share gate (full suite + actual independent sender ACTION_SEND URI grant, comment/Agent/Chat/cancel/Back, two exact large PDFs, force-stop resume, notification tap). Synthetic fixture only; not an OS chooser/Gmail or authenticated owner claim.
3. Existing Connect runner `--upgrade-only`: exact code82 generic baseline naturally opens Connect offline; in-place owner candidate must retain UID/firstInstall/notification permission, remain non-debuggable, preserve pre-launch prefs, recover exact owner origin, show no Connect, and keep Back inside Wizard. This is empty-default recovery, **not naturally paired-origin proof**.
4. Same exact candidate bytes from code62: launch naturally offline, verify baked owner origin and absent wizard_server.xml; upgrade, no Connect, exact persisted origin. Never seed preferences or access owner agents/Messenger.

Every emulator is stopped, owned serial absence is checked, phase logs/private receipts are retained. Even a passing coordinator requires parent visual and feature-parity review, exact-byte signing receipt review, owner-feed audit and the separate release promoter's authorization. No physical-phone or credential/session preservation claim is made.

## Prior evidence and remaining visual limit

Prior source `96d61760` passed synthetic debug Android acceptance: forum `/srv/work/AndroidBuilds/jobs/20261029T103020Z-274ceddb/android-evidence/acceptance.json`, 384 JVM tests with zero failures/errors/skips; both large PDFs hash-exact and delivered once; owned emulator stopped. That is not build/upgrade evidence for this integrated source.

The prior notification screenshot appears to show the earlier Private notes/genuine.pdf/comment-one thread although the receipt asserts the new thread ID. Read-only inspection found that `share-fixture.mjs` serves sessions and messages by exact ID, not a generic transcript; no fixture defect is established. The DOM guard checks focused window/thread ID and filename, but the prior screenshot cannot be treated as independent visual confirmation. Preserve this discrepancy and inspect a fresh screenshot/readback in the new run before promotion; do not silently reinterpret it as a passing visual gate.

Controller checks are not Android compilation or signed-upgrade proof. No heavy work, signing, release tag, feed write or live cutover is authorized by this document.
