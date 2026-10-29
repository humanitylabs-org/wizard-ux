# Focused share-notification screenshot recovery

Reuse: n/a (QA-only tools/docs; no web/ or android/ edits).

## Finding and evidence boundary

The retained Android run's `notification-opened-thread.png` displays **Private notes / genuine.pdf / Synthetic comment one**, not the reported target's **x.pdf / Synthetic comment two**. Its notification visual verdict is therefore withdrawn; the other native/build evidence is not rewritten.

Source and retained synthetic-only evidence rule out two proposed explanations:

- The second native POST contains `agent: private`, no existing `thread`, `Synthetic comment two`, and exactly one `x.pdf` file. The two distinct shares each have one delivery.
- `WizardHandoff` logs the exact new thread ID. The WebView then issues an exact-ID `/sessions/<new-id>/messages?...&agent=private` GET. `tools/share-fixture.mjs` matches that endpoint and looks up `S.sessions[id]`; it is **not** the generic `/wizard/` catch-all. Retained fixture state contains the correct new thread title, comment and file chip, distinct from the old thread.

The actual acceptance defect is the predicate: it checks the focused **window model**, an intersecting `.ch-thread` rectangle, and `innerText.includes(filename)` **anywhere** in that subtree. It does not check that the delivered user-message file and comment are frontmost, that this WebView has focus, that the Android document-scroll owner agrees, or that compositor pixels agree. It discards its successful sample, then immediately takes a screenshot. Thus its PASS and the wrong screenshot are compatible: it was not a pixel assertion.

Cheap DOM-contract replay reproduces eight false positives against the original predicate (occlusion, unfocused/hidden document, transparent node, filename only outside the delivered body, wrong body filename/comment, wrong document owner); the repaired predicate rejects them. These are explicit contract models, not a reconstructed historical browser DOM.

The original run retained no successful predicate snapshot, hit-test, CDP target ID, compositor screenshot or post-screenshot sample. A log reports 40 skipped frames during notification foregrounding. **A stale surface/paint race is consistent with the evidence but not proved. A persistent product rendering bug is also not established.** Do not patch production speculatively or describe the old notification visual gate as passed.

## Smallest fresh gate

`tools/qa_share_notification.py` reuses the exact accepted QA app APK and exact accepted sender APK. It never invokes Gradle, a compiler, signer, release wrapper, publication or deployment.

- Stage full integration-head web source plus the QA-only repair; prove the complete Android input inventory/tree matches the accepted native build.
- In one new disposable emulator and loopback fixture, create the earlier existing-thread delivery/notification as necessary setup, then recreate the second new-thread interrupted-upload/force-stop/reopen notification. Do not rerun unrelated selector/cancellation/back/build/JVM phases.
- Tap real SystemUI notifications. Require foreground MainActivity and the exact new handoff ID; exact delivered user-message file and comment must be hit-testable in the focused visible WebView, with the correct document-scroll owner.
- Persist every readiness sample; require stable identity/geometry for 800 ms, two animation frames, native pixels, separate WebView compositor pixels, then another stable sample and native capture. Save exact-ID fixture response bodies, target metadata, logs and failure DOM. There is no input retry or injected open-thread intent.
- Emit only `AUTOMATED_PASS_VISUAL_REVIEW_REQUIRED`, never a visual PASS. Parent must compare `new-opened.png`, `new-webview.png`, `new-settled.png` and matching samples. If model/DOM are correct but only initial native pixels lag, classify capture timing; if settled pixels remain wrong, investigate the newly retained DOM/hit/target/response evidence before any product repair.
- Stop/reap the owned emulator and verify its exact ADB serial is absent before removing only this run's disposable AVD. Preserve original run and all new evidence. Enforce 200 GiB reserve plus 3 GiB task-owned peak; no unrelated deletion.

The packet's `--preflight` verifies immutable source/evidence hashes read-only. Only its parent may submit the heavy spec. A read-only preflight is not native execution. Inherited 384 JVM tests and other native phases remain labelled with the original source/receipt/hashes; fresh coverage is only the focused integration/notification scenario.
