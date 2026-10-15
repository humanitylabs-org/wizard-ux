# Recovery repair checkpoint

Frontend/test branch: `fix/voice-outline-recovery-20261015`.
Tested code: `2cdd2e9a114bd0b2e239bdcd41836de4a2639644` (this report is documentation only).

## Verified on Thales, isolated recovery lane

- Model: 13 passing tests (`evidence/model-tests.tap`).
- Targeted recovery browser: 9 passing checks, zero page errors (`evidence/recovery.json`). Includes held-final detachment, stale failure isolation, live root/menu Back, Accept/Edit including empty transcript, Undo → reload → Redo → reload, honest audio-only recovery, actual WAV playback progress and download byte equality.
- Existing browser fixtures: 12 passing checks, zero page errors (`evidence/full-fixtures/browser-fixtures.json`). Unsafe Origin now sends a real mutating PUT and asserts exact unchanged readback.
- Durable API/restart: 6 passing checks (`evidence/api-restart.json`).
- Real shared microphone capture with public QA speech through real Tinfoil: 7 passing checks, 267 provider events, zero page errors (`evidence/real-voice/real-voice.json`). Exact dictated text matches each target and survives reload; active recording survives menu and root browser Back.
- Visually inspected phone recovery editor and original-recording menu screenshots: `evidence/empty-draft-edited.png`, `evidence/original-recordings.png`. Controls readable, menu scrolls within its dialog.

Run `python3 qa/run-recovery.py` on the browser worker with `WIZARD_CORE_DIR`, `QA_SPEECH`, `PLAYWRIGHT_MODULE`, `TMPDIR`, and optional `PORT`/`EVIDENCE_DIR` set to worker paths. `QA_SCRIPT` selects another browser suite. Real provider suites additionally require the existing provider runtime configuration. Runner starts/stops an isolated service and refuses an occupied port. Port reuse immediately after a previous run may encounter TIME_WAIT; choose another free port rather than killing another service.

## Integration boundary

No server or dependency files were changed on this branch. Browser and API execution combined this pushed frontend with the parent's in-progress server/audio/realtime endpoint repair, copied only into the isolated recovery lane. Companion SHA-256 hashes (also in `evidence/source-hashes.json`):

- `server.mjs`: `6aa1a31888f88b5db0e4d63de9de4ec509d86d71898bc0c8ea23c4429f8af220`
- `audio.mjs`: `98b38d0903e025e2f7f996307cc2eb8e1b4ff6062b384d22321866f8d72edcf3`
- `realtime.mjs`: `acded3afca55fdfd87d79909b20cc26e5d5dde5870243023605f34724bcf7aea`

The parent's companion commit must be integrated before the recordings endpoints work. These receipts are app-scoped loopback Chrome proof, not Android physical Back, production routing, or deployment acceptance. No deployment, registry mutation, parent serving-source sync, new capture implementation, theme implementation, or Back guard was performed.

The first recovery test run exposed a test-only mistake: `capture.current()` returns metadata, not a Session. Corrected tests inspect its phase. Failed receipt was replaced by a fully rerun passing suite; no provider output was simulated in the real-voice run. Controlled-provider tests explicitly identify their fixture boundary.
