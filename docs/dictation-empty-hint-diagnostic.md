# Empty hint fields: diagnostic gate before a product decision

## Historical protocol; later outcome

The sections below preserve the pre-fix diagnostic plan, not the state of the
current branch. The executed diagnostic receipt at source `bc9e87ef` has SHA-256
`78f90cdafb8403bdef2a907cc16874a12b5dfa3590993ed910189e64651be3df`:
both failing empty-hint methods observed a real 0/0 caret but a focused, editable,
hint-bearing node with -1/-1 selection and an invalid snapshot, no Wizard clip,
and exactly one IC dispatch. The nonempty control passed through paste.
`qa_dictation_empty_hint_acceptance.diagnostic_closure` checks these observations
and every raw evidence hash; it does not relabel diagnostic failures as success.

Only after that observation, `35ba3d29` normalized the narrowly defined empty,
hint-bearing, fully unknown node selection; generic unknown selections still
fail closed. Five additional cases and a strengthened saved-clipboard assertion
extend, rather than replace, the original 27 assertions. Full acceptance at
`4923ed0d` subsequently passed: 417 unit tests, 80 controller tests, 32 candidate
native cases, two baseline controls and two expected-failure rejected controls.
The old empty-hint and substring failures are retained and now pass. The complete
Android tree is `a2369ace7fe2c79255fac1f3607a7ea03dd96f45`, identical to the signed
`6ffb1b98` product. This is synthetic API35 evidence, not physical Graphene proof
or release authorization. No private owner data was used.

## Preserved pre-fix plan

REUSE `WizardKeyboardService` / `DictationCommit` unchanged at c07c16af;
EXTEND the debug synthetic editor and test-only observation; REUSE the controller
files verbatim from isolated QA 772c1424 (including fresh processes and
post-instrumentation real-service enablement). No UI/skin change. No alternate
insertion implementation, retry, fabricated action, selection edit, or owner data.

## Known facts, not a proposed fix

The retained isolated run has baseline 2/2 PASS, rejected 2/2 expected assertion
failures, candidate 25/27 PASS. The two remaining empty fields have a hint:

- `substringDoesNotVerifyInsertion`: actual `Hello `, commits=1/pastes=0;
  expected false, got true. That real IC insertion is correctly verified; the
  fixture's substring corruption exists in its paste channel only.
- `hintIsNotExistingTextAndSentenceCapitalizationSurvives`: actual empty,
  commits=1/pastes=0; expected true, got false. This mode deliberately no-ops IC
  and has working paste.

No retained file contains the exact pre-dispatch node selection/action list.
Do not assume those tests demonstrate incorrect exact-delta verification.

Public Android 15 r1 source supports a narrower hypothesis: `View` publishes
selection only for nonempty iterable text; `TextView.getIterableTextForAccessibility`
returns actual text, while `getTextForAccessibility` exposes the hint for empty
text. An empty node can therefore publish -1/-1 despite the real caret being 0/0.
`nodeText()` strips the hint but preserves -1/-1, so `Snapshot.valid()` refuses
paste *before* installing the temporary clipboard. Alternate explanations are
missing paste action after clip installation or a focus/snapshot fence rejection.
The exact emulator publication and service-received snapshot remain unobserved.

Sources (comparison, not proof of the installed image):
- https://github.com/aosp-mirror/platform_frameworks_base/blob/android-15.0.0_r1/core/java/android/view/View.java#L11432-L11442
- https://github.com/aosp-mirror/platform_frameworks_base/blob/android-15.0.0_r1/core/java/android/widget/TextView.java#L14111-L14174
- same TextView: `canPaste` L15467-L15472; `getTextForAccessibility` L14920-L14927;
  `getIterableTextForAccessibility` L15874.

## Independent one-shot consultation

Opus was consulted once before choosing the diagnostic design, with a bounded
empty-field brief, actual production/fixture source and known failure counters.
Validated response: `claude-opus-5-5`, effort high, one turn, no tools, no
permission denials, no error, normal completion. Independent position was
written first. Local audit transcript is under
`~/context/sources/projects/wizardos/claude-transcripts/2026-11-02-emptyhint/`.

Review delta: agreed that genuine IC success in `substring` must not be called
incorrect verification, and that production normalization requires runtime node
observations first. Adopted bounded opt-in debug publication/commit observations;
added an explicit service-side read of the real `focusedEditor()` and `nodeText()`
helpers before dispatch. Did **not** adopt provisional selection normalization,
change either expected result, or change clipboard restoration policy. Opus's
suggested `noopPaste` clipboard-restored expectation is not adopted: it is not a
justification to alter the existing uncertain-attempt custody contract.

## Narrow packet (diagnostic, not native acceptance)

`prepare_dictation_empty_hint_diagnostic.py --output <new local output dir>`:

1. Requires clean committed source, asserts no production or unit-source changes.
2. `android-build-forum --prepare-only` freezes the exact branch, canonical/debug,
   with full unit + lint + debug + instrumentation APK build tasks.
3. Stages the coordinator beside the worker, seals archive/config/worker/controller
   closure, proves all `android/app/src/main` files match the previous c07 build
   manifest, and preserves/hashes all 509 recorded native evidence files plus
   the prior native receipt, packet, and candidate build receipt.
4. Reads back the seal and exact parent-only queue spec. No build/emulator/queue
   submission during preparation.

Parent submits only the resulting spec to the forum heavy queue. The coordinator
passes the inherited queue descriptor explicitly into the build worker, then
starts a job-owned API35 x86_64 emulator with a new AVD, reserved ports, fresh
processes per method, real accessibility service enabled only after UiAutomation
registration, and finally stops its emulator. No owner config, credentials,
phone, private agent, Messenger, history, recordings or meetings are accessed.
Both origin overrides remain dead loopback.

Exactly three original methods run, preserving all assertion bodies:
`substringDoesNotVerifyInsertion`,
`hintIsNotExistingTextAndSentenceCapitalizationSurvives`, and the nonempty
`noopInputConnectionWorkingPastePreservesSingleInsertion` control. Every raw
failure is retained. `diagnostic-captured` means observations exist, NOT tests
passed; all receipts explicitly set `product_acceptance=false`. A fresh 27-case
acceptance + both baseline/rejected lanes is still required after a supported fix.

With instrumentation argument `emptyHintDiagnostics=true` only:
- the fixture records up to 64 publication/write observations with actual text,
  actual selection, hint, advertised text/selection/actions/focus/editability,
  clipboard label class and uptime. It changes no advertised capability or write.
- the instrumentation reads the real service node/snapshot and initial EditorInfo
  immediately before dispatch. It writes only a diagnostic JSON, never clipboard,
  selection, focus or editor content. The fixture captures publications throughout
  real product preflight, including any Wizard-clip refresh, and clip class at
  the actual single editor dispatch.
- dropped observations, missing records, foreign field, inconsistent initial
  selection or multiple/zero editor dispatches prevent a diagnostic conclusion.

Limit: the added pre-dispatch read can change accessibility cache timing. Its
snapshot is not falsely labelled a production-start local-variable capture.
Compare it with the ordered cross-process publications around actual dispatch;
if inconsistent, keep the result unresolved, do not normalize by assumption.

Expected discrimination, stated before execution:
- Invalid empty snapshot, -1/-1 published/received selection, real 0/0 caret,
  no observed Wizard clip, IC dispatch: supports the empty-selection hypothesis.
- Valid snapshot + observed Wizard clip but no paste action: inspect real
  TextView clipboard/action conditions; do not invent an action in the fixture.
- Wizard clip + paste action but IC: inspect focus/snapshot fence, not exact-delta.

## What remains intentionally gated

This branch is NOT a product correction. Product unit regressions and final
full-27+controls/native and owner-configured signed-release specs must be prepared
at the eventual supported production SHA, not at this unchanged diagnostic SHA.
The original `missingSelectionOrOffsetIsNotEmptyField` unit remains unchanged:
unknown selection is not silently converted into an empty caret. Do not deploy,
merge, publish a feed, or claim c07 complete from this packet.
