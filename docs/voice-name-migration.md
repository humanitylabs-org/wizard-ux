# Spoken launch-name migration audit

Baseline: `69a2c795e18648dccb772f1d863f1684314e8d83`, the original PR #410 base.
The committed fixture contains only launcher metadata (id/name/url/source), every old alias and the original resolver's destinations. No chats, transcripts, agents' private state or credentials are included.

## Ownership and remaining registration work

| Legacy target | Canonical owner and declaration | Transition |
| --- | --- | --- |
| Food / `usuals` | Embedded source `web/usuals.js` plus `android/.../usuals/`, not a standalone installed app. Its existing built-in `WizCore.apps` record owns eight normalized names. | Native record stays available without the catalog. No invented separate Food repository or packaging stub. |
| Maps / Spotify | Native launchers in the shell's existing built-in app registry. Maps owns `google maps`/`map`; Spotify owns `music` only when the installed Music app is absent. | No parallel alias table for native launchers. |
| `troubleshooter` | Recovery source is `wizard-troubleshooter`, not a missing repo. Main has no wizard.md; the existing independent-recovery draft (#2) does. Manifest names are stacked on it in #11. | Current built-in recovery record owns names and preserves its URL when a pre-metadata catalog record is present. Packaging id `wizard-troubleshooter` is distinct; do not silently replace the recovery endpoint. |
| Wisdom | `wisdom/wizard.md`, #3 plus #4 (previously omitted `jobs` / `steve jobs`). | Absent-only fallback until re-registration; explicit `[]` disables it. |
| Movies | `cinequeue/wizard.md`, merged #7. | Same absent-only fallback. |
| Music | `wizard-music/wizard.md`, merged #5. | Same fallback, retaining installed Music before native Spotify. |
| Shopping | `wizard-shopping/wizard.md`, merged #1. Current owner launcher also has old id `shopping`; registration must reconcile that link with `wizard-shopping`. | Preserve `shop` on the existing old link until that owner migration. |
| Mizel | Existing `wizard-recorder` #2 already declares `mizel`, `meetings`, `meeting recorder`; reuse it rather than make another PR. | It is still open, not merged/deployed. Current installed source is `mizel-installed-app`. |
| I Ching | Local `iching-reader/iching-core.js` and its adjacent source, **not a git repository**. No remote branch exists to receive a manifest-only PR. Its display name already opens via `I Ching` / `iching`. | Preserve old link through absent-only fallback. Do not invent a runtipi recipe or mutate live launcher state. |
| Console | Local `vps-terminal` is a git repository with **no remote and no wizard.md**. | Keep `terminal` fallback only before declaration. Source publication/packaging remains an owner-scoped follow-up. |
| Signal | Local `wizard-signal` has **no remote and no wizard.md**; worktree is dirty and was left untouched. | Keep `signal` fallback only before declaration. Its display name is `Wizard Signal`. |

Display names remain app-owned without an alternate-name list. No attempt is made to assign aliases to every unrelated installed app or create invalid manifests merely to populate an optional field.

## Safe transition contract

- `voice_names` present (even `[]`): use only the app's declared alternatives; no legacy defaults.
- `voice_names` absent: preserve currently working names for that target until it re-registers. Do not invent an app when its id is absent.
- Agent Service must preserve absence instead of projecting `[]` (#131), **before** the transitional UX is deployed. App Manager already writes a declaration on re-registration.
- Live and cached registry results are covered. Built-in metadata is not replaced by an old record with no declaration.
- Existing exact display-name precedence and explicit fuzzy alias precedence differ (notably Grab/Food and duplicate Shopping records); keep both instead of silently changing destinations.

## Verification and merge gate

`node --test tests/*.test.mjs`: 694 passed, 0 failed. Nine focused tests include exhaustive baseline parity on mobile/desktop, live/cache, explicit opt-out and catalog-down recovery.

`QA_VOICE_MIGRATION=1 node qa-bare-app-name.cjs` adds both browser registry comparisons and actual held-command launches for the legacy app aliases/music variants. Food's existing `order food` behavior is a synthetic native browse call, **not** a purchase or a forced Food-window launch. The normal browser mode still covers held/tap distinction, declared aliases, app-to-thread Back, router and composer behavior. Both modes must pass on Thales before merge. All API responses/app pages are fixtures and writes are refused/intercepted.

No live install/re-registration, settings write, deployment or core Hermes change is authorized by this PR. The full permanent table deletion is deliberately **not complete** until the absent-only migration rows can be retired safely.
