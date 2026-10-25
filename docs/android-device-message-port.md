# Android device message port v1

`window.wizardDevicePort` is an additive request/reply capability transport. The first adapter is
package management. It does **not** replace all existing bridges, automate accessibility, or change
which hosted apps may use native capabilities. The Android Apps shell relay still uses the legacy
port until a separate web migration; #320 must not be unheld just because this prerequisite exists.

## Trust and lifecycle

AndroidX injects the port only for the configured Wizard origin. Native additionally requires the
source origin to equal the current runtime origin, the main frame, and a top-level
`/wizard-os-home` or `/wizard-os-home/…` URL. Hosted frames must still go through a shell relay with
its own origin/frame/path/operation checks. Credentials never enter the envelope.

The package adapter calls exactly the existing `AppsBridge.call` implementation, retaining package
validation, install permission, APK hash/signer/version checks, ownership, never-install rules and
Android confirmation. This port does not grant silent first installation. The legacy port and its
status/resume subscriptions remain unchanged. Generic event subscriptions are deliberately not yet
advertised; consumers needing pushes retain the legacy subscription until a later versioned design.

## Envelope

```js
wizardDevicePort.postMessage(JSON.stringify({
  v: 1, id: 'request-1', method: 'device.capabilities', params: {}
}));
// onmessage: {v:1, id:'request-1', ok:true, result:{v:1, capabilities:{
//   'device.packages': {v:1, methods:[/* exact supported names */]}
// }}}
```

`v` must be the numeric value 1. `id` must be a nonempty string of at most 64 characters; `method`
must be a string. `params` may be omitted, otherwise it must be an object (not an array or null).
Malformed envelopes receive `{v:1,id:'',ok:false,error:'invalid request'}` without dispatch. A valid
but unknown method receives a correlated `unknown method` error. Success replies contain `result`,
error replies contain `error`; both carry v1 and the request id.

Discovery advertises these exact package operations:

- `device.packages.status`
- `device.packages.list`
- `device.packages.icon`
- `device.packages.launch`
- `device.packages.openPlay`
- `device.packages.appInfo`
- `device.packages.uninstall`
- `device.packages.install`

Parameters and result payloads are those of the corresponding legacy Apps operation. In particular,
`list` currently retains its legacy update-job scheduling side effect. Moving that decision to web
is #320's responsibility; `scheduleUpdates` is **not** exposed by this prerequisite. Dispatch is an
exact allowlist, not reflection or arbitrary prefix forwarding. Future capability adapters must be
explicitly registered and retain native authorization; discovery is not authorization.

## Compatibility and verification

Old web + new APK keeps using `wizardAppsPort` unchanged. New web must feature-detect the generic
port and discover capability versions; absent capability/port must fall back or report unavailable,
not assume every newer APK supports a feature. No production web caller changes in this PR.

- JVM tests execute envelope parsing, malformed versions/ids/params, exact discovery/dispatch mapping,
  and success/error response contracts.
- `DeviceBridgeE2eTest` pairs the actual QA APK to a disposable localhost Wizard. In its real WebView it
  discovers capabilities, reads package list/status, rejects an unadvertised operation and unsupported
  version, verifies same-origin child frames and non-shell top-level pages receive no native response,
  and verifies the legacy status response still has its old shape. No APK installation,
  uninstall or owner-server interaction occurs. Emulator Wi-Fi/mobile data are disabled: the fixture
  uses loopback only and must not depend on background Google-services downloads.
- The emulator workflow runs that instrumentation class separately from launch/Connect smoke. The
  smoke alone is **not** feature proof. Instrumentation reports are uploaded on success and failure.

Still required before merging/releasing: independent security review of the additive port and
Thales device proof of install/update/uninstall and owner-switch isolation. Version metadata is
reserved above the currently coordinated 64 build; release integration must recheck the feed and
reconcile concurrent version changes. No signed APK or update feed is published by this change.

## device.automation v1 (Food on web)

A generic accessibility-automation capability, added by the Food thin-shell move (step 4 of
`docs/android-thin-shell.md`). Native code (`android/.../automation/`) records taps/typing in one
**allowlisted target package**, replays steps by text match, reads the target's screen, and shows the cover
overlay with progress, confirm, done and failed states. It holds no recipes, names, voice phrases or Food
wording; every word on the cover comes from the caller.

Methods (exact allowlist, same port checks as `device.packages`):

| Method | Params | Result |
|---|---|---|
| `device.automation.status` | `{package?}` | `{v, mode, ref, step, steps, taps, accessibility, outbox, log, target?:{package, allowed, installed, blocker}}` |
| `device.automation.record` | `{package, ref, words, ambiguous, returnToWizard}` | `{started}` or error = blocker code |
| `device.automation.replay` | `{package, ref, steps:[{type,label,id,near,say}], words, ambiguous}` | `{started}` or error |
| `device.automation.screen` | `{package}` | `{visible, texts, sig, commit, total}` |
| `device.automation.cancel` | `{}` | `{mode}` |
| `device.automation.outcomes` | `{}` | `{outcomes:[{id, kind:'recording'|'run', ref, …}]}` |
| `device.automation.ack` | `{ids}` | `{removed}` |
| `device.automation.shortcuts` | `{table:{entries:[{pattern, priority, action}], actions:{key: record/replay request}}}` | `{count}` |
| `device.automation.legacyRecipes` | `{}` | `{recipes}` — read-only, migration from the pre-v1 native Food |

Blocker / error codes: `target-not-allowed`, `accessibility`, `not-installed`, `busy`, `no-steps`, `bad-step`,
`too-many-steps`, `commit-step`, `bad-shortcut`, `too-many-shortcuts`. Run failure codes in outcomes:
`accessibility-off`, `not-open`, `no-field`, `type-refused`, `commit`, `tap-refused`, `not-found`,
`commit-gone`, `commit-refused`.

**Money safety stays native and is not configurable from web.** `AutomationPolicy.isCommit` (English and Thai
order/pay words) is enforced for every caller: a recipe or shortcut naming a commit button is refused whole
(`commit-step`); on every automated tap the live node, its clickable ancestor and the texts it wraps are
re-checked and a match stops the run (`commit`); a recording ends on the user's own commit tap and never
stores it. There is **no** method that presses a commit button: discovery advertises
`commit: 'user-tap-on-native-cover-only'`, and `AutomationEngine.confirm()` is reached only from a real touch
on the cover's confirm button. The total shown on that button is read natively off the target's screen.
Targets are an APK allowlist (`com.grabtaxi.passenger`; the instrumentation dummy app in debug builds only),
never the Wizard OS app itself.

Outcomes usually finish while the page is paused (the owner is in Grab), so they are kept in a small durable
native outbox (20 entries) until web takes and acknowledges them; ids are stable, so a lost ack can't
duplicate a saved order. `MainActivity.onResume` pokes `window.__wosAutomation()`.

Voice shortcuts let the floating orb and side button start a replay while the page sleeps. Web registers
anchored patterns over the normalised phrase (NFKC lower case, wake words removed) with priorities; native
picks the highest and treats a tie between different actions as "ask". Once a table is registered, web's
words decide; until then the legacy native Food phrases do. `tests/food-device.test.mjs` +
`AutomationShortcutsParityTest` prove `java.util.regex` picks what the in-app orb's JS picks.

### Compatibility

- **New web + new APK:** `web/usuals.js` discovers `device.automation` v1 and uses
  `web/food/{rules,store,backend}.js`. Saved orders move to the page's `localStorage` (`wos.food.v1`); on first
  start the pre-v1 native list is copied once via `legacyRecipes` (native copy untouched).
- **New web + old APK:** no `device.automation` capability → the legacy `WizardOSNative.usuals*` backend,
  unchanged behaviour.
- **Old web + new APK:** the `usuals*` JavaScript interface methods and the native `usuals/` package are kept and
  still work; the two drivers refuse to run at the same time (`busy`).
- **Pin the old path on a phone:** `localStorage['wos.food.backend'] = 'native'`.
- Native `usuals/` is deleted in a later APK, after the v1 path is proven on a device.

Instrumentation: `AutomationE2eTest` drives `DummyFoodActivity` (another package, the instrumentation APK)
through the real Wizard OS accessibility service: replay to the confirm state with nothing pressed, confirm
pressing the order, a commit step refused before anything runs, a control wrapping "Pay now" stopping the
run, and a recording keeping the route but not the owner's commit tap.
