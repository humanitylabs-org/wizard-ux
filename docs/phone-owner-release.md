# Owner phone updates must not forget their Wizard

## Incident and boundary

An offline phone can skip every intermediate APK. The observed jump was 0.9.38
(versionCode 62) to 0.10.18 (82). The old published APK has a baked server origin
and **no `ServerSettings` class**; the new published APK's encoded `ORIGIN` and
`HOME_URL` are empty. The new `ServerSettings.origin()` cannot recover an address
that the old app never stored. `MainActivity` therefore opens Connect. This is
lost connection configuration, not evidence that credentials were erased.

The published 0.10.18 SHA-256 is
`5e8be00bd7161e07786e7d716698d4c12cc8450f12c8ab7f3906a97009d3161d`.
The published 0.9.38 SHA-256 is
`b2b27b055533da79e25dd65b4361668b65939dd1c45d570a6bb8078b0e610502`.
Private origin values, access logs, worker job configuration and raw handset
preferences remain outside source control.

A rehearsal from the immediately preceding, already-paired APK is insufficient:
it proves stored-origin custody, **not** migration from a pre-preference app.
Generic distribution/draft artifacts remain valid for fresh installs, but must
never replace this private owner's update feed. This follows the existing
[owner migration contract](../android/CONNECT.md#private-owner-build-defaults-and-upgrade-migration).

## Only supported owner-feed publication path

Use `tools/publish_owner_phone.py` instead of ad-hoc feed JSON/copy commands.
No default origin is committed. Each audit/publication reads
`~/.wizard-os/settings.json` → `network.base_url` and requires that the exact
candidate APK's encoded `BuildConfig.ORIGIN` equals it. The settings value must
already be an exact HTTPS origin (no slash/path/port/credentials/query).

Build the owner artifact on the approved signing worker, supplying `wizardOrigin`
privately as described in CONNECT.md. The generic canonical/draft release path
is separate; neither its empty-default check nor its n-1 paired-origin upgrade
proof authorizes admission to this owner feed. The established package and
signing identity, increasing versionCode, and all other release acceptance
requirements still apply. Signing remains on the worker; the publisher matches
exact bytes and metadata against the **trusted signing worker's successful
receipt**, rather than treating BuildConfig.UPDATE_SIGNER as certificate proof.

Audit only (no writes, no SDK, no network, no handset changes):

```sh
python3 tools/publish_owner_phone.py \
  --apk "$OWNER_APK" --receipt "$SIGNED_BUILD_RECEIPT" \
  --notes "One-line reviewed release notes."
```

Defaults target the current installation's private settings and
`~/.hermes/data/apps/private-reports/wizard-os/`. Explicit `--settings` and
`--feed-dir` are available for isolated rehearsals. There is no origin override
flag, generic waiver or fallback to an older feed address.

After a human approves the exact signed artifact and upgrade proof, the same
command with `--publish` stages/verifies the versioned APK, preserves the old
JSON, then atomically replaces `latest.json` last under a publication lock.
It refuses conflicting versioned bytes or a non-increasing versionCode and
reads back the exact targets. The optional HTML download landing page is not
modified. No APK was published as part of this fix.

This protects the checked-in path, not arbitrary writes by an administrator
with filesystem permissions. Do not bypass the publisher with manual copies.

## Regression and device acceptance

Controller-only test (also enforced by the Owner phone release guard workflow):

```sh
python3 -m unittest discover -s tools -p test_owner_phone_release.py -v
```

`test_app_update_never_signs_the_owner_out_from_a_pre_pref_build` decodes
explicit unit-fixture DEX constants, refuses an empty-origin artifact **before
any feed write**, then admits an owner-default artifact with the original
origin. Additional tests cover wrong/missing origin, configuration drift,
receipt/bytes/signer mismatch, dry-run, version conflicts and feed-last writes.
These fixtures are not real APK/signing/device evidence.

For real Android acceptance, extend the existing **Thales-only**
`tools/qa_android_connect.py` route. In its private OWNER_CONFIG, set
`pre_pref_baseline: true`, use the exact old published APK above and its hash,
and supply the private current owner origin. Use distinct debug/generic/owner
build receipts as documented in CONNECT.md. The rehearsal now naturally launches
the old app offline, proves `wizard_server.xml` is still absent, then upgrades
in place to the owner-default APK. It must preserve UID/grants, never show
Connect, silently persist the expected origin, and keep Back inside the app.
It never seeds preferences, publishes, or touches a physical phone. Receipt
records baseline mode and exact old/new hashes. Never count a skipped or failed
Thales run as a passing device gate.

## Shared implementation

Reuse: n/a (release tooling/docs only, no runtime `web/` or `android/` change).
REUSE: existing ServerSettings migration behavior and signing-worker receipts.
EXTEND: existing exact-byte Connect upgrade rehearsal, not a second emulator stack.
NEW: private owner-feed admission command; encoded DEX reader extracted from
canonical release PR #513 into `tools/apk_build_config.py`. Reconcile that draft
work onto this module, not two competing APK readers. No UI/capability is added.
Visual: none.
