# Wizard Alpha (candidate)

One private Git catalog, the existing Store, and an agent-mediated exact-release install. No new privileged browser endpoint; no automatic install or service daemon. The old owner-private catalog and ordinary public apps remain. All search terms/filtering stay local. Last-known-good source data is retained on failed refresh.

## Supported execution contexts

- Existing Linux/macOS Node 22+ Store origin process, authenticated by the existing Wizard gateway. Existing systemd service with an EnvironmentFile, Docker/Compose container with a mounted env file and persistent state, or an owner-managed local process launcher that reads that env file.
- Existing Hermes CLI supporting `config get ... --json`, `config set`, and `skills.external_dirs`. Setup uses its native settings commands with an explicit HERMES_HOME. No core modification or profile cloning.
- Existing GitHub CLI authentication **for this subscriber**, with read access to both the private catalog and every referenced app/release. Publisher also needs write access to a review branch. Never copy a token into this repository or a deployment descriptor. A pending invitation is not access.
- Installation additionally requires the existing WAM Python/CLI runtime, real Runtipi/Docker, and an **already authenticated Caddy site** with an owner-approved import directory. The supplied Caddy activator runs in the same filesystem/command environment as WAM. Tailscale-only activation is not implemented here: use the separately verified WAM lifecycle or explicitly declare that gate blocked. Do not invent recipient infrastructure.

The container option means run setup inside the deployment environment, or use an existing wrapper which maps the same absolute paths and forwards `WAM_PRIVATE_CATALOG`, `WIZARD_ALPHA_ACTIVATION`, RUNTIPI_ROOT and WIZARD_OS_HOME. Host-only helper installation does not prove that a container agent can execute it. The owner must identify the current service/container; setup never guesses which process to replace.

## Portable setup

Use a reviewed immutable Wizard UX checkout, including its `tools`, `web/store`, `skills/wizard-alpha` and `docs/wizard-alpha.md` directories. Keep the checkout outside the public web root. Do not serve the repository. Inspect current service ownership and preserve the old version for rollback. The deployment descriptor is **owner-local**, never published in the catalog:

```json
{
  "context": "systemd-env",
  "tools_dir": "/srv/wizard/store-tools",
  "store_dir": "/srv/wizard/web/store",
  "env_file": "/srv/wizard/store.env",
  "prefix": "/srv/wizard/alpha-tools",
  "hermes_home": "/srv/wizard/agent-home",
  "hermes": ["hermes"],
  "restart": ["systemctl", "--user", "restart", "wizard-store-origin.service"],
  "probe_url": "https://your-private-wizard.example/wizard-os-home/store-data/wizard/v1/index/search?limit=100",
  "probe_headers_file": "/srv/wizard/private/store-probe-headers.json"
}
```

Replace paths/command with the already installed service. Systemd must already use the named EnvironmentFile. Compose must already consume the named env file and bind the same tools/web/state paths; its restart argv must recreate **only the Store service** (`docker compose ... up -d --no-deps --force-recreate STORE`). `process-env` uses an existing narrow launcher. The probe headers file is optional for a gateway which uses private network authentication; when present it contains the owner's existing auth header and stays mode 0600. Do not put header values in command arguments or chat. `tools_dir` must contain the configured Store process entrypoint, not an unused copy.

```sh
node tools/wizard-alpha-setup.mjs --deployment /absolute/deployment.json \
  --home /absolute/subscriber-state --repo OWNER/wizard-alpha --ref main
```

Setup verifies the complete subscribed snapshot and artifact access, installs the helper/skill and coupled Store files, registers the external skill directory preserving other directories, configures the env file, restarts the declared existing Store, and reads back that Store's exact source revision. Failure rolls changed deployment files/skill settings back. State/pins are kept for diagnosis. It never claims success merely from creating a catalog file.

Put the returned `prefix/bin` on the agent's PATH (or invoke its absolute `wizard-alpha` command). A new agent session should discover `wizard-alpha` via native `skills_list`/`skill_view`. Verify from the **actual agent execution backend**; a host shell is not proof for a container terminal. Verify a public app and an Alpha app in the Store, and source status. The first opening may show the prior cache while refresh runs; **Refresh** awaits the source fetch. Each subscriber uses its own state directory, auth integration and status; no shared credential/cache volume is required.

For release review, subscribe two isolated configurations to the explicitly named review branch. After approved PR merge, production subscribers use `main`. To change repo/ref, use a new subscriber state directory and rerun setup after rollback; no silent source replacement.

## Publish from either subscriber

Use an **already verified private-test package manifest**, not an invented JSON entry. The helper checks full source commit, wizard.md app identity, release tag commit, architecture-specific asset IDs/names/sizes and GitHub archive digests. WAM verifies archive checksum and loaded image identity on installation.

```sh
wizard-alpha publish --catalog /private/checked-release-manifest.json \
  --app APP_ID --repo OWNER/APP_REPO --commit FULL_SOURCE_SHA \
  --expected absent --notes "What changed in this release"
```

For replacing an entry, `--expected` is its current full source SHA. Subscribe the publisher to a review branch; main/master/daily publication is rejected. Create the branch from main using the existing Git workflow, then open a PR. Different app writes use file-level CAS and are retried on nonconflicting races. A changed same-app entry is rejected, not overwritten. Repeating the identical release is idempotent. The helper reads back the exact resulting immutable remote commit and returns a Store detail link. Review notes and manifest changes before merge. Do not auto-merge protected/default branches.

## Install and activation

Store Get supplies the exact source, app, version and commit for the owner's agent. Same-ID/same-repo releases share a card with Standard/Alpha choices; a different repo is an explicit conflict. Only one copy per ID is managed by WAM. No source selection is inferred from app name alone.

Create an owner-local `install-policy.json` in the subscriber state directory:

```json
{
  "wam": ["wam"],
  "registry": "/srv/wizard/os-home/apps.json",
  "activate": ["/path/to/wam/python", "/srv/wizard/store-tools/wizard-alpha-activate.py"]
}
```

Set `WIZARD_ALPHA_ACTIVATION` in the agent/WAM execution environment to an owner-local policy:

```json
{
  "origin": "https://your-private-wizard.example",
  "caddy_config": "/etc/caddy/Caddyfile",
  "fragment_dir": "/etc/caddy/wizard-alpha",
  "headers_file": "/srv/wizard/private/gateway-headers.json",
  "sentinels": {"APP_ID": "App-specific HTML sentinel"}
}
```

The import directory must already be included **inside the existing site's authenticated route**, with no new public listener. The activator refuses to overwrite unowned fragments or conflicting registry routes. It uses the existing WAM private catalog gateway generator, validates/reloads Caddy, verifies unauthorized requests are rejected (header-auth deployments), checks the authenticated app HTML sentinel, verifies an actually running container uses the expected image and registry exact commit/view, then writes an activation receipt. This is not a substitute for browser/functional QA of the app. No data deletion or dependency replacement occurs here.

```sh
wizard-alpha install --source wizard-alpha --app APP_ID --commit FULL_SOURCE_SHA
# After selecting a different release explicitly:
wizard-alpha install --source wizard-alpha --app APP_ID --commit NEW_FULL_SOURCE_SHA --update
```

Missing setup, architecture, release permission, installed repository conflict, stale selection or failed activation stops with a bounded error. Failed activation does **not** write the installed-source receipt. A running container alone is not usable Open. After a real install, open via the existing launcher/gateway and verify content. Before update, save app data, then compare after update and reopen. Don't fabricate a new version/commit that uses an unrelated release artifact merely to satisfy an update test.

## Rollback

```sh
node tools/wizard-alpha-setup.mjs --deployment /absolute/deployment.json \
  --home /absolute/subscriber-state --rollback yes
```

Rollback refuses if managed files changed since setup; otherwise it restores backed-up Store/helper/env files and removes only the added external skill directory from configuration, restarts the declared Store and leaves installed apps/data intact. It does not remove app gateway routes or revoke repository access. Verify ordinary/owner-private Store entries after rollback. Retain the prior immutable deployment revision for service-specific recovery. Source cache may be retained privately or removed after diagnostics; it is never sent to the public index.

## Verification scope

`node --test tests/store-private-catalog.test.mjs tests/wizard-alpha.test.mjs tests/store-data.test.mjs` covers merge/privacy/paging/cache and helper failure/selection boundaries. Run sustained tests and browser/install QA on the designated build worker. Fixture tests are not real GitHub publication, recipient access, private gateway Open or Runtipi data-retention proof. Release evidence must identify those gates separately and name exact UX/WAM/catalog revisions.
