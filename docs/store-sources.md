# Store sources and install links

The existing Store is the Apps screen. This extends its catalog rows, details, router/install sheet and selected-install receipt handling; it does not create a second app registry or an agent install path.

## Provenance

`web/store/store-source.js` owns the single Public / Beta / Local / Link label. The WAM installed identity wins over catalog provenance, including an installed Link app that later enters the public index. Alpha subscriptions display as Beta, without an additional Alpha badge.

Unmatched WAM registry identities are merged into the existing kind/search lists. Registry projections allow only validated display scalars (`name`, `summary`, `type`, `source`) alongside the existing identity fields. Local source objects are projected to `source: 'local'`, never a filesystem path. Opening installed apps continues through the shell's existing launcher registry.

## Sharing and review

Canonical share link:

```
wizard://install?repo=github.com/OWNER/REPO&commit=<40-hex-SHA>&from=<optional-display-name>
```

The recipient-origin fallback is `/wizard-os-home/?view=install&repo=OWNER/REPO&commit=...&from=...`. The pure parser accepts GitHub-prefixed, HTTPS GitHub and owner/repository identifiers; it refuses other hosts, executable refs, duplicate/unknown fields, markup/control characters and overlong sender names. Sharing a Beta, Link, or GitHub-backed Local app uses an exact installed/selected commit and the existing host share service, Web Share, or clipboard. A `local/...` filesystem identity is not shareable.

Both shells create/reuse their normal Store window and deliver the selection without reloading the Store's previous view. A link opens the same sheet layer as other installs. Back restores its prior list/detail/root; Back at Store root is consumed. Invalid input gets a plain error card with Back. The Android `ConnectActivity` also accepts `wizard://install`, maps its raw query to the configured recipient shell URL, and avoids clearing the existing shell task for install links.

## Read-only preview and selected install

`GET /wizard-os-home/store-data/wizard/v1/link?repo=OWNER/REPO[&commit=SHA]` uses fixed GitHub API endpoints. Without a commit, the adapter resolves default-branch HEAD before fetching `wizard.md` at that full SHA. It uses server-only `GITHUB_TOKEN` / `~/.wizard-os/github-token`, timeouts, refused redirects and capped response bodies. The restricted frontmatter display projection never returns config, filesystem paths or credentials. Catalog overlap is reported as `catalog_source`; failures return a plain 4xx error.

The owner must tap Install. The only install selection is:

```json
{"source":"link","repo":"OWNER/REPO","commit":"<40-hex-SHA>","operation":"install"}
```

The Store reuses its existing WAM polling, exact-selection receipt validation and registry readback. No `/v1/runs` or agent-mediated install is involved. Server-side authorization, manifest validation and source persistence require the companion **wizard-app-manager `feat/link-source-install`** change.

## Verification

- `node --test tests/store-*.test.mjs` — source mapping, parser errors, registry allowlist, fixed-endpoint preview with fixture fetches, exact SHA/token/cap/failure behavior, and existing Store contracts.
- `node tests/qa-store-sources.cjs` — fixture-only browser scenarios, default Nebula and existing Sepia skins through the real Appearance v1 host/receiver, 390×844 touch and 1280×800 desktop. All writes intercepted; exact link-install POST, denied/mismatched receipt paths, sharing, nested Back, source rows/search, no agent runs. Set `QA_OUTPUT` to an evidence directory; captures sources, install sheet and bad-link card for each skin/size.
- `node tests/qa-store-install-deeplink.cjs` — both real shells, initial deep link, Store reuse, invalid link and Back. All writes intercepted (the shells' pre-existing thread-seen PUT is rejected); zero agent runs.
- Existing `tests/qa-store-router.cjs` and `tools/qa-store-installs.cjs` retain their fixture acceptance scenarios.
- `InstallLinkTest.java` covers native raw-query transport and rejected authorities/paths. **Native unit/build/device verification remains queued for Thales; no local Gradle build or deployment is implied.**

Follow-up, not included here: **Apps → Sources → Sign in to GitHub**. Private previews currently use only the existing server-side GitHub credential.
