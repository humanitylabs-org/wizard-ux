# Shared Settings / About repair

Reuse: REUSE `WosSettings.register`, its page registry and mounted `focus(id)`; EXTEND `wizard` (About), `WosUpdates` and `WizWebUpdate`. MOVE the existing native About markup out of `device.js` into the registered shared About owner. The device adapter now supplies native state and retains its existing guarded update action. NEW: no product owner/module, only focused regression/acceptance coverage.

## Proven causes (source, not an inferred Robert installation)

- Both live entrypoints already load the same `core/settings.js`, `core/settings.css`, `core/os-updates.js` and `core/web-update.js`. Desktop supplies navigation/focus; phone supplies gestures. The finite fix does not replace the shells or drop their existing Settings pages.
- The native Android adapter's About row called `Updater.state().installed` **Wizard OS**. `Updater.java` builds that value from `BuildConfig.VERSION_NAME` and `installedCode` from `VERSION_CODE`. It is the Android package version, not the server release. Android's main UI loads `AppState.origin() + /wizard-os-home/`; the installed APK is not the source of a separately bundled main Settings screen. Bundled assist screens are different surfaces.
- The shared server updater independently called `st.installed` **Wizard OS**. Its source is App Manager `GET store-install/_updates`. `releases/stable` and `releases/latest` in the separate wizard-os release repository were both `0.3.102` at inspection. That is not evidence of any particular installed version on Robert's server.
- Desktop had no native adapter and no independently visible loaded-interface build. When the App Manager GET failed/malformed, `html()` returned nothing and `available()` returned false. The server version and Automatic/Ask me controls silently disappeared. Parent verified the actual owner's service and owner-facing edge return HTTP 404; that external missing route is not repaired by pretending a preference is known.
- Exact-live and current main `os-updates.js` were byte-identical at inspection. Main has intervening Appearance/tweak changes, but that is not the cause of this exact version-label/hidden-route defect. Robert's APK, server version, source and update preference have not been inspected; they remain unknown.
- `ux-version.txt` identifies the web tree. `WizWebUpdate.version` may already identify a newer pending build, so About now uses the new `loadedVersion` accessor (the original fingerprint), refreshed after its initial read. It is labelled **Interface build**, not a product release number.

## Original update connector boundary

App Manager's `wam/store_install.py` defines `/wizard-os-home/store-install`, loopback port 7791, and the `tailscale serve --set-path` mapping. Its gate checks a root-owned proxy socket and the owner's Tailscale identity; changes additionally require another device, same-origin JSON and `X-Wizard-Store: 1`. The Agent Service's static-file route is not a substitute. Enabling/repointing that listener on an existing private installation is a separate operator change; this UX candidate neither changes that route nor relaxes its gate. A missing/denied/unreachable route now has a visible status and a read-only Try again action, with no unverified install/policy controls. Even a later failure withdraws stale controls. No preferences/channel/install state were changed during diagnosis.

## Finite page inventory / preserved differences

All categories are defined once in `WosSettings.PAGES`; registered package content/actions flow into both mounts. Empty package categories and genuine capabilities remain gated, never viewport-width gated.

| Category | Shared owner / preserved behavior |
|---|---|
| Your network; AI; Network & security; Storage & backups | Package registrations in shared Settings, present when filled |
| Appearance | Existing registered Look, glass and skin-frame controls; skin changes stay live |
| Chats & app screens | Existing provider/own-view controls and their confirmation/readback |
| Voice & typing | Existing voice, microphone, selection and recovery dependencies; desktop bar-button arrangement remains desktop-only |
| Phones & devices | Existing shared phone-connect owner, gated by owner response |
| Phone | Actual Android/desktop-wrapper capabilities: assistant, orb, side button, device identity; not promised by a browser width |
| Connections | Existing owner-only App Manager view and its own actions |
| Unsent & recovered | Existing stores and actions, not modified |
| Resources / AI usage | Existing resources renderer or usage fallback |
| Schedules | Existing scheduler registration when available |
| About & updates | One registered renderer: connection, loaded Interface build, Phone app (Android) only with native state, shared server release/status/policy, existing Help/Files/Resources actions |

Help text remains input-specific (keyboard versus orb/gestures). Native recording/notification/update data and side-button operations require the actual bridge. Native About markup itself is now shared, rather than a phone-only HTML callback. Desktop Settings opened from Home retains #1552's centred modal for every skin; no desktop navigation/window code is changed.

## Version scheme boundary

This repair distinguishes **Wizard OS (server)**, **Phone app (Android)** and secondary **Interface build**. It does not rename Android artifacts into a whole-product version or change existing release numbers/feeds. A future single headline product number needs a release manifest that binds the server release, web tree and supported Android package version/range. The least disruptive choices are (1) server product release as headline, component details beneath, once verifiable on every installation, or (2) a new coordinated product-release manifest mapping the independently updated components. Choosing/renumbering that scheme is not part of this Settings fix.

## Verification boundary

`tests/settings-component-parity.test.mjs` compares every reachable category/page at equal capabilities, visible desktop/server/phone component versions, native renderer extraction, loaded-vs-pending interface build, 404/403/malformed/offline failure, retry and stale-permission withdrawal. The same new assertions against unmodified live source fail (one passing parity check, six regression failures); the candidate passes. Existing update mode/channel/apply tests keep their exact POST assertions. Prior tests that required silent disappearance were strengthened to require visible fail-closed status.

`qa-settings-component-parity.cjs` extends the Settings redesign/Home-panel acceptance pattern with sealed static assets and fully synthetic APIs. Established-owner fixtures seed the actual `wos.welcome.v1=done` key and authenticated model options plus `/wizard/v1/setup` with `first_run:false` before navigation. Acceptance waits for the actual `__welcomeLog` decision `boot:true:done:false` and asserts both controller and overlay inactive; it never removes Welcome. Trusted Locator input re-resolves settling/re-rendered controls, and family/palette selection follows the actual DOM on each source revision. `tests/SettingsParityFixture.test.mjs` runs the real Welcome boot slices against these schemas and guards the original interaction assertions. It exercises actual desktop and Android-UA/touch shells, every reachable category, two skins/live skin change, Home centring, About component identities and policy/channel action readback, native check action, missing-route recovery, nearest Back/Escape/outside handling, opacity and retained screenshots. Every request is fulfilled/aborted locally; all writes are intercepted, and no real agent runs exist. Browser execution and screenshot review remain parent-admitted forum gates, not claimed by source/unit results.
