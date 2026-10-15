# Responsive Settings and feature-parity checkpoint

## Delivered boundary

One `WosSettings` registry now owns Settings rendering, skin selection, settings actions and settings deep-link dispatch for phone and desktop. A feature registered once appears in both mounts; a feature alias is accepted by the common deep-link parser without editing either shell. The normal `npm test` command and PR CI enforce this contract.

This is **not a declaration that every historical phone feature now has a desktop implementation**. The source inventory below deliberately records unresolved cross-platform features instead of treating them as native exceptions. Keep the umbrella request open until those gates are resolved and the final integrated build is verified live.

### Settings coverage

| Feature | Common implementation / evidence |
|---|---|
| Settings and `?view=skin` | Same registry/mount in both shells; desktop toolbar, Home, palette and keyboard entry points retained |
| Nebula, Grove, Tide, Ember, Signal | Same selector, `WosSkin` engine, tokens and storage; desktop now loads scenery/skins; all five tested on shell + real hosted Wisdom without document replacement; reload persistence |
| Unsent retry/open/edit/delete | Common rows/actions; local fixture retry/delete tested; edit routes to original agent, preserves an occupied composer, and verifies saved text/attachments before consuming the original; recording/in-flight edits remain retained |
| Voice status | Same `voice-status.js` card; actual service status displayed, not synthesized |
| Cancelled recordings | Same store/UI on both; transcribe/copy/show/hide/delete tested with isolated local fixture; reload retention; desktop recorder cancellation now writes the shared store including its final chunk |
| Connection | Common live state, refreshed while Settings is open |
| Updates | Shared web updater check action in both; native APK installer remains native-capability-only |
| Files | Existing shared Files module, reachable from Settings; nested Back returns to Settings |
| Help | Common action; shell-specific gesture versus keyboard instructions are intentional input adapters; nested Back returns to Settings |
| AI usage | Same `usage.js` renderer and refresh action |
| Assistant/selection native controls | Android/bridge-gated, not width-gated; browser Android honestly shows unavailable bridge controls, desktop does not advertise Android floating/side-button/accessibility operations |

Settings controls retain the approved phone design. Claude CLI was explicitly run with `--model opus`; the structured receipt reports only `claude-opus-4-7`, with no permission denials. Its direction was a 560px inner-column maximum, 440px desktop trailing panel, full-width narrow panel, unchanged feature order, capability gating and focus/Back continuity. Existing desktop-only Settings CSS had overridden the shared skin row; that duplicate styling was removed after screenshot inspection. The desktop panel has an opaque skin-tinted backing so underlying chat text cannot interfere with readability.

## Source inventory and unresolved scope

`responsive-feature-inventory.json` contains all entrypoint assets (56 shared, 25 exclusive) and all 46 core JavaScript modules. Exclusive entries distinguish layout/input adapters, native bridges, opt-in previews and **open gaps**. Tests fail when the inventory or import contract drifts. Runtime-generated `data.js` and `summaries.js` are not missing committed code and are intentionally fetched from the deployment during browser QA.

The source audit also inspected the local renderers and `openApp`/deep-link dispatch inside both shell adapters. Remaining non-Settings gaps include:

- Day/week/month review rendering is still inside phone `app.js`; desktop view dispatch does not implement it. Generated review data alone is not a shared feature.
- Local music voice-command parsing (`core/music-voice.js`) is installed by the phone only. Desktop voice goes through its existing agent-send path.
- Phone voice has richer capture controls (pause/continue, screen capture and context/command gestures). The browser-capable `core/screen-capture.js` exists but the desktop recorder has no equivalent screenshot toggle. Do not call these hardware-only exceptions.
- Phone Maps has a local renderer/search/navigation flow in `app.js`; desktop falls back to the registry URL/href rather than sharing that view.
- The custom PWA install prompt is phone-only. Desktop browser installation is not equivalent to a verified shared in-app install control.
- Live Mode is an explicitly enabled, simulated preview, not a completed live feature. It remains phone-only; do not promote its mock feed as production parity.
- Orb/desk gesture geometry, keyboard/window management and their help content are intentional input adapters. Android Everywhere, side button, selection overlay, Food/Grab automation, notification and background recording require real native capabilities and cannot be represented as working desktop web controls.

A future Settings registration is automatic on both layouts. Arbitrary new feature code pasted into one shell is not magically portable; the entrypoint guard, shared-by-default development rule and runtime parity tests are the prevention mechanism. Resolve the open gaps by extracting real shared components/commands, not by relabeling them as exceptions or adding dead desktop links.

## Verification receipts

Implementation/browser QA ran on `thales.local`, using Node 22, actual Chrome, the canonical live origin's GET APIs and `QA_SOURCE` static-source overlays. No Android/VM builds or deploys. Every non-GET production request was intercepted; main parity QA also disables beacons and service workers. State-changing action tests use isolated browser-local fixtures. Screenshots contain real private thread metadata and remain on the QA host, not in Git.

Evidence root: external-volume QA directory `responsive-parity-20261015`.

| Receipt | Result |
|---|---|
| `baseline/result.json` | 5 passed: actual desktop lacked a skin selector, actual phone had five |
| `candidate-3/result.json` | 73 passed, 0 failed, 0 page errors; includes source SHA-256 map |
| `unit-3.log` | 26 passed, 0 failed; later draft-store verification test is recorded in final unit receipt |
| `icons-regression/result.json` | 63 passed, 0 failed; PR29 picker/icon behaviors retained |
| `agents-regression/result.json` | 57 passed, 0 failed; agent launch and private scope retained |
| `resources-baseline/results.json` | 56 passed, 1 failed |
| `resources-candidate/results.json` | 56 passed, same 1 failed; no new failure; Resources churn +0 nodes/+0 listeners |

The shared Resources failure is `Agents System and Settings available on Home`, already failing identically on the live baseline. It is not waived as a green suite. Main parity screen inspections include desktop/phone Grove, narrow 360px desktop, all five skins and real hosted Wisdom. Earlier candidate-1 screenshots exposed a desktop specificity/opacity problem; candidate-2 and later show the corrected vertical swatches and readable narrow panel.

Final source hash/test receipts are written beside these runs after the final implementation commit. Parent release owner must independently review the diff, reconcile PR27 voice-custody work, integrate only via protected-branch PR, then verify served hashes and both live shells. No merge/deploy is performed by this implementation lane.
