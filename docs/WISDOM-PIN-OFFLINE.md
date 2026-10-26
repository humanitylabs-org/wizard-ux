# Wisdom Android pin: offline shell (staged, not released)

Reuse:
- REUSE `single-app-session.js`, WizardApp Back, appearance host, `apps.js` last-known-good registry and route checkpoint. No alternative reader or native overlay.
- EXTEND `core/offline-sw.js` with an explicit host navigation allowlist; `web/sw.js` only configures that shared implementation with the `wizard-os-home-` cache family.
- NEW `core/offline-apps.js` + `core/offline-session.js`: reviewed offline app capability table and bounded shell preparation, shared by the registry and worker. No app-specific cache engine.
Visual: unchanged Wisdom reader and pinned window; two skin screenshots and offline images required from the disposable rig before acceptance.

## Source and scope

Started from the tracked serving shell at `380c288848c9a5590fbe5690f28e6a2a25332b7c`, on `live/agent-parity-20261022`, not GitHub main (the live tree contains approved work not yet on main). PR base is that live integration branch; do not merge or publish it. The prerequisite shared kit is included from the three commits in PR #536 without changing its app replica/outbox contract. Live generated `data.js` / `summaries.js` are not source or offline dependencies and must never be committed or cached.

## Fix

1. The shell's own legacy migration table still listed `/wisdom/sw.js` for unregistration. `WizAppServices.attach()` runs this cleanup immediately and again at iframe load, racing the app's registration/claim and deleting its registration. Remove only Wisdom's row. Other migrations remain unchanged. Verify this lifecycle on the real frame, not by changing WebView global network/security settings.
2. A pin still navigates to `/wizard-os-home/?app-session=wisdom`. The shell worker installs a **small isolated host document**, not the ordinary workspace. Its dependencies reuse the existing session/Back/services/registry/appearance modules. Only the reviewed exact Wisdom route opts in. Offline navigation fallback accepts one exact app-session parameter at the shell root/index; ordinary workspace, arbitrary apps, malformed/repeated IDs and extra query data stay network-only.
3. Shell installation completes before mounting an opted-in app on first online open. Registration failure is bounded and never reloads the page. App state, library and art remain exclusively in Wisdom's existing scoped worker/IDB families. Registry/route use the shell's existing last-known-good local storage; no Agent Service API response is copied into a host cache.
4. Private attachments/files, writes, range requests and cross-origin requests bypass caching. Activation only prunes old `wizard-os-home-shell-*` generations. Every fallback opens its named cache; no origin-wide cache match or deletion.
5. Pinned windows never offer an additional browser/PWA install. No native source change has been made.

## Tests

Light checks:

```
python3 tools/build-offline-session.py --check
node tests/offline-worker.test.cjs
node --test tests/home-screen-apps.test.mjs tests/wizard-pin-opens-wisdom-offline.test.cjs
```

Disposable forum browser (no live URL, data mounts or model calls):

```
PLAYWRIGHT_DIR=<installed playwright directory> \
WIZARD_PIN_WEB=<candidate>/web \
WISDOM_SOURCE=<immutable Wisdom private.34 source> \
WISDOM_OFFLINE_SEED=<private copied library + wisdom.sqlite> \
PIN_EVIDENCE=<new evidence directory> \
node tools/qa-wizard-pin-opens-wisdom-offline.cjs
```

The runner copies Wisdom's DB/library into a temporary directory, opens the **exact native pin URL**, waits for both scopes and the full app save, aborts all routes, sets browser offline **and stops the disposable server**, reloads, requires 35 collections and a readable illustrated chapter, exercises shell/native-style nested Back and repeated root Back, checks namespace sentinels, and captures two skins + trace. Optional `PIN_REPRO_LEGACY=1` restores only the obsolete Wisdom migration as a negative control.

Emulator acceptance remains a separate required result: install actual current-version Wizard APK on a disposable **forum x86_64** AVD; create the pin with native taps/OS confirmation; save online; enable airplane mode; cold-open its icon; assert AppSessionActivity + Wisdom instead of ReachScreen; capture screenshot/log/shortcut state; chapter Back must remain in the app; stop the AVD in `finally`. An unrun job specification is not a pass.

## Remaining release action (not authorized here)

After browser/emulator acceptance and review, integrate this **web-only delta into the current live shell source**, preserving later live changes; regenerate `web/sw.js` from those exact bytes and run the parity gate against the then-serving source. Stage through the existing shell web-update mechanism, with a named rollback snapshot, without publishing it here. No phone APK update is expected **if the current-version emulator proves ReachScreen clears on cached main-frame commit**. Each phone must open the Wisdom pin once online and finish its local save before it can cold-open offline; caches are per WebView/device and may be evicted. If emulator evidence requires a native fix, do not silently promote: build/verify on Thales and make the phone-update requirement explicit.
