# Slices 1 and 3 implementation status

## Slice 1: implemented

`tests/feature-ids-in-core.test.mjs` ratchets literal feature app references in `web/` and
Android against `tests/feature-id-allowlist.json`. Slice 3 lowers the old ceilings and
moves compatibility literals to one explicitly temporary module, rather than excluding it.

## Slice 3: implemented; companion service rollout required for synced choices

The companion Agent Service extends `ui-preferences` with validated optional `launcher`
and `migrations` fields and owner-only `POST /wizard/v1/ui-preferences/seed`.
`core/launcher.js` waits for bootstrap, reads shared prefs and sends `launcher-seed-v1`
only when absent. The server fills absent launcher keys and writes the marker in the same
atomic rename. Existing choices, including empty arrays, win over migration values.
Browser storage is only an offline read cache; there is no per-device migration marker.
Old services reject the seed route; the shell uses `core/launcher-defaults.js`, clearly
marked for deletion after rollout. Either deployment order is supported.

- Registry app ids/names/views/icons/colors/voice metadata remain the source of installed apps.
- Native phone-link records (including Android Settings), recents defaults, desktop quick
  ids, boot auto-open ids and hosted-thread admission ids now come from shared launcher prefs.
- Agent tiles are still registry-generated, inserted after the main Chats quick item.
- `displayNames` preserves the owner's short shortcut name without changing registry/desk names.
- Sigils consult registry metadata first. Recognized mask names and same-origin icon files win;
  HOUSE remains only the legacy fallback for records without a usable mask (including emojis).
- Food's Usuals, side-button device tools, agent-family ordering, app aliases, voice grammars,
  recorder route aliases and the separately owned companion pane are unchanged.

Reuse:
- REUSE: app registry, `WizCore.apps`, `WizSigil`, UI-preference pull and workspace sync.
- EXTEND: shared UI-preference refresh consumes launcher policy; shell adapters read it.
- NEW: `WizLauncher` policy + one temporary defaults module, listed in COMPONENTS.md.

## Verification

- Web baseline: 1020 tests, 1020 pass, 0 fail.
- Candidate: 1026 tests, 1026 pass, 0 fail (includes old-server fallback, seed response,
  marker/no-marker/retry, empty owner choices, registry-first sigils and removal guards).
- Companion service baseline: 1489 Vitest tests; candidate: 1493; additional Node/Python
  suites pass with bounded Vitest workers. Targeted seed HTTP tests cover owner proof,
  cross-site refusal, strict validation and concurrent seeds/PUT.
- Isolated service with a read-only copy of owner preferences: seed once; repeat is a
  no-op with identical whole-file bytes and mtime; all existing fields' JSON encodings
  identical; all seven old fields round-trip. No live write or deployment.
- `qa-launcher-from-registry.cjs` records phone/desktop at two skins, fresh defaults and
  exported owner workspaces, all app/grid/native/recents/quick/window/sigil/name lists,
  screenshots and page errors. It compares whole lists with an origin/main baseline.
  Registry/preferences are real HTTP; exported workspaces/agent catalogue are replayed
  identically; app bodies are inert. This is launcher acceptance, not app-internal QA.
- Full remote browser matrix, live candidate failure-name comparison and parity output
  must be attached by the release coordinator before declaring the slice accepted.
