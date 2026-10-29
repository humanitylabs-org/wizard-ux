# Owner shell / main sync reference — 27 October 2026

**Reference only: do not merge or deploy this branch as a feature PR.**

Parents: owner live `24ea55671a92904da538732a210ff673a0f21515`; fetched shared main `4f50011b44d9c07891fe12b5d72cb3ee7b376ca2`. This is a merge, not a rebase. The serving checkout and container were not changed. Source for the preview is a separate committed worktree.

## Reuse

- REUSE: the shared Chats renderer, composer, attachment chip, media viewer, Spaces model, browser/history guard, appearance transport and skin host.
- EXTEND: those same modules with the owner's existing app-orb, fingerprint-vault/identity, composer-seat, dictation and sharing behavior. Preserve main's streaming, notification/inbox, keys, install links, owned-skin lifecycle and native-source changes.
- NEW: regression tests and this integration audit only; no second capability implementation.

## Conflict decisions

There were 91 conflicted files / 298 conflict blocks. The machine-readable block ledger is `docs/owner-shell-sync-conflicts.json` (one-based block numbers, original file order). Independent additions from either side are retained. Specific choices:

1. **Chats:** owner's day-wide Ready ordering also orders Yesterday/Past week; main's Snooze-last tweak remains opt-in and splits awake rows from the snoozed tail. Main's `ready-top`, `ready-end`, `archive-top`, notification-thread hooks, one activity disclosure, inline images, model refresh and disappearance invalidation remain.
2. **Composer/orbs:** retain the owner's measured orb seat, empty-draft/Send swap, agent-model fitting and white current-app glyph. Main's composer slots and notification/steering controls remain. The app-orb host API remains alongside main's refreshed skin-host capabilities. Remove the duplicate `lastBeside`/`emitBeside` backport, retaining main's implementation.
3. **App services:** retain owner vault, Wizard ID, ducking, app orb and document-scoped late-reply checks. Main's filtered media-view implementation replaces the older duplicate; shared voice, companion, grants and navigation APIs remain.
4. **Sharing:** retain the live Blob/image/file handoff and destination dropdown, read-only quoted forward, independent comment, and immediate close/background upload. Keep main's current shared service transport and selected-media filtering. Existing PRs cover these; do not recarve them.
5. **Registry:** retain the owner's one-registry-per-shell crash fix, pinned-icon signature deduplication and notification badge-read backoff; main's inbox API and item loading remain. Keep native launcher/source improvements from main.
6. **Store:** retain owner's setup gate/checklist, single install transaction, post-install setup, and My apps navigation inside the running shell. Integrate main's `wizard://install` previews, sources and private-catalog actions; do not fork an install client.
7. **Settings/Look:** keep owner's public Wizard ID row. Use main's named, box-owned skin lifecycle (including legacy singleton migration) rather than retaining a parallel old My-skin store. Main's app-border tweak migration replaces the old permanent Borderless row, following the current owner design contract. **Visible difference from live; James must review.**
8. **Desktop/tour:** keep main's windowed Settings/preview lifecycle, current keyboard guide and current first-run tour rather than restoring stale conflict copies; carry the owner's setup gate into those paths. **These are visible changes from live, not byte-identical owner UI preservation; review before promotion.**
9. **Inventories/docs:** combine actual entrypoint assets and module/slot inventories, use current compact main registry descriptions plus setup row, and retain both sides' feature-reference ceilings. No broad owner-appearance hash waiver was granted.
10. **Back:** the old browser root still offered a double-Back exit, unlike native. Remove that escape path so every Back consumes one layer or remains Home, with a named executable regression. Hosted-app navigation and main's nested-window handling remain. Browser evidence is separate from physical Android evidence.

## Offline Chats exclusion

The live revert `6e71d977` stays in ancestry. None of the deleted reading-kit/flight/landing-reply files are restored. `tests/owner-offline-chat-exclusion.test.mjs` checks all removed runtime/docs/QA paths and scans runtime web/Android source for the removed globals, module imports and UI hooks. Existing durable message custody and ordinary read-through caches are not treated as the rejected download experiment. App-owned Wisdom is not removed.

The offline commits remain historical ancestors only; this merge cannot erase them without rewriting history. Do not cherry-pick them into the future feature PRs. In particular, do not merge the broad offline PR or the old broad reconciliation PR.

## Acceptance status

Local bounded parsing and `git diff --check` are performed before push. Full Node/CI and delivered-HTTPS Playwright checks run on forum, not the control plane. No claim of passing integration or owner acceptance is made until the exact-head results are recorded. Private screenshots and live data do not go into the public PR.

## First CI / conflict follow-up

At `a7500347`, shared-features ran 1308 tests: 1293 passed, 14 failed and one was skipped. The guard failures were not waived. The follow-up preserves owner registry-echo deduplication while allowing main's genuine icon/name changes and explicit resume retries, restores owner model-sheet revalidation plus main's current/default safety checks, uses the shared portable Playwright loader, and verifies the additive bounded app-orb skin API. A named repeated-registry-echo regression was added.

## Forum failure follow-up

The original exact-head forum run at `a6cbeb6f` ran 1309 tests: 1300 passed, eight failed, one skipped. Untouched main passed 1238/1238. This follow-up does not turn the reference into an accepted release.

- **Back evidence was misclassified.** The phone predicate only measured dimensions, so the closed Settings sheet translated above the viewport still counted as open. The desktop assertions accepted only `/wizard-os-home/`, rejecting the legitimate `/wizard-os-home/desktop.html` entrypoint. Both shells actually consumed the thread/category/Settings steps without leaving. `qa-owner-shell-sync.cjs` now uses viewport intersection, recognizes both exact shell entrypoints, and presses real browser history Back for both Settings steps. Predicate regression tests preserve the reported geometries.
- **Shared Back safety:** `WizAppServices.guardBack` still had main's ordinary-browser double-Back exit fallback, even though desktop's adapter always claimed the step. Remove that fallback in the shared implementation; test false-at-root adapters, repeated history Back and CloseWatcher, and preserve app-owned popstates. REUSE the existing guard; EXTEND its no-exit invariant, not a second history consumer.
- **One unit-test mismatch:** `1522804f` explicitly imported web identity only. The old native signer cancellation assertion required an implementation absent from the tracked Android tree in that very commit. Retain real scroll-capture cancellation and missing-bridge refusal; assert that the legacy app bridge does not advertise unsupported signing. No native code or untracked signer was imported, and native signing is not claimed working.
- **Notes/hosted-app isolation:** fresh QA browsers imported the live workspace, opening unrelated apps and moving focus away from Wisdom. Focused scenarios now disable workspace sync in disposable browser storage, not in the product. A separate read-only Notes check exercises the real app at phone width on Nebula and Landscapes; no response data is synthesized. Workspace-on first-join focus remains a separate limitation, not a claim of passing sync behavior.
- **Wisdom fixture:** the daily hero can be a chapter, not a collection. Follow the real chapter's visible parent Back to open its collection. Cold/restored scenarios now start fresh browser contexts instead of inheriting earlier tests' refused progress writes and offline queues. Continue to reject all server writes with 403, record request/page errors, and assert no page errors. App-owned Wisdom offline support is untouched.
- **Seven protected appearance failures remain:** five owner-skin fingerprints and two collaborator-only dock assertions reject the historical live white current-app glyph. No approved hash, guard, CSS or glyph has been changed to hide this. The focused appearance group is 11 tests, four passing and seven failing. James must decide whether to keep his live white app glyph or return to the shared-main glyph behavior before any approved fixture change. No blanket exemption is requested.

Focused forum checks before republishing: 43/43 integration tests passed, including the no-exit and offline-exclusion regressions; corrected delivered-HTTPS matrix passed 24 assertions across four phone/desktop + Nebula/Obsidian cases against the original preview; Notes passed 2/2 and Wisdom passed 10/10 with the corrected fixtures. These do not substitute for the new exact-head full run. The next immutable worker runs all tests, keeps the protected failures, and separately runs Notes, Wisdom, swipes and the matrix.

The visible main-vs-live Settings/skin lifecycle, desktop preview and tour choices in decisions 7–8 are still unaccepted differences. These fixes intentionally do not disguise them as owner's live UI. No live container restart or main merge is authorized.

The five protected owner-skin hashes and old skin-only dock assumptions are still an explicit acceptance issue: the live white current-app glyph intentionally changes those owner rules. Native identity signing remains separately owned; this branch only tests its shipped web refusal/lifecycle boundary. Do not claim a green reference or regenerate approved owner hashes to conceal this.
