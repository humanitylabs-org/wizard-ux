# Candidate QA and integration notes

## Reproduce on a dedicated QA host

Use Node 22.13+ and a current Playwright package with installed Chrome (`channel: 'chrome'`). Set `TMPDIR`, browser profiles, app data and evidence to the host's designated external work volume. Generate non-private synthetic speech with the host TTS tool and convert to mono 48 kHz WAV. Set `QA_SPEECH` to its absolute path.

```sh
npm ci --ignore-scripts
npm run check
npm test
node qa/api.mjs
PLAYWRIGHT_MODULE=/absolute/path/to/playwright OUTLINE_URL=http://127.0.0.1:8799 EVIDENCE_DIR=/external/evidence node qa/browser-fixtures.mjs
PLAYWRIGHT_MODULE=/absolute/path/to/playwright WIZARD_CORE_DIR=/exact/shared/core EVIDENCE_DIR=/external/evidence node qa/themes.mjs
PLAYWRIGHT_MODULE=/absolute/path/to/playwright EVIDENCE_DIR=/external/evidence node qa/real-voice.mjs
```

Run fixtures against disposable isolated data. For final real voice proof restart the app with fresh isolated data before running `real-voice.mjs`; it intentionally leaves a sample outline containing synthetic QA speech. It does not seed fabricated transcripts. All final text in that run comes from the configured Tinfoil provider.

- `model.test.mjs`: structure, deep nesting, undo, stable target IDs, deleted target recovery, collision validation, offline conflicts, speech deduplication and typing detachment.
- `api.mjs`: real child server restart, exact document/audio readbacks, immutable chunk conflicts, revision conflicts, invalid input and shared MCP state. Its short audio byte fixture checks storage only, not transcription.
- `browser-fixtures.mjs`: actual browser/editor/pointer/back/history/offline interactions; a **controlled websocket fixture** injects duplicate/reordered/delayed provider messages for race checks. Shared capture and audio upload/readback are real. Also kills a capture page by reload and recovers retained audio, tests denied browser permission and unsupported-native capability fail-closed behavior.
- `themes.mjs`: isolated same-origin host fixture using exact Wizard shared services, skin registry and appearance host, not application-owned protocol stubs. Five registered skins × light/dark × window/immersive. Checks transparent canvas, no duplicate window title, draft/edit and scroll preservation, host Back, and surviving shared capture after iframe replacement. Light roles are supplied by the fixture shell; physical native platform is not claimed.
- `real-voice.mjs`: real shared PCM capture from synthetic fake-microphone WAV → real configured attested provider → live drafts before Stop → exact-target final text → readback/ack → reload. No websocket/recorder/provider fixture in this run. Records ingress bytes and actual provider events.

## Operational findings

An old Playwright driver can leave `audioWorklet.addModule()` pending even with a running AudioContext and successful getUserMedia. Updating the isolated QA driver resolved this without changing shared capture or weakening browser security. Microphone denial QA must omit the fake-UI permission override in its separate denied browser.

The existing provider has also intermittently timed out finalization during real short-thought boundary tests: live partials were visible, the original audio was saved, and the affected speech remained explicitly unconfirmed rather than being invented or overwritten. Passing and failing real-provider receipts must both be retained; a successful retry is not a claim that this upstream latency/finalization issue is fixed. Sustained-thought acceptance deliberately waits beyond the first provider token before opening the next thought.

The existing provider's pinned dependency audit reported high-severity advisories in `undici` and `brace-expansion`. This candidate does not patch the shared/attested provider or claim that upstream dependency issue is repaired. App-owned `ws` dependency audit was clean. The private parent review should assess the pinned provider before wider exposure.

## Boundary of delivery

No production registry, shared client, shell, gateway or service edits. No Android, native release or guest rebuild. A private HTTPS gateway still needs to route the candidate, the websocket and exact shared core, with explicit trusted origin/host configuration. Native PCM unsupported adapters fail closed. Full browser exit cannot keep recording; hosted iframe replacement can recover the same shared take, with an honest disconnected-transcription message and explicit Stop/save.
