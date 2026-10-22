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
  version, and verifies the legacy status response still has its old shape. No APK installation,
  uninstall or owner-server interaction occurs.
- The emulator workflow runs that instrumentation class separately from launch/Connect smoke. The
  smoke alone is **not** feature proof. Instrumentation reports are uploaded on success and failure.

Still required before merging/releasing: independent security review of the additive port and
Thales device proof of install/update/uninstall and owner-switch isolation. Version metadata is
reserved above the currently coordinated 64 build; release integration must recheck the feed and
reconcile concurrent version changes. No signed APK or update feed is published by this change.
