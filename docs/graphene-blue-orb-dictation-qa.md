# Graphene blue-orb dictation repair: insertion gate

Reuse: **EXTEND** `WizardKeyboardService`, `EverywhereService.onDictated`, `EverywhereOutbox` and `CaptureJournal`; **REUSE** existing cleanup, capitalization, clipboard ownership and custody policy. No new recorder, STT route, private data source, UI skin or delivery adapter.

Latest accepted Android tree: `a2369ace7fe2c79255fac1f3607a7ea03dd96f45`, shared by
signed `6ffb1b98` and validated `4923ed0d`: 417 unit tests, 80 controller tests,
32 candidate native PASS, two baseline PASS and two exact expected rejected
failures. The 23-case description below is the earlier protocol, expanded to 27
ownership cases and then five empty-hint regressions without weakening original
assertions. See [the diagnostic chronology](dictation-empty-hint-diagnostic.md).
Offline upgrade acceptance is separate from this full native gate; neither
alone authorizes publishing or claims physical Graphene acceptance.

## What this revision fixes

The rejected candidate stopped after an unverifiable input-connection commit, even when native paste would work. Its changed-plus-contains check could claim success for punctuation/case/substring changes, and its node-dependent readback disabled a working surrounding-text connection when no readable editable node existed. These are source-confirmed problems, not a diagnosis of James's handset.

- Refresh the active window's real input focus; never write to the cached last-focus node.
- When readable node text/selection exists, put the shaped payload on the clipboard, refresh again and choose paste **only if that same focused editable node advertises `ACTION_PASTE`**. Android's paste advertisement depends on clipboard availability.
- Otherwise use a readable accessibility input connection, including when no editable node is exposed. Capture the accessibility input-method lifecycle generation, editor package/field/type and available window identity. AOSP returns a fresh Java connection wrapper per lookup, so wrapper identity is not a remote-editor identity.
- Recheck focus/selection immediately before dispatch. One selected channel, one editor mutation. False/throwing action results, delayed mutations and missing readback never authorize a second automatic strategy. No whole-field `ACTION_SET_TEXT`.
- Shape from the chosen snapshot with the existing capitalization/boundary-spacing rules. Do not strip requested leading space. Hint text is not field contents.
- Verify exact selected-range replacement, collapsed cursor and unchanged neighbors; never case-fold, trim, or substring-search the evidence. For IC windows, use absolute offsets, all overlapping prefix/suffix characters, nearby anchors and known end-of-field bounds. Unknown offsets/insufficient context/IME transformations are conservative uncertainty, not claimed success.
- Poll asynchronously at 100/250/500 ms, with a 1.5 s fallback. No explicit main-thread sleep. Platform accessibility/IC calls themselves are still synchronous Android RPCs; this is not a claim that every RPC is nonblocking.
- Restore a readable saved clip only after verified paste and only while its unique label/text still belong to this attempt. A newer clip wins; unavailable clipboard reads never justify blind restoration/clearing. An uncertain paste keeps its exact shaped clip untouched: a delayed paste may still consume it, so the caller must not replace it with trimmed recovery words. IC uncertainty prepares its shaped recovery clip before completing.

## Completion and retention

`EverywhereService.onDictated` now owns asynchronous completion explicitly. The outbox saves and fsyncs `dictationAttempted` **before** handing off. Exactly one listener owns insertion; no-listener/throw/timeout retain the item. Pending delivery is not `sent` and does not release custody merely because a callback was scheduled.

Verified insertion completes/removes the item and releases `DELIVERED_ON_PHONE`. Unknown/unavailable delivery retains both transcript and the original recording; it copies recovery words where possible and says to check the field before pasting when a write may have happened. The attempted marker persists across restart/manual Retry: that same item becomes copy-only, not a second insertion. Existing short-window duplicate-text suppression remains, in addition to the durable per-item fence.

## Design consultation and evidence boundary

Before edits, a single no-tools/no-MCP Opus design consultation approved one-channel, exact-snapshot, asynchronous completion, with corrections around clipboard-dependent paste advertising, lifecycle generation and retention. Actual model: `claude-opus-5-5`; one turn, no tool calls or permission denials. Prompt/response are retained outside the repo under `~/context/sources/projects/wizard-mobile/claude-transcripts/20261102-graphene-revision-design-*`. Archimedes implemented the code, not the advisor.

AOSP Android 15 source was checked for `AccessibilityService.onCreateInputMethod`, input-method lifecycle hooks, fresh connection-wrapper allocation and `BaseInputConnection` absolute surrounding-text offsets. The insertion strategy remains conservative for editors without trustworthy selection/context, composing spans or autoformatting.

The previous synthetic AAC server response proves only the server transcription route. No owner audio/history, private agents, Messenger or meeting API was queried. No new handset test or handset cause is claimed. No release publication is authorized here.

## Runnable native gate

`DictationInsertionE2eTest` uses the **production inherited `EverywhereService.onDictated`**, production outbox/custody, system-bound real accessibility service and a debug-only native EditText in a **different process**. The attached caller intentionally avoids unrelated `onCreate` meeting sync/network/overlay startup; this is a caller/insertion/delivery integration test, **not** a full orb gesture/microphone/handset test. Fixture transcripts and the tiny valid PCM-silence custody WAV are synthetic only.

The 23 candidate cases cover:

- readable no-op IC plus working paste (zero IC commits; exactly one paste);
- missing node plus working IC (exactly one commit; no paste);
- opaque IC, no-op paste/IC, false paste return with late insertion;
- pending authority and main-looper heartbeat during delayed mutation;
- punctuation/case/substring false positives;
- identical selected phrase and middle-range replacement;
- hint/word/sentence/newline capitalization and spacing;
- focus loss before dispatch (zero writes) and during polling;
- unreadable selection plus opaque IC (zero blind writes);
- saved/newer clipboard restoration ownership;
- persisted-attempt restart/Retry and no-listener retention;
- exact single completion and original synthetic recording retention/release.

Two decisive tests are also overlaid unchanged on the installed-source baseline `a1e00dafbed3bcadc8fda098a9f9255b4437ce88` and rejected source `bf77326b6f7bc4d0be2f8b973c34a1d53bc0f741`. The gate requires baseline **2 PASS**, rejected **2 expected assertion failures at exact field text**, candidate **23 PASS, zero skip**. Control builds change only the three fixture/test overlay files, never production source. Build/fixture errors do not count as expected rejection.

`tools/qa_dictation_packet.py` verifies an immutable seal, runs three prepared unsigned debug/control workers, then `tools/qa_dictation_insertion_native.py` on one job-owned API35 x86_64 KVM emulator. The emulator is stopped in `finally`. Raw instrumentation protocol, per-variant APK metadata/hashes, logcat, screenshot, editor state, full unit XML census and lint XML are retained and hash-bound in native evidence. Counts are parsed, never inferred from a Gradle exit or a matching phrase.

Only the lightweight Python protocol-controller tests run at preparation time. They are **not Android compilation or native acceptance**. All Android compilation/lint/native execution must go through the parent's forum heavy queue. A prepared packet is not a passed build.

## Separate signer domains

The old mixed debug/release artifact audit failed because the worker applied the OS release pin to the first debug artifact. Preserve that historical receipt; do not relabel it as this revision's result.

1. Candidate full unit/lint/debug/test APK and both source controls: **no signing environment and no expected release signer**.
2. Separate release-only worker: `:app:assembleRelease`, explicit absolute worker paths in `WIZARD_OS_SIGNING_ENV` and `WIZARD_OWNER_CONFIG` (or preparation flags `--signing-env` / `--owner-config`), exact OS pin `3bf74d0b597bc170761079909d3692428702ba057f753ee1ffd62da3c76ed1fd`. Paths are metadata only; controllers never read the credential files. Missing/relative paths fail before preparation. No default/debug task or artifact may enter this job.

Parent owns heavy admission, independent exact-head review, native result evaluation, any further owner/Graphene QA and release decision. Keep candidate version 88 unpublished until those gates pass.

## Source reconciliation is not a release decision

The verified repair starts at installed source `a1e00daf` and reconciles only the
actual PR/live base `fe79cbd3`; shared main has divergent, lower-version Android
source and an unrelated app-ID migration. Do not bulk-merge it or replace the
live web to make a phone-only repair appear current. The complete Android tree,
not the root commit or a version label, binds the existing signed artifact and
native acceptance. Later controller/docs corrections do not rebuild or relabel
those artifacts. Preserve failed historical evidence and its original hashes.

PR839 is prepared for normal independent source review, not merge/publication.
The publisher audit is read-only. Actual private-feed publication remains gated
by `docs/phone-owner-release.md`: a human approves the exact signed artifact and
upgrade proof before the canonical publisher receives `--publish`. A source
review comment, an emulator pass or an original request to fix the bug is not
that exact-artifact approval. No approval or waiver is recorded by this document.
