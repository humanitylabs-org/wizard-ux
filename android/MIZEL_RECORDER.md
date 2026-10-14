# Mizel meeting recorder (Android, Wizard OS 0.7.0)

Native meeting recording for the Mizel.ai view inside Wizard OS (`ai.wizards.os`). The page drives it over
`window.wizardMizelPort`; native owns the microphone, the chunk files, the upload outbox and the base URL.

Source: `android/app/src/main/java/ai/wizards/os/mizel/` · `MicOwner.java` · QA: `tools/qa_mizel.py`.

## Page ⇄ native protocol (`window.wizardMizelPort`)

Installed with AndroidX `WebViewCompat.addWebMessageListener(web, "wizardMizelPort", {"https://<machine>.<tailnet>.ts.net"}, …)`.

- Present in **every frame whose origin is exactly `https://<machine>.<tailnet>.ts.net`** — the Wizard OS shell, its
  `/meetings/` iframe, `/mizel-live/` (main frame or iframe). Absent everywhere else (other origins, http, other
  ports). If the WebView lacks `WEB_MESSAGE_LISTENER`, no port is installed at all (feature-detect
  `window.wizardMizelPort`).
- All messages are **JSON strings** in both directions. Use `port.postMessage(JSON.stringify(cmd))` and
  `port.onmessage = e => JSON.parse(e.data)` (or `addEventListener('message', …)`).
- A frame starts receiving pushes after it has sent at least one message (send `status` on load). Up to 8 frames
  are remembered, most recent first.
- The page never passes a URL or token. Native uses `https://<machine>.<tailnet>.ts.net/meetings/api/…` itself.

### Page → native

```json
{"id": "<string|number>", "cmd": "start" | "pause" | "resume" | "stop" | "status", "meetingId": "<id>"}
```

- `start` requires `meetingId` (`[A-Za-z0-9_-]{3,64}`, the meetings service's own id rule). The meeting must
  already exist on the server (the page creates it with `POST /meetings/api/meetings`). Starting the meeting that
  is already recording is a no-op `ok:true` (reattach).
- `pause`, `resume`, `stop`, `status`: `meetingId` optional; if given it must be the live meeting
  (else `wrong_meeting`).
- `id` is echoed unchanged in the reply (`null` if missing or not a string/number).

### Native → page: reply (exactly one per command)

```json
{"id": "<same id>", "ok": true, "status": { …state… }}
{"id": "<same id>", "ok": false, "error": "<code>", "status": { …state… }}
```

`status` is included on every reply except malformed-input errors (`bad_request`, `unknown_cmd`,
`bad_meeting_id`).

Error codes:

| code | meaning |
| --- | --- |
| `bad_request` | not JSON / no `cmd` |
| `unknown_cmd` | `cmd` not one of the five |
| `bad_meeting_id` | missing (start) or malformed `meetingId` |
| `mic_permission` | RECORD_AUDIO not granted (ask via the normal web `getUserMedia` flow, which triggers the Android prompt) |
| `mic_busy` | the Everywhere orb or the side button holds the mic (a toast says which), or Android refused the mic |
| `busy_other_meeting` | `start` for a different meeting while one records |
| `not_recording` | `pause`/`resume`/`stop` with nothing recording |
| `wrong_meeting` | `meetingId` given and not the live one |
| `start_failed` | the service could not start / did not answer within 10 s |

### Native → page: pushes (to every frame that has spoken)

```json
{"type": "level", "me": 0.42}
{"type": "state", "recording": true, "paused": false, "meetingId": "mt_…", "mediaMs": 123456,
 "pendingChunks": 2, "pausedMs": 0, "phase": "recording", "pauseTimeoutMs": 1800000}
```

- `level`: ~5 per second while capturing (not while paused). `me` = peak of the last 200 ms, 0…1.
- `state`: once a second while a session is open, plus on every change (start/pause/resume/stop, chunk acked,
  stop sent, prune).
- State fields (also the `status` object in replies):
  - `recording` — a session is open (true while paused too).
  - `paused` — mic released, countdown running.
  - `meetingId` — live meeting, else the last meeting this phone recorded (or `null`).
  - `mediaMs` — recorded audio so far (media time; excludes paused time).
  - `pendingChunks` — chunk files written but not yet acknowledged by the server.
  - `pausedMs` — how long the current pause has lasted (0 when not paused).
  - `phase` *(extra)* — `idle` | `recording` | `paused` | `finishing` (stopped, uploads/stop outstanding) | `done`.
  - `pauseTimeoutMs` *(extra)* — the auto-stop limit (30 min in release).

A page reload or a new frame reattaches by sending `status`.

### Suggested shim (`window.wizardNative.meetings`)

```js
const port = window.wizardMizelPort;
if (port) {
  let n = 0; const wait = new Map(), lv = new Set(), st = new Set();
  port.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'level') lv.forEach((f) => f(m.me));
    else if (m.type === 'state') st.forEach((f) => f(m));
    else if (wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); }
  };
  const call = (cmd, meetingId) => new Promise((res) => {
    const id = 'm' + (++n); wait.set(id, res);
    port.postMessage(JSON.stringify(meetingId ? { id, cmd, meetingId } : { id, cmd }));
  });
  window.wizardNative = Object.assign(window.wizardNative || {}, { meetings: {
    start: ({ meetingId }) => call('start', meetingId), pause: () => call('pause'), resume: () => call('resume'),
    stop: () => call('stop'), status: () => call('status'),
    onLevel: (cb) => (lv.add(cb), () => lv.delete(cb)), onState: (cb) => (st.add(cb), () => st.delete(cb)),
  } });
  call('status'); // registers this frame for pushes
}
```

## Server contract used by native

Base: `https://<machine>.<tailnet>.ts.net` (release; debug `.qa` builds may be pointed at a fake by `files/qa_origin.txt`).

| call | when |
| --- | --- |
| `POST /meetings/api/meetings/{id}/chunks?source=me&seq=N&start_ms=T`, body = WAV, `Content-Type: audio/wav` | every finished chunk, in seq order; 2xx = acknowledged |
| `POST /meetings/api/meetings/{id}/stop`, `Content-Type: application/json`, body `{"final_seq":{"me":N},"reason":"user"\|"pause_timeout"\|"process_death"}` | once every chunk ≤ N is acknowledged |
| `GET /meetings/api/meetings/{id}` → `status` | after the stop, for local-file pruning only |

- Headers: `Origin: https://<machine>.<tailnet>.ts.net`, `Accept: application/json` — no cookie or token. This is
  exactly the mechanism `EverywhereOutbox` uses for the same private origin (Tailscale-only reachability is the
  access control; the meetings service checks `Origin` on writes).
- `final_seq.me` is `-1` if nothing was recorded.
- Retry: network errors, 401/403/408/425/429/5xx → backoff 2 s, 5 s, 15 s, 30 s, 1 min, then every 2 min,
  forever; reset immediately when Android reports a network. 400/404/405/409/410/413/415/422 on a chunk → that
  chunk is dropped from the queue (logged) so the stop can go out; on the stop → treated as done.
- The current meetings server's `/stop` ignores the body; `final_seq`/`reason` are sent for the server to adopt.

## Recorder behaviour

- **Capture:** `AudioRecord` 16 kHz mono PCM16, source `VOICE_RECOGNITION` (falls back to `MIC`). Foreground
  service type `microphone`, partial wake lock while capturing.
- **Chunks:** 5 s (80 000 samples) each, `filesDir/mizel/<meetingId>/me/<seq 6 digits>.wav`, written to
  `.wav.tmp`, header fixed, fsync, rename. Pause/stop flushes a shorter last chunk.
- **Journal:** `filesDir/mizel/<meetingId>/journal.json` (atomic temp+fsync+rename) holds `meetingId`,
  `nextSeq`, `mediaSamples`/`mediaMs`, `recording`, `paused`, `pausedAt`, pending chunks (seq, start_ms,
  attempts, next retry), stop request (`stopReason`, `finalSeq`, `stopSent`), `readyAt`. seq always comes from
  the journal. `start_ms` = media time at the chunk's first sample.
- **Pause:** stops and releases `AudioRecord` (mic indicator off), notification shows "Meeting paused · m:ss
  recorded / Microphone off. Ends by itself in mm:ss" with a countdown chronometer and Resume/Stop. After 30 min
  paused the meeting stops with reason `pause_timeout`. Resume re-acquires the mic; media time continues.
- **Stop:** queues the stop in the journal, releases the mic, keeps the service in front (notification
  "Saving meeting · Uploading N pieces") while uploads progress; if they stall for 90 s it hands over to a
  JobScheduler job (network-constrained, persisted) and the stop goes out after drain.
- **Process death:** on service restart (START_STICKY), app open, boot/upgrade or the upload job, any journal
  still marked `recording` is closed: complete-but-unjournalled files and the torn `.tmp` (header repaired) are
  adopted in seq order, the stop is queued with `process_death`, and the notification "Recording ended
  unexpectedly at HH:MM" is posted. The microphone is never reopened (Android 14+ forbids background mic starts).
- **One mic owner:** `MicOwner` (in-process lock). A meeting start while the Everywhere orb or the side button
  is listening → `mic_busy` + toast; an orb/side-button start while a meeting records (not paused) → refused
  with a toast ("A meeting is recording. Pause or stop it first."). Paused meetings do not hold the mic.
- **Notification:** tap → Wizard OS opens `https://<machine>.<tailnet>.ts.net/mizel-live/#/m/<meetingId>` inside its
  WebView (`/mizel-live/` is now an in-app private path, also as a VIEW link). Actions Pause/Resume/Stop.
- **Local files:** kept after acknowledgement until the meeting reports `status: "ready"` (or 404) plus one day,
  then deleted (checked by the uploader while alive and at every service/app start).

## QA hooks (debug `.qa` builds only; release ignores them)

- `files/qa_origin.txt` — `http://10.0.2.2:<port>` fake server.
- `files/qa_mizel.json` — `{"pauseTimeoutMs", "drainGraceMs", "statusEveryMs", "keepAfterReadyMs", "fakeMic",
  "staticNotification"}`; `fakeMic` 1 = synthetic 440 Hz tone only if `AudioRecord` cannot open, 2 = always
  synthetic; `staticNotification` 1 = no ticking chronometer (uiautomator cannot dump a shade that never idles;
  the text refreshes every 5 s instead).

## Verification (Thales, 2026-10-09)

- Builds (`android-build-thales`, source `a8e369c`): debug `.qa` `f9efaa9e…c6c639` (unit 59/59 in 11 suites, lint
  clean); signed release `ai.wizards.os` 0.7.0 (11) `ef6b327d…f4bb73c`, signer `3bf74d0b…ed1fd`.
- `tools/qa_mizel.py` (fresh API 35 emulator, fake meetings server via `qa_origin.txt`, real `AudioRecord`):
  82/82 — long 17, pause 17, death 18, bridge 11, owner 10, back 5, link 2, setup 2. The long run is ~243 s of
  media (50 contiguous chunks) with screen off + doze from t+25 s and airplane mode t+125–165 s.
- `tools/qa_everywhere.py` on the same APK: 65/65 (no regression).
- Not run: a > 30-minute recording; a real phone; James's real meetings server (fake only).
