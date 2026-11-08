# Miguel shipped-commit coverage tail

Coverage against release/miguel a30a93b found features not present in the source PR heads: quiet notification threads/stacks and round 23c folded-rail marks. This integration ports only those view-specific hunks onto current main, not the whole older release tree.

- Restore opt-in `--wos-note-quiet` rendering and shared routing menu, clear button labels, stable newest-first notification stack, next item in place until the stack is exhausted.
- Folded rail uses one mark plus its count; no empty Ready mark. Preserve the stronger current-marker fix and project grouping already merged in #888.
- Keep main’s Incognito action, draft admission, routed search, stream terminal handling, renderer disposal guards, capture fixes, and retired-package/default policies.
- Reuse: EXTEND WizCore.chats (existing notification thread, routing and action path), not another notification inbox.
- Source commits: 96a128bdc, af9e83c92, e7ecb6da3, 005bf3717, f11d7b5be, 64b487ed6. Earlier quiet-thread scaffolding already present in the view CSS but omitted in the core portion of the source PR is now included.
- Canonical cross-agent pin/group/attribution browser parity remains an explicit separate follow-up. Final full-suite/two-skin acceptance is staged, not claimed executed.
