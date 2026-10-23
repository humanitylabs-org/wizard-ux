# Look / skins Store implementation

Contract: [wizard-os#175](https://github.com/humanitylabs-org/wizard-os/pull/175), `spec/SKINS_NOSTR.md`, decisions #86–#90.

Reuse:
- Settings/navigation: EXTEND the shared Look registration and existing enter/leave/back hooks; neither shell owns feature state.
- Native identity/capture: REUSE `WizCore.bridge.call`; no second envelope or signing implementation.
- CSS overlay: EXTEND `WosMySkin` with a nonpersistent trial layer, separate from CSS state/cache and JavaScript approvals.
- Store/folders/publishing: NEW `web/core/skins-store.js` (`WosSkinStore`), loaded in both entrypoints and inventoried in COMPONENTS.
- Base skins: REUSE definitions/packages; generate standalone CSS seeds, without changing or removing built-ins.

## Acceptance

Fixture-backed phone and desktop browser checks: three levels; active/None/new folder; featured ordering; author/date/forks; detail; Try on/cancel/Back/reload without approval writes; Add refreshes the real layer; Report reason; unavailable/empty identity; setup/denied/signed publish through real bridge helper. Two skins (Nebula/Light), screenshots. Unit suite plus scoped baseline/candidate QA.

The publish API has no per-folder CSS read: pre-pack supplies its verified CSS hash; render that blob in a fixed sandbox scene, capture only its rectangle, then re-pack with the optional preview before requesting a signature. Capture/verified-blob unavailability means no preview, never an owner screenshot. Name/alt tags are completed before signing; no private key reaches JavaScript.

No deployment, native APK, real signature, relay or Blossom end-to-end claim belongs to this PR. Service/native companions must land before enabling the full live path.
