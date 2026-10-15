# Wizard Everywhere — processing feedback and admission lock

## Requested outcome
Long blue-orb dictation remains visibly in progress after Send and refuses a second recording until the pending take has finished inserting (or reaches a visible terminal failure). Keep true-idle battery savings. Trace introduction.

## Preflight
Standard bounded native reliability repair; no new interface/dependency/schema/provider. Direct Hermes/Sol implements; fresh read-only source reviewer before release. Source: daily 1cf3fcc, Android tree byte-identical to published 0.9.15/39 source 12b4cdd; signed build receipt thales:/Volumes/ThalesMedia/AndroidBuilds/jobs/20261014T152842Z-85da6b96/receipt.json; published SHA 8f14f084ea8065c3534ff00786554eed1a8cd230dce12810e51b16b9b774f70e. Release via existing private Wizard self-update feed, preserving signer, origin and shared native seams. Reserve 0.9.16 / 40 after readback; no sibling active release process observed, existing 37/38 reservations precede published39.

## Acceptance
- Send starts a distinct animated processing state that stays visible during delayed transcription and insertion, with no recording timer/microphone implied.
- Repeated tap/hold cannot open another take or menu while that work is pending; dragging still moves the orb.
- Retry waiting remains visibly pending and locked; terminal failure/empty/success releases logical admission. The microphone itself is released at stop.
- Completion returns to still blue ready state over a keyboard; hidden/screen-off orb draws nothing. Existing floating, side-button and Back behaviors remain.
- Exact signed APK builds/tests/lints on Thales, emulator delayed dictation + negative control and upgrade rehearse; release feed and transferred hashes verified.

## History
Missing processing state and unrestricted re-entry are already present in 02667b0 (9 Oct 2026, voice-typing insertion parity). On 14 Oct ff637a9 (replayed battery patch d6e640c), `Orb.setRestingMotion(false)` made the erroneous idle state draw zero frames; shipped in 0.9.15/39. The optimization correctly preserves actual think/listen animation; native simply never sent think. Fix native lifecycle rather than undoing idle savings.

## Delivered (15 Oct 2026)
PR #19 merged at `0d5b91a39e3aec0d18ca4214825ea203ca11072f`. Published 0.9.16 / 40 to the existing private native update feed and download mirror. Thales independently fetched both live feeds and full APKs, confirming SHA `5501f50180999f7a0819a6867a6f753ce854bb2a424dcd6f1c9b0a91a686cb10`, 3,685,269 bytes, and the mirror index 302 to 0.9.16. Download page title and current-release notes read back. Existing automatic updater handles installation; physical phone install is not claimed. No remaining owner gate for this repair.

## Verification (15 Oct 2026)
- Final product source `1d5ef5b337057c2254a31dd24dee71edd710ebb0`, pushed to `fix/everywhere-transcribing-20261015`.
- Thales release receipt `/Volumes/ThalesMedia/AndroidBuilds/jobs/20261015T040020Z-02709a1a/receipt.json`: release unit tests 188/188, lint zero errors, signed APK `5501f50180999f7a0819a6867a6f753ce854bb2a424dcd6f1c9b0a91a686cb10`, 3,685,269 bytes, same production signer, 0.9.16 / 40.
- Final debug receipt `/Volumes/ThalesMedia/AndroidBuilds/jobs/20261015T040056Z-32a9a43a/receipt.json` uses the same product source.
- `tools/qa_everywhere_processing.py` on API35 ARM emulator: 55/55; evidence `/Volumes/ThalesMedia/AndroidBuilds/qa/wos-everywhere-ffeecac9`, run log `/Volumes/ThalesMedia/WizardQA/everywhere-processing-20261015/native-r3.log`. Baseline 0.9.15 reproduces idle + overlapping-take admission. Candidate delayed STT animates, tap/hold rejects admission, dragging works, one insertion, retry wait stays busy, empty/terminal failure release lock; ready and screen-off draw zero frames; root Back stays in app.
- Review found existing carried-take Send must run before new-take guard. Fixed and regression exercises actual MainActivity appVoice bridge plus native remote-send dispatch while transcription is held. Carry state and response endpoint are explicit fixtures; no production message writes or physical-handset claims.
- Signed 0.9.15 → exact signed 0.9.16 upgrade: 6/6, `/Volumes/ThalesMedia/AndroidBuilds/qa/wos-upgrade-8d92aaa2`.
- No Mac guest rebuild; web runtime unchanged. Release publication/readback receipt is stored privately under `.hermes/data/releases/everywhere-processing/`.

## Surface boundary
Native floating Everywhere overlay only (assets/assist/everywhere.html and everywhere Java). Hosted in-app/desktop focused-field dictation has its own processing lock and label and is unchanged. Android work, Gradle, browser/emulator QA on Thales; no VPS SDK or heavy execution. No Mac guest rebuild for this repair.
