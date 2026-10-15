# Receives voice input

The installed catalog must project strict `receives_voice_input: true`. The browser registry preserves that value only from a successful Service catalog read, never from its localStorage tile cache. The host additionally binds installed URL, original frame, document and receiver. App IDs are not an allowlist. Page metadata and the former unacknowledged `wizard-os:voice` postMessage route no longer grant voice delivery.

Apps register `WizardApp.voiceInput.register({snapshot, receive})`; `conversation.register` is the same registration object for compatibility. Snapshot returns `null` for an intentional inactive view; undefined, missing receiver, exceptions or invalid targets retain a sealed unavailable route. Valid targets have a nonempty label (160 characters max) and JSON context copied/frozen recursively (8 levels, 256 nodes, 8192 characters including keys). Text remains limited to 12000 characters. Unsupported attachments are retained, not discarded.

The existing durable outbox retains its `conversation` storage kind and original request IDs. This is intentional compatibility with pending recordings. Only explicit app delivery uses that kind. Receivers call `authorize()` immediately before durable admission, including after waits. An acknowledgement must match the original ID. Reload or revocation retains the original; it cannot silently rebind to a new document or fall back to Chats. Manager uses the shared receiver, keeps its own durable idempotent API, and owns feedback.

## Interaction

- Tap: active capable app, with amber outline and text destination cue; focused-field dictation remains insertion-only.
- Hold stationary: existing command capture/release. Capture starts at the existing 380 ms hold threshold, not touch-down.
- Hold, slide up onto the visible configured-agent target, release: synchronously latch general speech. This release never sends. The recorder/buffer is not restarted. A fresh tap sends; an immediate double-tap cannot duplicate admission.
- Sliding off the target restores command release. Horizontal hold aiming and pre-threshold desktop/window swipes remain their existing gestures. Upward motion after the hold threshold is reserved for the visible general target (previously early drag could revert to window dragging).
- Back during latched general capture pauses and retains it. OS pointer cancellation follows the existing pause/retain path.
- Desktop keeps new-chat shortcuts and adds a labelled Record for [configured agent] button. Explicit general capture excludes foreground app/private thread context and stays with the main agent despite focus changes.

## QA boundary and replay

`qa-manager-orb.cjs` runs on Thales with real Chrome, fake microphone, candidate assets, live read-only shell/bootstrap/catalog data, and intercepted Manager state, STT, uploads and all writes. It injects a fixture catalog declaration for Manager because live installation is the parent's release task. `QA_GESTURES=1` exercises the latch and explicit general action. These results are not live backend admission or physical handset/native Android proof.

Required environment: `PW` (Playwright module), `CHROME`, `QA_MANAGER_DIR`, `QA_URL` (shell URL ending in `/`), `QA_OUT`. Source tests: `node --test tests/app-conversation.test.mjs tests/manager-orb-route.test.mjs tests/voice-input-registry.test.mjs`. Companion Service change projects the capability from owner-controlled apps.json and launcher.json. Deployment, private trial registry flags, and live receiver verification remain separate release steps.
