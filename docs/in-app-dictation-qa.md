# Focused-field dictation — implementation / QA handoff

Feature branch: `feature/in-app-dictation`. Untouched baseline: `201b4e66d1c3d8a7c9772787721ba028bdce2d58`.

## Contract

- Focusing a selection-capable text input, textarea or contenteditable in the phone shell / a registered same-origin app turns the **existing orb** blue. Tap records; tap again transcribes and inserts at the selection captured at START. It does not submit, execute app voice capture, route a command, consume the composer, upload attachments or enqueue an agent run.
- The capability pins the exact node, owning document, app admission, URL/navigation generation and original value/range. Edits, removal, reload and navigation fail closed to a retained transcript with Copy. Changing focused fields never redirects insertion to the new field. Open shadow inputs work. Passwords, unsupported selection types, readonly/disabled controls and `data-no-dictation` are excluded.
- Full-screen reading still hides the orb. Focused text temporarily exposes the same corner orb; recording retains controls. Leaving text restores its normal mode.
- Hold still records a command. The Chats composer **MIC** still records/sends its pinned voice reply. Live Chats rendering retains the sealed input node within that same draft; changing threads destroys the capability.
- Native dictation is an explicit `dictation` kind with durable negative-send provenance, including the shipped kind-less active-recording ABI. Reopening cannot reconstruct a DOM target: it transcribes for copy only. Pending notification Send does **not** auto-send dictation. Shared-app recording ownership remains authoritative.
- Failed / displaced dictation is retained through Settings → Cancelled recordings (transcribe/copy, not agent outbox). Native audio is released only after successful insertion or successful durable recovery persistence. Cancel / pause do not send. STT has an abortable bounded deadline and operation fences.
- Desktop's existing `wizard:dictation` bridge reuses the shared helper. No keyboard/Right Option recording ownership or desktop voice UX was changed.

## Source

New: `web/core/focused-field.js`, `qa-in-app-dictation.cjs`, `tools/qa-dictation-ab.cjs`, `tools/qa-playwright-thales.cjs`.

Integration: `web/app.js`, `web/device.js`, `web/core/cancelled.js`, `web/core/config.js`, `web/core/chats.js`, `web/core/app-capture.js`, both shell HTML loaders, `web/styles.css`, and `web/desktop/desktop.js`.

`qa-voice-seal.cjs` now explicitly blurs a focused composer before starting AGENT orb voice. Its old focused-composer tap expectation intentionally conflicts with the new dictation contract; the new suite covers the focused path separately, using real orb gestures.

## Thales evidence

All browser runs were on Thales. No Android builds, deployment, remote push, daily-worktree modification or real Hermes write occurred.

Root: `/Volumes/ThalesMedia/wizard-ux/in-app-dictation/`

- `base/`: untouched archived baseline web source.
- `candidate/`: candidate source and identical test scripts used for both asset trees.
- `evidence/base-dictation.{json,log,exit}`: **33 passed / 30 failed**, exit **1** (new feature absent, including actual agent fallback after app removal).
- `evidence/candidate-dictation.{json,log,exit}`: **63 passed / 0 failed**, exit **0**.
- `evidence/candidate-dictation-focused.png`, `candidate-dictation-keyboard.png`: focused-field / reduced-viewport full-screen screenshots.
- `evidence/final-regression-ab.json` and per-suite `final-{base,candidate}-qa-*.{log,exit}`:
  - voice seal: **45 / 0** on each, exit 0; final candidate rerun also 45 / 0 after desktop helper integration.
  - held commands: **29 / 0** on each, exit 0.
  - awake: **11 / 0** on each, exit 0.
  - immersive: **26 / 1** on each, exit 1. Identical baseline fixture gap: generated review-window data absent (`review window present for the non-Chats case`). New suite separately covers real non-Chats app full-screen focus, orb hit testing and app/root Back.
- Initial un-enriched regression attempts and the original voice-seal focused-tap failures remain in `regression-ab.json`, `synthetic-regression-ab.json` and associated logs; they are not represented as passing runs.

The fixtures are explicitly **synthetic STT/native ABI/model/API**. The browser microphone case exercises Chromium's actual MediaRecorder with its fake microphone. Every request in the new suite is locally intercepted. Dictation cases assert zero router/upload/session/run writes. Composer MIC tests deliberately exercise a separate synthetic accepted voice-reply write. These results do not claim physical Android microphone/keyboard validation or an actual I Ching server integration.

94 candidate web files were byte-hash compared to this worktree: no mismatches. Baseline web files were byte-hash compared to the baseline Git objects: no mismatches. Lightweight local `node --check` and `git diff --check` passed.

## Re-run commands (Thales)

```sh
cd /Volumes/ThalesMedia/wizard-ux/in-app-dictation/candidate
export NODE_PATH=/Users/thales/workspace/wizard-mobile-link-candidate/node_modules

# Run the SAME suite against baseline and candidate. Preserve each exit separately.
for label in base candidate; do
  QA_WEB_DIR=../$label QA_EVIDENCE=../evidence/$label-dictation.json \
    /opt/homebrew/bin/node qa-in-app-dictation.cjs \
    > ../evidence/$label-dictation.log 2>&1
  result=$?
  printf '%s\n' "$result" > ../evidence/$label-dictation.exit
done

# Additional suites: synthetic authority fills older missing model/read fixtures.
QA_SYNTHETIC_REGRESSION=1 QA_EVIDENCE_TAG=final \
  /opt/homebrew/bin/node tools/qa-dictation-ab.cjs \
  /Volumes/ThalesMedia/wizard-ux/in-app-dictation
# Exit 1 is retained for the matching baseline/candidate immersive fixture gap.
```

Next release gate belongs to the parent: stage an isolated functional preview, test the actual app/physical phone, then seek release approval. No live release authority was assumed.

## Parent review repair and functional preview

The independent read-only review found three recovery faults: the shared ownership classifier omitted kind-bearing dictation; incomplete native audio readback could be treated as silence and deleted; failed IndexedDB retention was reported as durable success. The parent repaired all three, added exact-ID claimed-take recovery markers before native claim, preserved explicit retry through reload, and added an honest session-only browser retention owner with Retry saving. Explicit recovery Delete clears its marker too. The focused-composer MIC keeps the screenshot/attachment dock; its agent send path remains separate.

Final expanded suite on Thales:
- Reviewed `e638260` source with the SAME expanded suite: 65 passed, 5 failed, exit 2 (the missing recovery UI stops further baseline cases). This is retained as failing evidence, not a complete baseline pass.
- Repaired candidate: **95 passed, 0 failed**, exit 0. Evidence: `evidence/recovery-final-{reviewed,candidate}.{json,log,exit}`. Covers kind-bearing native recreation, failed first/later/truncated/looping audio read, claimed-file discovery after page reload, repaired explicit retry, explicit Delete, native persistence outage, actual IndexedDB write failure and successful browser save/reload.
- Voice seal 45/0, held commands 29/0, awake 11/0 remain unchanged in `review-fixed-regression-ab.json`; immersive remains the same 26/1 baseline fixture gap.

Historical functional preview: `/wizard-os-home/?shell=phone&open=iching` on the retired custom domain.

The parent opened that exact HTTPS deep link on Thales at phone dimensions and used the actual registered I Ching, the user's approval audio as Chromium's fake microphone input, the real browser MediaRecorder, and the selected system STT endpoint. **11 checks passed:** blue orb focus, recording, START-selection insertion, editable unsubmitted question, exactly one real STT request, zero agent/app writes, true-fullscreen keyboard-sized orb hit testing, Back staying in Wizard and zero page errors. This proves the real hosted app/provider integration, not physical-handset capture. The functional preview permits only POST `/wizard/voice/transcribe`; all app/agent mutations return 403.

Preview source lives in a detached durable clone, `/home/telos/.local/share/wizard-stage/in-app-dictation/source/`, behind an enabled restartable `wizard-stage-in-app-dictation.service`. Original live shell and daily remain unchanged. Final candidate source hashes and parent evidence are retained there and on Thales at `release-qa/`. Physical phone feel and release approval remain James's gate.
