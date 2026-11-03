# Orb repair: normal phone release

## Exact integration

REUSE the existing renderer/API, fallback, Everywhere overlay, recording and sleep paths. EXTEND only ordered inverse shader ramps and GL lifecycle reinitialization, identically in web/orb.js and the bundled Android assist copy. No new product component.

Base ee66ff81e62eebd54243312b444a9bd28da3c295 is the current serving source. Its complete Android tree equals cf16c3090fbe97a0f18e76545212224c85758b7f, the verified successful forum signing-worker source of published 0.10.22/code86. APK SHA256 469b765e58e1525fffd78944c9f2cb8c4d1d97a4f9e156a79130d505512838b9. Bundled orb SHA256 0ec05cc4887c8832268b16934b9bc43e19e4bc2404daa33a0139906ec4bcb646 lacks the repair.

The applied two-file product patch is byte-identical to reviewed product 352b982b0e67cf732a8ccfd186b4ce89fbfb560b (PR738), not a merge of that branch's divergent ancestry. Other native differences are only versionName 0.10.23/versionCode87. No Java, capture, voice, gestures, colors or layout changes.

Prior browser evidence: forum heavy_c24cd09476fa45d3ad68921b2f4f7bea, QA834fad6879e0fd13060e6a235422dd769d378bde, 132 unique passing records; 16 complete matched GPU-input comparisons delta0. This is inherited by exact source hash, not a newly run suite. The Samsung white/cyan screenshot's exact trigger remains unproven. Context loss reproduces a separate confirmed lifecycle defect. Appearance is unchanged by design; previous idle/recovered screenshots were visually reviewed by the parent.

## Native packet

Signed packet validation requires trusted controller environment variables `WIZARD_SIGNING_ENV` and `WIZARD_OWNER_CONFIG`, each a nonempty absolute path matching its job configuration exactly. Supply both independently of the job being validated on every controller invocation, including `--preflight` and the full run; missing forwarding fails closed. Debug jobs require both configuration values to be `None`, regardless of the environment. Validation does not open either configured path.

`qa_orb_phone_packet.py` validates the complete two prepared source archives, workers and seal; builds signed release + unit tests + lint and a separate inspection-only debug APK. It reuses `qa_android_connect.py` for exact signed86→87 offline in-place upgrade, preserving UID, first install, grants, origin and data. Actual encoded old/new owner defaults must agree. New code compiles using the existing project/toolchain.

`qa_orb_release_native.py` uses one owned API35/x86_64 KVM guest for real signed-overlay screenshots, recording/pause/cancel (no send), screen sleep/wake, and the same packaged assist bytes in a debug native overlay for two GL loss/restore cycles and idle refreeze. It reuses raw CDP/boot helpers; it is not a physical Samsung/Pixel acceptance claim. No release WebView debugging is enabled. Captured native screenshots require parent visual review; a PNG capture alone is not colored-galaxy proof.

Preparation/static tests are not Gradle, emulator or release acceptance. Only the parent admits the exact sealed heavy spec. The inherited 132 browser cases are not repeated. Native case failures must preserve the signed artifact and failed evidence; rerun only a repaired harness phase, not a green build.

## Custody

PR738 coordination comment reserves normal code87 after checking feed86, open PRs and heavy registry; re-read all three before publication. If a sibling takes a later normal release, port these exact renderer bytes there rather than leapfrogging. Matching OS signer is 3bf74d0b597bc170761079909d3692428702ba057f753ee1ffd62da3c76ed1fd; never legacy Mobile. Forum/VPS/Bitwarden custody removes the old Thales-only blocker. No action or awake/online reply from James is needed.

No serving checkout/feed is edited by preparation. Parent must audit exact signed bytes with `tools/publish_owner_phone.py`, verify screenshot/native evidence, preserve the latest source, and publish through the existing in-app updater only. A separate sideload APK is not delivery. Main receives a narrow fix PR, not a bulk serving-branch merge. No project canon is changed.
