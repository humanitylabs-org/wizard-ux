# Slices 1 and 3 implementation status

## Slice 1: implemented

`tests/feature-ids-in-core.test.mjs` runs in the existing `node --test tests/*.test.mjs` command. `tests/feature-id-scan.mjs` counts literal references throughout `web/` and `android/app/src/main/java`, excluding skin packages, `web/core/skins*`, tests and binary files. `tests/feature-id-allowlist.json` records the existing `path:pattern -> count` ceiling. New paths and increased counts fail; reductions pass with a hint to lower/delete allowlist entries. Tests cover the scanner exclusions and the ratchet itself.

The approved plan is copied verbatim into `docs/apps-out-of-core.md`.

## Slice 3: blocked before changing runtime code

The required shared owner-preference transport exists, but its schema cannot store launcher data or a versioned migration marker:

- `web/live.js:325-370` uses Agent Service `GET/PUT /wizard/v1/ui-preferences`; browser storage is only an offline cache.
- The running service's `server/ui-preferences.mjs` only validates `spaces`, `archiveAfterDays`, `compact`, `chatLayout`, `readyOrder`, `subjectOrder` and `pinnedChats`. Unknown PUT fields are rejected with HTTP 400; unknown stored fields are omitted from GET responses.
- `web/core/workspace-sync.js` uses `/wizard/v1/workspaces` for desks/windows, not arbitrary owner preferences. It has no migration-marker/launcher field.
- The direct read-only `GET http://127.0.0.1:8923/wizard/v1/workspaces` returned HTTP 403 under the installed owner-proof access policy. No live write was attempted and no real-state export was produced.

Do not disguise a per-device localStorage migration or a static JSON default as synced owner preferences. A companion Agent Service schema extension, including atomic seed-if-absent semantics and a marker beside the seeded launcher data, is needed before slice 3 can safely proceed. The web-only scope does not authorize that backend change.

Consequently all native tiles, launcher lists, recents defaults, auto-open defaults, hosted-thread admission lists, sigil fallbacks and display names remain unchanged. Food, agent-family ordering, Android sources and the separately owned companion pane remain untouched. No seeded preference key or migration marker has been created.

## Verification

- Origin/main baseline: 1008 tests, 1007 pass, 1 fail. The pre-existing failure was the COMPONENTS.md 14,000-byte ceiling (14,013 bytes). Shortening one introductory sentence without deleting any component entry fixes it.
- Candidate: 1011 tests, 1011 pass, 0 fail.
- `node --check` passes for both new `.mjs` sources.
- Adding an unallowlisted `usuals` occurrence in a temporary `web/core/feature-guard-probe.js` makes the actual guard fail: `web/core/feature-guard-probe.js:usuals: 1 > 0`, exit 1. The probe was removed before the passing suite.
- Browser/list-diff/screenshots and live-owner-state assertions are not claimed: slice 3 was not implemented and the owner-state export was denied. This PR changes no runtime shell bytes.

Reuse: n/a (tests and documentation only; runtime implementation is blocked on the shared preference schema).
