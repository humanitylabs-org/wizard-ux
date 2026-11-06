# Miguel follow-up disposition census (4 November 2026)

Previous covered release: `c474318ecc3a1a481ed8aaaef6dbdaeaf0dcb176`.
Fetched `release/miguel` boundary: `c474318ecc3a1a481ed8aaaef6dbdaeaf0dcb176`.

`git rev-list --reverse --no-merges c474318ecc3a1a481ed8aaaef6dbdaeaf0dcb176..origin/release/miguel`
returned zero commits. There are no new non-merge release changes to port in this follow-up.
Earlier dispositions remain in `miguel-device-view-coverage-20261104.md` and `miguel-release-coverage-20261104.md`.

## Settings repair disposition

Both current main and `release/miguel` already declare `data-settings-over` in the AI apps desktop layout,
with an explicit centred-panel comment. The desktop adapter only applied that contract on a later **open**;
turning AI apps on inside an existing Settings desk window left it in the view's right-hand panel.
This repair adopts that existing contract for an already-open panel without resetting Look, and one outside
close also removes the replaced Settings window. Other views retain their ordinary Settings window.

The shared Settings CSS already named an inline-size container but chose the category grid using viewport media
queries. At a wide desktop viewport a 470px app host still spent 280px plus gap/padding on the category column.
A host-width container query now uses the same category → page → Back stack below 700px, for every narrow host.
No second Settings renderer, shell-specific features, new palette or owner preference writes were introduced.

## Verification boundary

Browser-free Node DOM/CSS/host-lifecycle regressions accompany the repair. The v7 source-sealed forum gate retains
all prior phone/desktop view and two-skin coverage, adds >=280px Look-row checks and explicit narrow-host stacks,
and retries only detached-element scroll races after re-querying. Screenshots and real geometry remain a parent-admitted
gate, not evidence claimed by the source tests. No live deployment/restart is authorized here.

## Stale phone boot repair — Oscar for Miguel

Finding: https://github.com/humanitylabs-org/wizard-ux/pull/962#discussion_r4466692856 .
Credit **Oscar for Miguel**. Source-superseded #962 must not be merged; #964's catalog filtering did not
block the earlier host boot path. The host now checks built-in shell support synchronously, before any
layout data attribute, stylesheet or import. That same guard protects direct setLayout/use/load paths.

An unsupported query is ignored (so a valid cached Orb/Apps choice is preserved). Only a known unsupported
`wos.layout` materialized cache hint is removed. The canonical per-shell experience/views, mix, skin and
unknown keys remain untouched; repeated loads and repeated unsupported query links stay classic. Desktop
AI apps and both-shell Orb/Apps keep their existing boot behavior. This is not a shared preference reset.

The stale host inventory description now says desktop only and declares the same support as the tweak manifest.
It is not Settings' source: Settings renders WosExperience's manifest descriptions (`t.description`), already
desktop-scoped. A regression asserts both that boundary and agreement of host/manifest shell support.

`tests/stale-layout-boot.test.mjs` executes the complete production host with initial storage/query before
attach; then exercises actual experience catalog failure/deferred fetch and the host's timeout/slow return.
It includes no-storage/no-query controls, repeated loads, narrow cleanup and supported-shell comparisons.
Layout imports in that Node fixture are logged/stubbed, not real-browser mounting proof. The v7 forum gate
adds real phone storage/query/control cases under deferred-then-failed catalog on both skins, checks every
AI apps layout asset request, and reloads without re-seeding storage. Browser acceptance remains pending.
