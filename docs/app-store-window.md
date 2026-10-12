# App Store window candidate (James-approved Store slice)

## Entry and scope

- Private phone: `https://store-window.staging.wizard001.com/wizard-os-home/?shell=phone&view=apps` → My Apps → Get apps.
- Private desktop: `https://store-window.staging.wizard001.com/wizard-os-home/desktop.html` → actual Cmd-K → Get apps.
- Direct normal app: `?open=app-store`; `?view=store` aliases the same normal app.
- Portable document: `/wizard-os-home/store/index.html` (directory root also works through the private front).

This extracts only Oscar/Miguel's Store/card renderers from frozen native preview 7afcc94, retaining GPL-3.0, source hashes and provenance. It does not introduce PR3's My Apps/System/dotted-service redesign, graph design or Resources code. Existing launcher order remains; Get apps uses each shell's normal app opening/reuse path. Installation actions are disabled explicitly. Canonical lifecycle URL/session/CSRF/idempotency adapter remains dormant for the installation owner; no Service edits or real lifecycle tests occur here.

The phone's Store window is marked `store-window`; only while that normal frame exists, `.device:has(.store-window)` clips the fixed outer stage without creating a scroll container. Real touch/iframe focus had otherwise scrolled the shell's `overflow:hidden` container to `(73,192)`, clipping the app and dock. App-document scrolling remains native and the rest of the shell's rules stay intact.

Store's synchronous `__wizardCloseOverlay` hook handles card → Store. The phone treats this hook's truthful boolean as authoritative rather than applying the legacy layout-signature timer, which otherwise can unwind a second shell layer. Store at root delegates to the parent. Standalone root owns one guard. Both shells reuse an already armed guard after reload. Desktop Back at Store root returns to the existing desktop parent; phone Back returns to Home, retaining its normal app desk.

Installed card Open accepts only the installed view's same-origin URL and a matching parent registry id/URL, then calls the existing shell openApp mechanism. Missing/unregistered routes remain honestly unavailable. No window.open or nested Wizard shell is used by the Store.

## Read-only adapter candidate / parent integration

`tools/store-data-origin.mjs` serves ONLY `/wizard-os-home/store-data/`, bound to loopback. It reads fixed `~/.wizard-os/apps.json` and uses the existing server-side Runtipi CLI JWT source `~/runtipi/.env`. The browser receives only allowlisted installed metadata, never config/generated passwords, tokens, health/MCP addresses or skill paths.

Allowed GET/HEAD suffixes:
- `wizard/v1/wizard-apps`
- `wizard/v1/index/search`, `.../tags`, `.../apps/<owner>/<repo>` via pinned PR7 module
- `api/apps/installed`
- `api/marketplace/apps/<id>:<store>/image`

Unsafe methods get 405, unknown paths 404, raw/encoded traversal and encoded separators 400. The adapter does not proxy arbitrary URLs. Index upstream is fixed public `https://apps.aiwizards.com/v1`, with bounded query/cache rules. It has no install/start/stop/uninstall route.

After independent review, parent may install a loopback browse-data unit from the reviewed exact SHA and route **only** the prefix through the existing authenticated private gateway. Example executable: `/home/telos/.local/bin/node <exact checkout>/tools/store-data-origin.mjs 9584`. Preserve the gate, route prefix and other mappings. Do not expose the adapter directly or restart/modify the Service. Production enablement belongs entirely to parent; this candidate did not change Caddy, daily/main, or any production service.

## Durable private preview only

Distinct enabled user units:
- `wizard-stage-store-window-shell` → qa-origin :9585, committed detached clone `~/.local/share/wizard-stage/store-window/source/web`
- `wizard-stage-store-window-data` → prefix adapter :9584
- `wizard-stage-store-window` → read-only private front :9583, requires both upstream units

`~/.config/wizard-staging/sites.json["store-window"]` points to :9583. Existing entries remain intact. Front rejects every unsafe method before forwarding. Unknown app URLs return 404 rather than loading Wizard recursively. No runtime credential file or untracked `.env` was cloned into the staged source. Untracked daily data.js/summaries.js use the existing qa-origin read fallback, just as baseline previews do.

## Focused verification

All browser and adapter tests execute on Thales using `/opt/homebrew/bin/node`, existing Playwright at `/Users/thales/workspace/wizard-mobile-link-candidate/node_modules/playwright`, under `/usr/bin/lockf -k /Volumes/ThalesMedia/AndroidBuilds/worker.lock`. `-k` retains the shared lock inode rather than deleting it on exit. No npm install, VPS browser/build fallback, new model/provider or lifecycle VM is required.

From an exact committed source snapshot on Thales:
```
SOURCE_SHA=<full SHA> QA_OUT=<absolute evidence directory> \
/usr/bin/lockf -k /Volumes/ThalesMedia/AndroidBuilds/worker.lock \
/bin/sh -c '/opt/homebrew/bin/node --test tests/store-data.test.mjs && /opt/homebrew/bin/node qa-store-system.cjs'
```

The browser suite uses actual peer HTTPS, real index/installed data, actual Meta+k and touch My Apps/Get apps. Every context intercepts all unsafe requests. Real top/frame popstate observers are registered before product handlers. It verifies bounded routing, read-only controls, catalog/search/tags, regular window reuse, Back card/query/scroll retention, parent/root/reload history, normal controls, Home smoke, and exact served asset hashes. Browser/Chromium-touch evidence is not a physical Android Back receipt; parent owns the final live/device promotion gate.

## 12 Oct redesign (James: "design this as a beautiful app store for an app discovery platform")

- **App Store** (`web/store/`) rewritten as a discovery app: featured carousel, four kinds (Apps, Agent apps, Agents,
  Connections), shelves, topics, search, and an app page (what it does, works with / powers, gives your agent,
  information, source). Get is browse-only until App installation lands; installed apps show ✓ Installed or Open.
- **System** (`web/system/`, app id `system`): agents, agent apps & tools, connections and routines, with a layered map
  after Miguel's graph mockup (lines only between layers; tap a node to light its lineage). Entry: Home "Your system"
  card (phone), Home chips and Cmd-K "Your system" (desktop), `?view=system`. Not a launcher tile: the app list stays
  things you open.
- **Data**: `GET /wizard-os-home/store-data/system/v1/overview` (tools/system-overview.mjs) emits names and status only;
  secret values are never read into the response. `GET …/store-data/logo/<id>` serves the Index logo for that id from
  raw.githubusercontent.com at a pinned commit only.
- Hosted apps ask the shell to open another app with `postMessage({type:'wizard:open-app', id})`; the shell checks the
  sender is the App Store or System frame.
