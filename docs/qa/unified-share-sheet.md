# Unified Send to agent sheet — staging only

## Ownership

REUSE: `WizAttachChip`, `WosAgents`, `WizConfig`, Chats uploads/outbox, and Android `ShareQueue` / `ShareService` / `ShareUploader` / thread notifications.

EXTEND: `web/core/share-wizard.js` is the **only compose/Agent/Chat UI**, for Android imports and installed-app forwards. Extend the trusted `WosDevicePort` envelope with `device.shares` v1, not a new feature `JavascriptInterface`.

NEW: focused regression and synthetic browser/DOM runners; no second compose sheet or upload service.

## Data and cancellation

- The comment is empty, first inside the compose border; shared text is a separate read-only quote. Only Android filename-only metadata / `Emailing <attached filename>` is discarded. Real forwards are not rewritten.
- Agent is always shown; stopped agents are disabled and private agents are not filtered out. Chat has one list, New chat first. Changing Agent clears Chat before its scoped fetch; late old responses cannot overwrite it.
- Web delivery explicitly passes the selected agent into `Chats.sendChat` and the existing durable outbox for new **and** existing chats. It does not inherit a focused window's model/Space/agent or consume the destination draft.
- Android `ShareActivity` only stages incoming content URIs, with a durable private copy and SHA-256, while its read grant is valid. Own-provider and non-content URIs remain refused. It hands the staged ID to MainActivity; there is no native compose/picker UI or `SheetBack` implementation.
- The WebView is hidden until this exact share sheet mounts. Native Back during discovery cancels it. After mount, the shared Back/outside logic cancels the share and backgrounds Wizard's task to return to the source app; it never finishes the root activity.
- On Send, when the box advertises resumable uploads, the web sheet calls `device.shares.queue` with shareId, agent, agentLabel, thread, note, and keptItemIndexes. The native adapter verifies the currently active share ID. `ShareStore` promotes only retained items via phone-private hardlinks to the existing queue, saves the READY manifest before releasing staging custody, and starts the existing service. Retrying a lost acknowledgement uses the same queue ID.
- SHA computation happens during staging, not on Send or through base64 JS. The existing service owns retries/reboots/notifications; no replacement uploader was added. Old staged shares without hashes and boxes without resumable uploads retain the web path.
- Panels have a solid backing even if skin tokens contain alpha. The existing phone focused-field/orb dictation affordance remains available. Two-skin rendered review is still required below.

## Executed locally

```
node --test tests/share-sheet-comment-separate.test.mjs tests/app-share-wizard.test.mjs tests/share-sheet.test.mjs
# 24 tests, 24 pass, 0 fail
node tests/share-sheet-comment-separate.dom.cjs
# 5 integration scenarios pass (jsdom; NOT rendered-browser proof)
```

Against the real pre-change live baseline `863a9946`, `SHARE_TEST_TREE=<baseline export>`:
- All eight new `share-sheet-comment-separate.test.mjs` checks fail.
- The DOM runner exits 1 on the old comment placeholder, rather than passing against the old UI.

## Rendered-browser gate (forum; not yet claimed green)

`tools/qa-unified-share.py` verifies a committed-tree/baseline SHA manifest, runs the focused unit green/red gates, then `tests/share-sheet-comment-separate.browser.cjs` on real Chromium. It checkpoints phase logs and browser receipts. The browser harness uses the real installed-frame app service/client and shared sheet, **synthetic** agents, session lists and delivery endpoints. Its native callback is explicitly simulated; it cannot prove Android URI grants or background service delivery.

Expected rendered scope: both shells, Nebula and Sepia, empty boilerplate comment, one-agent row, New chat first, stopped/private agents, reset/scoped chats, outside/Back, kept attachments, new/existing non-default destinations, ten-file one-message batch, retry retention, opaque picker, no browser errors. Screenshots use `share-unified-*.png`.

The owning coordinator must submit the exact staged forum spec returned with this branch; helper-child heavy admission is intentionally refused. Copy accepted screenshots into `~/.hermes/cache/screenshots/` and inspect them before calling this gate complete.

## Android acceptance still required — Thales unreachable during implementation

Source reserves **0.10.20 (84)**; debug/QA installs as `ai.wizards.os.qa`, version `0.10.20-qa`. This is configured source metadata, not an APK claim.

When Thales is reachable, use `android-build-thales --prepare-only --wait-for-lock --project <checkout> --gradle-dir android --output <private evidence> -- :app:testDebugUnitTest :app:assembleDebug`, then submit its exact returned spec with host Thales. Do not build Android on the VPS. Run `UnifiedShareStoreTest` (promotion/removal/reload/idempotency/invalid identifiers) and existing capture-custody tests as part of that build.

On an isolated Thales emulator, with an entirely synthetic Wizard service and a separate PDF-sending app:
1. Cold-share a real PDF with EXTRA_TEXT `Emailing x.pdf`; prove no Home flash and an empty optional comment.
2. Confirm the same unified DOM sheet, default New chat, visible one-agent row, and an opaque Agent/Chat picker.
3. Add a comment, pick a second synthetic agent, Send; read back the message, PDF bytes and comment in that synthetic agent.
4. Repeat into its existing chat, remove one of two items, and read back only the retained PDF plus comment.
5. Cancel via outside tap and Back, including cold-start discovery; verify return to the sending app and no message/queue item.
6. Interrupt network, close app/reboot, then restore network; verify the existing resumable queue completes once and its notification opens the chosen thread.
7. Retain the signed QA APK, signature/version receipt and phone screenshots on ThalesMedia. Stop every owned emulator.

No APK, real Android PDF share, service/reboot continuation, notification tap, or phone screenshot is claimed proven yet. Do not merge, deploy the shell, or update `/reports/wizard-os/latest.json` from this work.
