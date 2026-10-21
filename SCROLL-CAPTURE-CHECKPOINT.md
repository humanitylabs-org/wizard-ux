# Samsung scroll capture repair

Owner: originating Samsung scroll-capture thread; branch `fix/samsung-scroll-capture`, based on `origin/main` 0b2c34fe. Keep PR open pending James's Samsung test. Do not merge automatically.

Outcome: Samsung screenshot toolbar discovers the visible inner Chats scroller and programmatic native scroll moves it, without changing touch/fling/Back or the existing AOSP ScrollCaptureCallback.

Lane: Standard bounded native behavior repair; source-origin trust is consequential, so require main-frame origin-scoped WebMessageListener, private/QA and FLAG_SECURE guards, focused negative tests and independent parent review before release.

Acceptance:
- One shared geometry/occlusion selector powers AOSP capture and passive scroll metrics; no idle polling/network/storage.
- Native metrics use physical pixels and programmatic scrollTo/scrollBy target only that exact current scroller; untouched touch path.
- Every empty AOSP discovery result logs a bounded reason (no chat content/URL) to WizardScrollCapture.
- Browser contract, JVM math tests, API35 OS Capture more saved-pixel test + native proxy instrumentation, Back and signed old→new rehearsal pass on Thales.
- Same package/signer successor published to `/reports/wizard-os/latest.json` with exact hash readback from Thales. Samsung remains an explicit physical-phone gate.

Preflight: live feed read from Thales 0.9.35/code59, SHA ce4068f7dc6194d1bd3b505ede8a3229c0c554ecd165352fa5dedfe3d1eae4c0. Source main is 0.9.36/code60 (James reports installed60). Reserve 0.9.37/code61, recheck feed/main/sibling reservations immediately before build/publication. No open native-release PR owns61 at discovery. Permanent signer 3bf74d0b597bc170761079909d3692428702ba057f753ee1ffd62da3c76ed1fd. Thales reachable; all jobs/evidence under /Volumes/ThalesMedia.

Subagent constraint: helpers cannot admit durable heavy jobs. Prepare immutable pushed source with android-build-thales --prepare-only and return exact chain/submit payload to parent, who owns build→QA→publication continuation.

Executed evidence:
- Thales `/Volumes/ThalesMedia/QA/samsung-scroll-capture/browser-r5/results.json`: browser helper-on/off 38/38, zero page errors; DPR2.625; metrics/capture lifecycle/Back pass. Browser-r1 and baseline retain the same three original fixture failures; fixed fixtures account for transformed containing block + pointer events and the shell's existing initial reader-position settle (simulate reader wheel before capturing). No production web behavior changed.
- Thales `/Volumes/ThalesMedia/QA/samsung-scroll-capture/math-tests.log`: real JUnit 4.13.2 `OK (3 tests)` on JDK21. Full Gradle suites still required.
- Local `git diff --check`, Python compile of all three QA entrypoints: pass.
- Lock-free remote preflight caught a pre-existing `qa_paths.py` self-import cycle (blocks every Python emulator QA entrypoint after the portable-path migration). Removed it and added 3 import/config regressions: pass locally and on Thales. Remote chain/QA imports, explicit work/SDK/JDK config and actual `Emu(Path,port,pkg)` / `kill()` API construction-cleanup pass without starting an emulator. The final submit spec must explicitly set WIZARD_WORK_ROOT, ANDROID_HOME and JAVA_HOME; the chain now rejects missing configuration clearly.

Release continuation (parent):
1. Use the two returned prepared job dirs and the pushed `tools/qa_scroll_release.py` copied into the release job dir as `chain.py`, with the pushed `tools/qa_paths.py` beside it. Exact argv: `/opt/homebrew/bin/python3 RELEASE_JOB/chain.py RELEASE_JOB QA_JOB /Volumes/ThalesMedia/QA/samsung-scroll-capture/wizard-os-0.9.35.apk NEW_EVIDENCE_DIR REVISION`. Submit once using wizard_heavy_submit (normal Android lane, not light), cwd RELEASE_JOB. The wrapper builds both jobs, verifies manifest/revision/signer/version and JVM suite, then runs signed upgrade, actual AOSP SystemUI Capture more saved pixels and native View instrumentation + Back. It deliberately never publishes.
2. On successful durable receipt, read phase logs/receipt, fetch the signed artifact only, recheck current live feed has not advanced. Publish APK plus latest.json atomically to the existing private-reports/wizard-os route, preserving full signer and hash fields; no download-navigation fallback. Read feed and exact APK hash back over HTTPS from Thales.
3. Update PR/evidence and owner-facing release note. Do not merge: physical One UI toolbar remains James's phone check. The available previous published baseline is59; no0.9.36 APK exists in the report directory, so upgrade rehearsal starts from the feed's59 rather than assuming the reported60 artifact exists.
