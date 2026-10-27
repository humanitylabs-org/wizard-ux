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
5. **Registry:** retain the owner's one-registry-per-shell crash fix, pinned-icon signature/cooldown and notification badge-read backoff; main's inbox API and item loading remain. Keep native launcher/source improvements from main.
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
