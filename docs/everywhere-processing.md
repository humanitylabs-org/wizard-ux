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

## Surface boundary
Native floating Everywhere overlay only (assets/assist/everywhere.html and everywhere Java). Hosted in-app/desktop focused-field dictation has its own processing lock and label and is unchanged. Android work, Gradle, browser/emulator QA on Thales; no VPS SDK or heavy execution. No Mac guest rebuild for this repair.
