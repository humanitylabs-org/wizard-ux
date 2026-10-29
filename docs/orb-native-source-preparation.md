# Orb-only native source preparation (not a release)

Base: `7da6c821c63c48d7156abd9edec86e440fa8f883`, the 0.10.18/code82 source whose **all eight assist assets** match the exact currently published APK. This asset match does **not** establish the signed APK's full source provenance. The original successful build receipt is on offline Thales and has not been retrieved.

Delta: only the reviewed ordered shader ramps and context-loss/restoration lifecycle from `352b982b0e67cf732a8ccfd186b4ce89fbfb560b`, applied to `web/orb.js` and the matching Android asset. No Java, Gradle/version, manifest, voice policy, mode colors, core/specular design, updater or origin change. In particular this does not import the current live branch's unrelated Vault implementation or its app-icon/gloss design delta into the phone.

REUSE shared renderer and existing Android release/updater/owner-origin gates; NEW none.

## Status and promotion boundaries

- Source-only integration preparation; no APK built or signed, no version claimed, no publication authorized.
- `tests/orb-render-recovery.test.mjs` copied unchanged from the reviewed product commit; run locally with Node for source/lifecycle checks. Native compilation and WebView/pixel acceptance remain remote gates.
- Parent owns integration/release admission. Do not bulk-merge the live branch or this historical source branch into main.
- Source custody: retrieve the Thales receipt whose artifact SHA-256 is `5e8be00bd7161e07786e7d716698d4c12cc8450f12c8ab7f3906a97009d3161d`; require its source revision's Android tree to equal the proposed base. Recreate the orb-only derivative from that exact source if it differs. Asset parity alone cannot waive this.
- Signer: `3bf74d0b597bc170761079909d3692428702ba057f753ee1ffd62da3c76ed1fd`. Forum's Wizard OS signing environment and key directory are absent at both documented paths; the baseline certificate is independently verified. Never substitute the legacy Mobile signer. Restore the OS key through authorized secure custody before preparing the signed job.
- Version coordination: 83/0.10.19 remains staged by the orb-icon branch; PR681 and PR686 stage 84/0.10.20; PR714 stages 85/0.10.21. Do not leapfrog or claim a slot here. Fold the orb-only delta into the one coordinated successor source or reserve a slot with those owners first, then rebuild after the identity changes.

## Exact existing release route once blockers resolve

1. Re-read the live feed and signed baseline, confirmed source receipt and sibling version agreement. Preserve their accepted native changes. Bump only the agreed version/code.
2. Stage with `android-build-forum --prepare-only --wait-for-lock --project <confirmed-source> --gradle-dir android --java 17 --signing-env /home/james/.wizard-secure/wizard-os/signing.env --expected-signer 3bf74d0b597bc170761079909d3692428702ba057f753ee1ffd62da3c76ed1fd --output <new-private-output> -- :app:testReleaseUnitTest :app:lintRelease :app:assembleRelease` if Thales remains offline. Use the Thales equivalent when available. No Capacitor sync. Parent submits the returned exact worker argv/cwd, never a VPS Gradle command.
3. Keep signed and debug/QA-key builds separate. Run focused renderer/browser/native-overlay drawing/context tests and signed N→N+1 upgrade QA. Bind source, APK hash, package/version/certificate and old baseline. Require origin-custody skipped-version proof from exact code62 (`pre_pref_baseline: true`) and code82; do not seed away the no-Connect requirement. Ordinary paired upgrade proof is insufficient.
4. After native review/acceptance, use the existing owner publisher `tools/publish_owner_phone.py` from the admitted release tooling, not an ad-hoc file copy. Require encoded ORIGIN equality with private runtime settings, owner authorization and exact signed-byte metadata. Publish content first, feed last; verify feed, full downloaded hash and native in-app upgrade. No direct binary handoff as an updater replacement.
5. Parent retains physical-handset visual acceptance and the exact production update path. Synthetic context loss establishes recovery, not the screenshot's historical root cause.
