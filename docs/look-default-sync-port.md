# Shared built-in appearance choices: live-to-main port

Port the live-only `ab22897411daac37808fb0b36b1666705ac3b79e` repair onto
`1819072989978caa2030d9a7f81b39376323888c`, preserving #964/#966/#967.

Reuse:
- Shared appearance document: EXTEND WosLookSync (Pages versioned file).
- Built-in switches and migration: EXTEND WosExperience.
- Shell-type views and New skin filtering: REUSE existing #967 implementation.
- NEW: none.

`look.json.defaults` is an optional map of built-in tweak IDs to `{on, at}`.
Old files still parse unchanged. Upgraded clients seed missing defaults from
locally migrated choices without replacing shared entries. Custom skin recipes
remain under My skin; device-local personal-script approvals never transfer.

`WosExperience.adopt(mix, views, defaults)` retains the second argument's
per-device views contract; defaults use the third argument. Built-in events use
`wos:tweak-choice` with `scope: default`, separate from ordinary tweaks/views.
Defaults join parse/merge/seeds/pending/storage/logical clock/adoption. Like #967
view intents, an unsent default intent is based once after GET/409 observation;
a previously sent intent is not repeatedly restamped to defeat a newer writer.
PUT acknowledgements overlay later pending defaults and views before adoption.

The live repair's migration-ready startup and 30-second visible-only refresh are
retained, with one cancellable loop and no hidden/stopped periodic requests.

## Verification

The original hotfix contains no new tests. Its corresponding open #956 branch
has four directly relevant source regressions; these are ported into
`tests/look-default-sync.test.mjs` with the new three-argument adoption contract,
plus held GET/PUT, 409/newer-writer, reload, old-document and simultaneous
per-device-view/tweak/default cases. The unrelated #956 chat-inventory work is
not included. #956 remains separate and must reconcile this appearance subset.

Before source changes, the first four new cases fail on the base (0/4); after,
`nice -n 19 node --test tests/look-default-sync.test.mjs tests/look-sync.test.mjs`
passes 41/41 (29 existing look-sync cases and 12 default-sync cases),
including a sleeping stale client editing colour, a view and an ordinary tweak
without republishing its outdated built-in choice.
The components inventory guard also passes 3/3. Full npm, real temporary-directory
audit and browser screenshots are
separately staged for parent-owned forum admission; local source tests are not
browser or physical-phone acceptance. No live deployment/restart is part of this
port.

Runtime/product delta against `181907298997` is limited to
`web/core/experience.js` and `web/core/look-sync.js`. Settings rendering,
New skin filtering, view mount/rehosting and styles are unchanged. The round9
forum continuation preserves the round8 cases and adds desktop-to-phone
built-in switch convergence on Nebula and Obsidian light with screenshots.
