# Shared responsive feature contract

New cross-platform UX belongs in `web/core/`, registered once and rendered by both shells. Shell adapters may own layout, navigation and input (touch/orb versus keyboard/window manager), not duplicate feature markup, state or action dispatch.

- Settings: add one `WosSettings.register({ id, html, act, aliases?, available? })` in `web/core/settings.js` (or a shared module loaded by both entrypoints). Both mounted layouts render new registrations automatically. Deep links route through this same registry; do not add separate shell route branches.
- `available` gates actual browser/OS/native capabilities, never viewport width. Unsupported hardware features must be hidden or explain the missing capability honestly.
- Shared control styles live in `web/core/settings.css`; responsive geometry belongs in media/container rules. Do not resurrect desktop copies in `polish.css` or phone copies in `styles.css`.
- Run `npm test`. The normal test command and PR CI discover the parity guard, check both entrypoints/all core-module inventory, and exercise a synthetic feature registered once in two mounts. Adding a general-purpose module to only one entrypoint fails.
- Existing exceptions and unresolved gaps are recorded in `docs/responsive-feature-inventory.json`. An exception is not proof of parity and must not be used to waive a newly requested cross-platform feature.
- Browser QA runs on Thales, with profiles/evidence/temp files on the external volume. Run `qa-responsive-parity.cjs` against live GET APIs plus `QA_SOURCE`, with every production mutation blocked. Verify phone touch + desktop, keyboard/focus, nested and root Back, retained drafts/recordings, agent scope and actual hosted-app styling.
- Never claim universal parity from an import test alone. Feature reachability/actions and native-specific limits need runtime evidence. A screenshot-only or mocked-API-only pass is not enough.

Protected `daily` changes only by PR. Push every commit immediately. Do not merge/deploy from an implementation lane. Preserve concurrent voice-custody work when integrating.

## Skins: build your own look (James, 18 Oct 2026)

Nebula (default), Grove, Tide, Ember and Signal are James's skins, together with the base shell look in `web/core/base.css` (palette and body font). Collaborators ship UX features and fixes as usual. A different look, palette, font or card style goes into a new skin of your own: a `SKINS` entry in `web/core/skins.js` plus `html[data-skin="<yours>"]` rules (Obsidian and Landscapes are working examples). Leave James's five skins and the shared base untouched, and keep fonts scoped to your skin rather than `body`, `.win` or controls.

`tests/owner-skins-guard.test.mjs` fingerprints those skins and fails on any change to them or on a shell-wide font rule. `tests/fixtures/owner-skins.json` changes only with James's explicit approval, named in the commit.
