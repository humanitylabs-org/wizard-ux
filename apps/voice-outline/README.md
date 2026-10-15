# Outline — private candidate

Minimal voice-first nested bullets. Select text to edit; Enter/new creates a sibling, Child creates a child. Tab/Shift-Tab or left/right rail swipes move one level with the subtree. Fold hides a branch. Text and structural edits use a persistent operation journal; concurrent text conflicts keep both versions instead of overwriting.

## Run
Node 22.13+ (SQLite), `npm ci`, `npm start`. Defaults to loopback port 8799. Configure `OUTLINE_DATA`, `PORT`, `WIZARD_CORE_DIR` (exact Wizard UX web/core resource directory), `TINFOIL_PROVIDER_MODULE` (existing Mizel tinfoil-bridge/src/provider.js with its tinfoil 1.2.1 dependencies), and `TINFOIL_API_KEY` from the owner's existing runtime. No secrets are embedded. `SOURCE_SHA` identifies the pushed app revision. This is a narrow adapter, not a proxy to Mizel routes. No meetings, summaries, agents, alternative providers, or voice commands.

Standalone preview MUST serve the exact shared `/wizard-os-home/core/app-client.js` and `app-capture.js`; the server routes these from `WIZARD_CORE_DIR`, including the capture worklet query. An authenticated private gateway must terminate TLS, proxy the app including websocket `/api/live`, and explicitly configure `WIZARD_TRUSTED_HOSTS` (hostnames without ports) and `WIZARD_TRUSTED_ORIGINS` (full origins). The bare loopback port is not a public deployment. No registry or production proxy changes are included. Path-prefix hosting needs the gateway to strip the prefix while preserving the core resource path.

## Voice and custody
Enable Live once, Stop explicitly. The shared capture provides mono 16 kHz PCM. Each explicitly started thought has an immutable utterance and bullet identity; a new selection/bullet ends that thought and starts the next. Live text is a labelled draft, never editable text. Editing a target detaches pending speech to a sibling. Finals append exactly once; delayed events cannot replace typing. Provider sessions finalize at explicit thought boundaries / Stop, not silence heuristics. Unconfirmed/recovered speech remains labelled if a final cannot be obtained.

Capture is bounded to 15 minutes / 32 MiB per take. The server has a 512 MiB audio quota; full storage fails closed and retains shared custody. Shared chunks are uploaded while recording, then byte count and SHA-256 are read back before the stopped take is acknowledged. No acknowledgment on failed upload. Recover retries the original retained take, never records a replacement. Browser full-page exit stops recording: background/native survival is NOT claimed. Native adapters without PCM are rejected without creating meeting records. Private archive retention/cleanup is a separate owner policy; no automatic deletion.

## API / MCP
`GET /api/document` returns `{rev,document}`. `PUT` requires that exact revision and validates IDs/parents/text; conflicts return 409 with current state. SQLite WAL + FULL synchronous commits persist across restart. A Saved badge requires exact readback matching the current snapshot. Offline operations replay by stable ID. `GET /api/speech` recovers drafts/finals after disconnect. Audio `PUT/GET /api/audio/:take/:seq` is immutable/idempotent. `GET ?raw` returns stored WAV for QA. See openapi.json. MCP `outline_read` and `outline_replace` call the same service functions at `/mcp`.

## Candidate checks
Run `npm run check && npm test` on Thales. Browser QA uses Playwright on Thales, actual shared core, synthetic public test speech, and the real configured provider; fixture tests are separately labelled. No Android build, production install, or VM guest rebuild is required. The Docker compose is a development source adapter with explicit read-only shared dependencies, not an install-ready store bundle.
