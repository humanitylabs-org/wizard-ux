# Shared app-services host/client v1

Implementation is isolated on `fix/shared-app-services-20261012`, from daily `951290d2f886720b444570016bd27188214ac46c`. No deployment or live source edits are part of this slice. `app-capture.js` is supplied by its separate owner and must be integrated before release.

## Wiring and boundaries

- Both shells load `appearance-host.js`, then `app-capture.js`, then `app-services.js`. Desktop also loads `app-updates.js`; phone keeps its existing attributed update banner in `device.js`.
- Each shell mounts a frame with `WizAppServices.attach(frame, {appId, path})`. It associates only registered IDs/URLs. Every resource access rechecks the exact Window/document, current URL, frame src, connection and live registry entry. Removal, document unload/navigation and registry removal reconcile document holds. A liveness timeout is diagnostic, not permission to discard recording or reload.
- Apps load `core/app-client.js` and use `window.WizardApp`. They retain domain routes/state/callbacks, not browser/native platform implementations. `ready()` negotiates the actual attached host. The same client works standalone without accessing parent globals or registering an app worker.
- The direct facade contains only Back, theme, share, capture and update methods. Serialized transport has an operation allowlist, exact source/origin checks, a 32-request bound and client timeouts. No arbitrary parent/global/native operation is proxied. Privileged off-origin resources intentionally fail closed because the host cannot verify their current path. Off-origin Back returns pending/stay and never performs a delayed shell step.

## Companion panes (workspace host, v1)

Any installed same-origin app can open **one** companion using the shared client. Await `WizardApp.ready()` first:

```js
const off = WizardApp.shell.onCompanionMessage(({from, data}) => {
  // from is 'app' in the companion, 'companion' in its owning app.
  showItem(data);
});
await WizardApp.shell.openCompanion({
  path: '?pane=notes', title: 'Notes', share: 0.36,
  focus: false, data: { item: 'selected-item' }
});
await WizardApp.shell.postCompanion({ item: 'next-item' });
// From the companion, the same method replies only to its owner.
await WizardApp.shell.focusApp(); // Back at companion root does this automatically
await WizardApp.shell.closeCompanion();
off();
```

Open resolves to `{id}` (or `null` if a window cannot be placed); close/post/focus resolve to booleans.
Outside the workspace (standalone or the single-app host), open rejects explicitly. There is no separate root guard.
`path` resolves against the caller's document and must stay within its installed registry URL's directory,
on the same origin. Encoded traversal, credentials and other apps' paths are rejected.
`share` is a desktop fraction, default .36, range .15–.60; optional `ownerShare` (.15–.80) preserves
existing three-column arrangements. Phone places Chats → app → companion; desktop tiles it on the
owner's desktop. `focus:true` brings it forward; otherwise the current surface remains active.
Opening the same path updates the retained initial `data`; opening another path replaces the companion.
The latest owner payload replays after companion readiness/reload. Messages must be JSON ≤32 KB;
there are no caller-selected target IDs. Multiple apps/windows have independent pairs, never nested companions.
Back consumes the companion's own nested views first, then focuses the owner without closing either view.
Owner unload, removal or loss of registration closes its companion and restores the prior owner width.

`companion-legacy.js` is a **one-release wire adapter**, not another pane implementation. It accepts the
installed Video Editor's unchanged `{type:'video-editor:desk', action:'context'|'time'|'open-video', hash,...}`
from verified app frames and maps it to these same scoped operations. Context with a clip opens
`?pane=feedback` (`share:.26`, `ownerShare:.46`, title Feedback), context without one closes it,
time updates the binding, and open-video focuses/replies to the bound owner. Delivery is translated to
`{type:'video-editor:bound', hash, time, focusComposer}`. App IDs/routes live only in that adapter;
`companion-pane.js` has none. The installed app needs no update.

## Back

`back.register({canGoBack, back})` requires synchronous booleans. `back.push(fn)` supplies LIFO overlay release tokens. `back.useHistory({isRoot})` stamps real app entries and preserves object router state. The phone's history taming/pop bridge recognizes those entries instead of replacing them or taking another shell step. Host Back trusts the callback; the legacy DOM-signature and 180 ms double-step are deleted. Honest `__wizardCloseOverlay` is a temporary compatibility adapter.

Hosted apps have no independent root guard. Phone retains its host guard; desktop now guards browser/native Back as well. Shared standalone fallback uses CloseWatcher/history, stays at installed root, and offers the browser-tab two-press exit floor. Desktop Back no longer cancels a recording: its voice pill has an explicit Cancel button.

## Sharing and native limitations

The host uses `WosChat.sharePayload` / `shareFile`, calling immediately inside the originating gesture. Web Share retains separate title/text/url fields; Android text sharing combines text and URL into the bridge's one EXTRA_TEXT payload without losing either. Relative share URLs resolve against the authorized app document, not the shell; absolute input strings are preserved. Files preserve bytes/name/MIME across frame realms; URL-shaped file payloads cannot cause privileged host fetches. Clipboard outcomes resolve only after successful writes. AbortError is cancelled. Native Promises have a 15-second bound.

**The current Android Java bridge methods return void and swallow chooser failures.** The shared JS still opens that chooser but returns unsupported when there is no explicit receipt; it cannot truthfully report shared or cancelled. The common file viewer also avoids a second text chooser and a false Shared toast after an unconfirmed native file invocation; cancellation shows no success toast. Explicit string/JSON/object/Promise receipts are supported and tested with mocks. Real Android outcome/cancellation readback requires a native bridge follow-up. The inspected existing Mac bridge supplies app/meeting methods but no native sharing method, so desktop retains Web Share/clipboard capability fallback rather than inventing a bridge method.

## Updates and capture seam

Only explicit Reload is offered; background visibility never forces it. Reload rechecks app holds, automatic recording holds, shell voice and uploads. A frame disappearing cannot cancel the capture module. Its getState remains authoritative for active recording even after document holds are reconciled. Original shell voice and shared capture reject a second physical microphone owner.

The capture facade delegates start/pending/ack by registered appId, with automatic holds before permission and through settled Stop/Cancel. Failed Stop is retryable. Optional Session pause/resume are preserved. `start({resumeId,...})` uses the separate capture module's `resume(appId,id,opts)` seam when supplied; it does not expose configureNative.

Standalone apps should declare `<html data-app="registered-app-id">` for the same durable capture owner across hosted/standalone surfaces. Without metadata the client generates a valid stable standalone owner, rather than passing an invalid slash-containing pathname into capture. Native kinds `auto`/`command` are reserved for the existing Wizard voice path; apps use audio/meeting/task kinds and domain metadata.

### Native ownership integration gate

Android's existing `recActive()` does **not** report its kind. Legacy `device.js` must never adopt a shared app native take into the Wizard orb, send it to Chats, or claim/delete it. It now filters pending takes to exact legacy voice kinds, skips shared/unknown active owners, rejects physical-recorder reuse by the orb, and checks native activity at Reload even when JS state is idle.

Before deployment the separately owned capture module must supply `getState().nativeOwnershipReady` and `nativeDeviceTakeIds` (native RecordingStore IDs owned by its active/pending/recoverable wizard-device rows until durable ack), and dispatch existing `wizard-app-capture-state` on readiness/ownership changes. Missing ownership metadata fails closed: native copies remain, but cold legacy voice resume is withheld rather than guessing. Preserve physical `recording`/`hold` truth for native captures confirmed live during recovery even when logical `active` is false. Detailed handoff: `$HERMES_HOME/cache/scratch/shared-app-services/CAPTURE-HOST-NATIVE-OWNERSHIP.md`. **This seam is a deployment gate; this slice does not edit app-capture.js.**

Reviewed legacy cleanup entries live in `WizCore.appMigrations`: exact Signal/Wisdom/Social app scopes/scripts and Trackhunt's exact `trackhunt-v1-20260711d` cache. No generic scope/prefix scanning; root/shell/unrelated registrations and similarly named caches remain. Social's historical root `/sw.js` is intentionally not app-owned cleanup.

## Initial executed QA and receipts

Host: **thales.local**. Initial executable source commit: `90bdc558a1178bb1e5d171808641a28d3b734eb9`; complete tree: `b05afb099cac279aeff3a8e3fb7d18c555d446c6`; web tree: `5006d254031f9b2b5096ef91f0b4cacc3ffdf220`. QA-portability commit `60b48be` used that same web tree; later functional changes require their own receipts. A readback hash comparison verified all 92 initial staged web files match the source, with no extra files.

Immutable stage: `$WIZARD_WORK_ROOT/WizardApps/shared-services/host/source-90bdc55`.

```sh
export PATH=/opt/homebrew/bin:$PATH
export PW=$HOME/workspace/wizard-mobile-link-candidate/node_modules/playwright
export QA_WEB_DIR=$WIZARD_WORK_ROOT/WizardApps/shared-services/host/source-90bdc55
export QA_OUT=$WIZARD_WORK_ROOT/WizardApps/shared-services/host/evidence/90bdc55
export QA_SHA=90bdc558a1178bb1e5d171808641a28d3b734eb9
export QA_TREE=b05afb099cac279aeff3a8e3fb7d18c555d446c6
/usr/bin/lockf -k -t 5400 $WIZARD_WORK_ROOT/AndroidBuilds/worker.lock \
  /opt/homebrew/bin/node "$QA_WEB_DIR/qa-app-services.cjs"
```

**158 checks passed, zero failures.** Registered-path fixtures cover all 17 approved launcher app IDs on phone and desktop: nested Back exactly once, root stays open, on-screen Close parity, Appearance v1 state retention, gesture activation, text/URL/file bytes, explicit native/cancel/void receipts, update holds/availability, capture automatic holds, original shell voice mutual exclusion, clipboard completion, lifecycle authorization, real browser exact SW/cache cleanup and standalone nested Back. Zero local-network writes/agent writes; no external request escaped the fixture origin; no shell page errors.

Receipts: `evidence/90bdc55/receipt.json`, `run.log`, `phone.png`, `desktop.png` under the Thales host directory. Small local mirror: `$HERMES_HOME/cache/scratch/shared-app-services/host-evidence/90bdc55/`.

These are **host/client contract fixtures**, not proof of the independently migrated apps' actual domain Back or physical native/capture behavior. Capture is a labeled contract mock; permission, durable chunk recovery, levels, shell restart and actual native bridge proof belong to the capture slice and parent integrated acceptance. Screenshot token injection is protocol/state QA, not a visual approval of app themes.

## Final executable verification

- Host: `thales.local`.
- Executable commit: `fc4e2c084e97e9e552bd9c1702d21b199c84f746`.
- Complete executable tree: `b76534799a599745a724f178201b0ce1137074d1`.
- Web tree: `df7d4bfb41cb407c04e1c13595af11b0f329f66c`.
- Stage: `$WIZARD_WORK_ROOT/WizardApps/shared-services/host/source-fc4e2c0`.
- Receipts: `$WIZARD_WORK_ROOT/WizardApps/shared-services/host/evidence/fc4e2c0/` (`receipt.json`, `run.log`, `share-ab.json`, `share-ab.log`, `share-select.log`, `device.log`, `status.txt`, screenshots).
- Local mirror: `$HERMES_HOME/cache/scratch/shared-app-services/host-evidence/fc4e2c0/`.

All four commands executed serially on Thales under `/usr/bin/lockf -k -t 5400 $WIZARD_WORK_ROOT/AndroidBuilds/worker.lock`, using `PW=$HOME/workspace/wizard-mobile-link-candidate/node_modules/playwright`, the stage as `QA_WEB_DIR`, receipt directory as `QA_OUT`, and exact commit/tree as `QA_SHA`/`QA_TREE`:

```sh
node qa-app-services.cjs
node qa-share-receipt-ab.cjs
QA_BLOCK_WRITES=1 node -r ./qa-thales-loader.cjs qa-share-select.cjs 'http://127.0.0.1:18923/wizard-os-home/?shell=phone'
QA_BLOCK_WRITES=1 node -r ./qa-thales-loader.cjs qa-device.cjs 'http://127.0.0.1:18923/wizard-os-home/?shell=phone'
```

The A/B command used `QA_BASELINE=$WIZARD_WORK_ROOT/WizardApps/shared-services/host/baseline-951290d/web/core/chat-kit.js` (exact archived daily source). Legacy suites used a temporary read-only reverse tunnel to the control-plane origin; outbound non-read requests and service workers were fenced, and all intended writes were fixture responses.

Results: **180 host/client checks, 89 device checks, 31 selection/share checks passed; zero failures.** Both A/B controls passed: daily's void native file invocation falsely reported Shared, while the candidate reported unconfirmed without a second chooser. All command exits were 0. Parsed actor coverage verifies 17 approved IDs on phone and 17 on desktop. Final readback confirmed all 92 staged web files match source, with no differences or extra files.

Added coverage includes repeated native-Mac root Back, standalone owner generation, native transport timeout, retry Stop, actual-state automatic hold release, frame removal while recording, sibling source impersonation, relative app URL sharing, and native app-take isolation from the legacy voice importer. The native ownership tests supply an explicit **mock** ready/ID snapshot; they do not prove the separate capture module has implemented the required deployment seam. Resolve that gate and the physical chooser-readback limitation before claiming integrated native acceptance.
