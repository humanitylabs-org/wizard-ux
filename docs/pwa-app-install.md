# Add individual apps to a browser home screen

Hold an app in mobile Apps or New desk, or hold and release a one-app desk without dragging. **Add to home screen** keeps using the native Android bridge when it exists. Otherwise it opens that app's install guide; ordinary taps and desk reordering are unchanged.

- **Android Chrome:** use the guide's Add to home screen button if Chrome offers an install prompt, or Chrome's ⋮ menu → Add to Home screen / Install app.
- **iPhone Safari:** Share → Add to Home Screen → Add.
- **Already inside Wizard's installed PWA / an in-app browser:** opening a new tab is best effort, not a way to force Safari/Chrome. Copy the install link and paste it into the regular browser if needed. Clipboard denial leaves a selectable link.
- Opening the installed icon shows only the selected app using the existing isolated app-session. It does not open or rewrite your desks. Multi-app desks do not become installable web apps.

Installation still needs browser/OS confirmation, HTTPS (or localhost for development), and access to the Wizard. A web page cannot silently pin icons or reliably query whether an iOS icon already exists. Authentication may need repeating in the installed app on platforms with separate storage.

## Delivery contract

`/wizard-os-home/install/<registered-id>/` is the canonical, server-rendered install document. Its stable, same-origin `manifest.webmanifest` has an app-specific `id`, `name`, icon, `scope` and `start_url`. No blob/data manifest, query-supplied display names, arbitrary navigation destination, or install-state localStorage flag is used. Names are bounded/escaped; IDs and frontend routes are validated against a fresh, authenticated `/wizard/v1/apps` response. Removed apps fail closed. Registry unavailability is a retryable 503, not a stale install offer. Registry redirects are not followed and identity headers are forwarded, never invented.

Each app has its own path scope. The manifest starts at `?launch=1`; Safari reopening the saved canonical URL is recognized through standalone mode. The install guide does **not** auto-launch in an ordinary browser. An explicit `?install=1` handoff can show the guide inside an existing installed PWA; it removes that marker before Safari saves the page. The installed document contains one full-height frame hosting the existing `?app-session=<id>` entry; that session still owns the app frame, Back, appearance and reading state. The outer frame preserves the app's manifest identity and scope instead of navigating into the shared Wizard workspace URL.

Known house apps use 512px opaque PNGs generated from the existing `WizSigil` artwork. Regenerate with `node tools/build-install-icons.cjs` and the repo's `QA_PLAYWRIGHT` override when sigils change. Unrecognized/custom apps use the Wizard mark (never a remote/untrusted icon URL); their names and install identities remain separate.

The shell previously served only static files. Packaging now includes a small Python-stdlib **read-only** responder over a private Unix socket, supervised alongside nginx. Either process exiting terminates the other so container restart policy can recover the pair. No extra host port, app registry write, external sidecar, or owner configuration is required. nginx proxies only the install namespace to it; everything else retains its existing routing. Docker's existing `stamp-assets.sh` versions the install template's JS/CSS as well as changed shell assets. The existing service worker is network-only and caches no private pages or registry responses.

A static-only development server cannot serve these per-app manifests. Use the packaged container, or an explicit test responder; do not replace them with blob manifests.

## Verification

- `npm test`: includes the Python HTTP contract (`tests/app_install_test.py`) and existing native pin/desk/gesture/session tests.
- `QA_OUT=<private-receipts> QA_ORIGIN=<isolated-container> node qa-pwa-app-install.cjs`: real Chromium with Android/iPhone user agents, standalone simulation, manifest parsing/installability diagnostics, native and prompt handler fixtures, clipboard denial, trusted touch hold, ordinary tap/Back, isolated session/reload and mobile geometry. Run against `tools/qa-install-fixture.py` as the container's upstream so no production data is read or changed.
- For the original source negative control, serve its `web/` with `QA_WEB_ROOT=<baseline-web> QA_FIXTURE_PORT=<port> python3 tools/qa-install-fixture.py`, then run the browser suite with `QA_BASELINE=1` against that loopback origin. It verifies that browser hold was inert and the per-app manifest route was absent.
- `qa-home-screen-apps.cjs` remains the separate Thales/actual-frontend suite; its browser fallback assertion is updated. That suite is not replaced by synthetic app content.

These checks are **not physical iPhone/Android installation, OS home-icon deduplication, Recents, process-death, or actual Safari engine proof**. Test those on the owner's phone after deployment; do not claim them from emulation. App-specific sites can still require a network connection. This feature does not add offline app storage or change native shortcut identity.
