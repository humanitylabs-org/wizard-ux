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

## One entry per app ID (source conflicts)

When catalogs list the same app ID from different repositories (for example an original repository and its fork), `mergeConflicts` (`web/store/store-status.js`) shows one row. Rows from the same repository, however it is spelled, count as one source and are never a conflict between themselves. It keeps the repository whose installed identity is exact (same repository in the App Manager registry, or a reviewed host alias); a Runtipi-only match proves nothing about the source. The row shows the `Source conflict` status beside the name, never an action pill. The installed copy still opens. Installing from a conflicted ID stays blocked.

The detail page's **Sources** section lists every repository and marks the installed one. Replacing an installed app with another repository is not available from the Store: it would need a server-persisted source choice and an App Manager replacement flow (follow-up). Refresh rebuilds the same single row from the same data.

## Remove app

An installed app's page offers `Remove app` next to Open when the App Manager installed it under its own ID from a known repository at a full commit, and it is not one of Wizard's own apps (`system`, shell, interface). The review opens on the Store's existing sheet layer (Back/Escape cancel). It reads `GET store-install/_remove/<app>/plan` from the App Manager. The plan covers the exact installed repository and commit, the apps that use it, any capability nothing else provides, and the number of earlier backups it keeps. The App Manager refuses required spots and Wizard's own apps.

`Remove app` sends one `POST store-install/_remove/<app>` with exactly `{repo, commit, dependents, empties}` from that plan. It goes through the same owner gate as Store Get. The App Manager refuses the request if anything changed. A second tap joins the running job. The Store shows the app as removed only after both of these hold:
- the job reports `removed` for the same identity;
- a fresh read of the App Manager registry and Runtipi lists no longer contains it.

On success the Store posts `wizard:apps-changed`, closes the review and the app page, and lands on the list it came from. A refusal or failure keeps the review open with the reason. An unknown outcome says to refresh and never claims removal. Server contract: wizard-app-manager `wam/store_remove.py`.

## Verification

- `node --test tests/store-*.test.mjs` — source mapping, parser errors, registry allowlist, fixed-endpoint preview with fixture fetches, exact SHA/token/cap/failure behavior, and existing Store contracts.
- `node tests/qa-store-sources.cjs` — fixture-only browser scenarios, default Nebula and existing Sepia skins through the real Appearance v1 host/receiver, 390×844 touch and 1280×800 desktop. All writes intercepted; exact link-install POST, denied/mismatched receipt paths, sharing, nested Back, source rows/search, no agent runs. Set `QA_OUTPUT` to an evidence directory; captures sources, install sheet and bad-link card for each skin/size.
- `node tests/qa-store-install-deeplink.cjs` — both real shells, initial deep link, Store reuse, invalid link and Back. All writes intercepted (the shells' pre-existing thread-seen PUT is rejected); zero agent runs.
- Existing `tests/qa-store-router.cjs` and `tools/qa-store-installs.cjs` retain their fixture acceptance scenarios.
- `InstallLinkTest.java` covers native raw-query transport and rejected authorities/paths. **Native unit/build/device verification remains queued for Thales; no local Gradle build or deployment is implied.**

## Sources and GitHub sign-in

`Sources` sits next to `Refresh` on the Store home and opens one sheet on the Store's own sheet layer (`web/store/store-github.js`, driven by `store.js`; one Back level, tap outside closes it, opaque `--wz-*` surface with dark fallbacks). It reads and drives the App Manager's owner-gated `store-install/_github` endpoints; the browser never sees a token, device code or client id.

- Signed out: a plain explanation and `Sign in to GitHub`. The tap paints "Getting your code…" on its own frame, posts `_github/start`, then shows the short code, a copy button and `Open github.com/login/device`. The Store asks `GET _github` about every 2 s only while the sheet is open, the code is pending and the page is visible; it stops on close, Back, expiry, denial and sign-in.
- Signed in: `Signed in as <username>` and `Sign out`. Sign out paints at once and rolls back with a toast if the App Manager refuses. A sign-in that comes from the Wizard's settings (`source: env`) says it cannot be removed here.
- Not configured: a plain note and no button. Expired, denied and error: a plain message and `Try again`.
- When a sign-in finishes, and after sign-out, the Store reloads its catalog with `refresh=1`, so Beta apps appear or disappear without a page reload.

**Scope caveat.** GitHub OAuth Apps have no read-only scope for private repositories, so the sign-in asks for GitHub's `repo` scope (plus `read:packages` for private images). The token stays on this Wizard (0600), is used server-side only for read calls and installs, and Sign out deletes it.

**Beta source** (`tools/store-beta-source.mjs`, merged by `withPrivateCatalog`). With a GitHub credential present, the adapter lists the private repositories tagged `wizard-app` that the account can see, resolves each repository's HEAD commit, reads `wizard.md` at that commit through the same fixed-endpoint, redirect-refusing, size-capped reader as link previews (`githubReader`), and shows only the restricted display projection as `source: beta`, `private: true`. Rows whose manifest fails the projection are skipped. Results are cached for 5 minutes and `refresh=1` bypasses the cache; a failed refresh keeps the last rows and reports `beta_unavailable` in `sources`. Without a credential there are no Beta rows and no GitHub requests. A Beta row installs through the existing link selection (`{source:'link', repo, commit}`), so the App Manager checks that exact commit with this Wizard's GitHub login.

Verification: `node --test tests/store-github.test.mjs tests/store-beta-source.test.mjs` and `node tests/qa-store-github-signin.cjs` (fixture-only; phone 390×844 touch and desktop 1280×800 through the real shells, Nebula with a live switch to Sepia, a 5 s delayed backend proving each tap paints first, nested Back, tap outside, polling while hidden).
