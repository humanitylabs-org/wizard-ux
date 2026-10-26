# Opt-in offline reading kit

`web/core/offline-kit.js` exposes `WizOffline.create(config)`. It does not replace WizardApp's Back, theme, share, or update owners. It never reloads a client. Use `WizardApp.update.hold` for unsaved sheets as usual.

## Client config

- `prefix`: a unique app-owned CacheStorage/IndexedDB family, e.g. `reader-` (required).
- `base`, `worker`: app root URL and worker entry point, same origin, scoped to that root.
- `data`: snapshot paths (relative to base), network first with cached fallback via the worker.
- `writes`: exact mutation paths admitted to a durable IDB outbox. All other mutations are network-only.
- `onlineOnly`: endpoint prefixes. Offline requests throw `Needs a connection` immediately; intercept AI affordances at the app UI too.
- `assetURLs(state)`: exact same-origin asset URLs referenced in the canonical library; download concurrency defaults to four. Cache hits make downloads resumable. `navigator.storage.persist()` is requested, not guaranteed.
- `project(state,item)`: pure local overlay; failed rows stay available for recovery, not silently discarded.
- `reconcile(state,result,item)`, `queuedResult(state,item)`: adapt endpoint response shapes.
- `resolve(later,item,result)`, `blocked(item,all)`: optional temporary-id dependencies. `alias(item,result)` persists a `{from,to}` identity mapping; `prepare(item,lookup)` resolves a stale temporary reference in a still-open draft after replay. Do not discard these aliases when removing the original outbox row.
- `onStatus`, `onFailure`, `onSynced`: render calm progress, pending work and recoverable failures without replacing an open sheet.

`request(path,body?)` persists mutations **before** the first network attempt; `flush()` retries in sequence under an app Web Lock. A network/transient server failure stops replay; a permanent error is kept and surfaced, its dependent rows remain blocked, and independent later work can continue. Visible clients retry on reconnect, focus and a 30-second retry interval. Closed apps sync on next open, not through unpromised background execution. Target browsers must support service workers, IndexedDB and Web Locks for multi-tab replay exclusion. No credentials leave the origin.

Each write includes a random `X-Wizard-Offline-Id`. **The server must commit an idempotency receipt in the same transaction as the edit** and reject reuse with a changed payload. Without that contract a response lost after commit can duplicate an edit. Temporary identifiers must be resolved before replaying dependents. Server data stays canonical; local changes are only an overlay until accepted.

## Worker entry point

```js
self.WIZ_OFFLINE_CONFIG = {
  prefix:'reader-', version:'HASH_OF_SHELL_BYTES',
  shell:['./','index.html','app.js','style.css','offline-kit.js','offline-sw.js'],
  data:['api/library'], assets:['art/'], onlineOnly:['api/ai','api/discussions']
};
importScripts('./offline-sw.js');
```

Include every shell dependency (fonts and platform helpers too). Serve worker/script resources from an explicit allowlist and CSP `worker-src 'self'`. Use app scope, not root scope on a shared origin. Hash all shipped shell bytes into `version`; recompute in CI. Install rejects a partial shell. Activation prunes **only** old `<prefix>shell-*` caches. Data/assets survive shell updates, and every read opens a named app cache. Shell/data use network first to avoid stale online launches; assets are immutable/cache-first. The service worker never queues writes or caches mutations.

Browser storage can be evicted or cleared by the owner/browser. Say Ready offline only after the whole shell, snapshot and all referenced assets are saved. Save once online on **each device**. An installed PWA or another device does not inherit another profile's caches. Don't promise offline until that device shows ready.

## Evidence

`node tests/offline-worker.test.cjs` is a real worker harness: namespace isolation, fresh online shell/data, offline fallback, online-only failure, stale-family cleanup and observable incomplete-install rejection. Wisdom carries the full disposable phone browser journey (three collections, images, offline highlight/note/reaction/progress, ordered replay, failure retention, Back, build A/B freshness, no forced sheet reload). Vendored copies pin the exact core commit and SHA-256 digests. Promotion requires those browser results, not string-only assertions.
