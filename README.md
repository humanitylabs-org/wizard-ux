# Wizard UX

**Wizard UX** (also called **Wizard Mobile** or **the Wizard app**) is the phone-first front end of Wizard OS. It's the screen you live in: the orb in the nav bar, the desks, the launcher, the inbox shade, and your chats with your Wizard.

It is the active Wizard front end. The older React client in [`wizard-mobile`](https://github.com/humanitylabs-org/wizard-mobile) is now **legacy Wizard Mobile**. It's kept as a reference while its features are ported here.

## Portable development and QA

```sh
npm test
npm install --no-save playwright  # or playwright-core + an installed browser
# Browser installation/extended QA belongs on the configured build worker.
node tools/qa-origin.cjs         # local /wizard-os-home/ on port 9371
# In another terminal:
WIZARD_ORIGIN=http://127.0.0.1:9371 node qa-brand.cjs
# Standalone prototype (served at / rather than /wizard-os-home/):
python3 server.py                # http://127.0.0.1:9271/
node qa.cjs http://127.0.0.1:9271/
```

- `WIZARD_ORIGIN`: QA defaults to `http://127.0.0.1:9371` (the local QA origin). Live QA selects an owner's origin explicitly, e.g. `https://wizard.example.ts.net`. Preview suites retain their existing required `QA_ORIGIN` admission; this variable does not bypass isolation. `server.py` keeps localhost origins and reads additional allowed POST origins from comma-separated `WIZARD_ORIGIN`; configure it in the launching service **before adopting this change**. QA expects one origin, not a comma-separated list.
- `QA_PLAYWRIGHT`: optional installed module name or absolute module path. The shared resolver otherwise tries `playwright`, then `playwright-core`. Legacy `PLAYWRIGHT_PATH`, `PW`, `PW_MODULE`, `PLAYWRIGHT_MODULE`, `PLAYWRIGHT_DIR`, and `QA_PW` remain aliases. A broken explicit override fails clearly. `QA_CHROME` selects a browser executable for suites/loaders that support it.
- `WIZARD_WORK_ROOT`: work/evidence storage; defaults to `${TMPDIR:-/tmp}/wizard-work` and is created on use. Worker-only suites require an explicit root, preserve their macOS/lease fences, and reject output outside it. Set this to the worker's large work volume; do not move heavy work onto a small control-plane disk.
- `WIZARD_BUILD_HOST`: SSH worker host; no default. Remote orchestration requires it. Set `WIZARD_WORK_ROOT` to the **remote** work volume for those commands.
- `HERMES_HOME`: defaults to `~/.hermes`; controls owner state and prototype API-key lookup. Other checkouts are derived from this repository's parent, not a named user's home. `QA_HELPER_STATUS_MODULE` is the absolute path to the Agent Service helper-status module when using `tools/helper-preview-origin.cjs`'s helper endpoint.
- Device QA uses standard `ANDROID_HOME` / `ANDROID_SDK_ROOT` and `JAVA_HOME`; install the SDK and suite-appropriate JDK on the worker and put `node`, `python3`, and CLI helpers on `PATH`. Snapshot-based QA must include `tools/qa-playwright.cjs`, `tools/qa-paths.cjs`, and (for Python) `tools/qa_paths.py` alongside the suite.

The normal `npm test` command includes a tracked-file portability guard. Only explicit evidence/receipt paths are exempt. Native `android/` and `ios/` are temporarily excluded pending the separate `fix/portable-app-origin` migration.

## Where it sits in Wizard OS

**Wizard OS** is the whole system: the agent, the services, the apps and the UX. Wizard UX is one View in it.

```
┌────────────────────────────── Wizard OS ──────────────────────────────┐
│                                                                       │
│  Wizard UX  (this repo)                                               │
│   web shell: orb · desks · launcher · inbox · chats · reviews         │
│   Android shell ai.wizards.os: WebView, Back, side-button assistant   │
│        │                         │                                    │
│        │ /wizard/...             │ /wizard-os-home/api/...            │
│        ▼                         ▼                                    │
│  Wizard Agent Service        server.py (this repo, small)             │
│   threads, runs, steers,      voice → text, orb command routing       │
│   approvals, files, read                                              │
│   state, voice recovery                                               │
│        │                                                              │
│        ▼                                                              │
│  Hermes Agent  (the agent: sessions, tools, memory, models)           │
│                                                                       │
│  Apps  (CineQueue, Signal, Reader, Mizel, …) open as desks            │
└───────────────────────────────────────────────────────────────────────┘
```

| Component | Repo | Role |
|---|---|---|
| **Wizard UX** | `humanitylabs-org/wizard-ux` (this repo) | The front end: web shell and Android app |
| **Wizard Agent Service** | currently `server/` in `humanitylabs-org/wizard-mobile`; moving to its own `wizard-agent-service` repo | The back end Wizard UX talks to. It sits in front of Hermes and owns threads, runs, steers, approvals, files, read state and voice recovery |
| **Hermes Agent** | `humanitylabs-org/hermes-agent` (fork of NousResearch) | The agent itself |
| **Legacy Wizard Mobile** | `humanitylabs-org/wizard-mobile` | The previous React client. A porting reference that will be retired once its features are ported |
| **Wizard OS installer** | `humanitylabs-org/wizardos` | Installs Hermes plus the supporting stack on a host |
| **Wizard for Mac** | `humanitylabs-org/try-wizard` | Mac app that runs Wizard OS in a VM and shows the Wizard UX in a window |

Wizard UX holds no agent state of its own. Threads, runs and files live in Hermes and the Wizard Agent Service, so the same threads show up on every device and in legacy Wizard Mobile.

## What's in this repo

One codebase, two shells. Shared code lives in `web/core/` (plus `live.js` and `outbox.js`). Each shell has its own entry page and loads only its own code, so the phone never downloads the desktop shell and the desktop never downloads the orb. `core/shell.js` picks the shell by **device, not window width**: a touch phone or the Android app gets the phone shell; anything with a mouse or trackpad, or Wizard for Mac, gets the desktop shell. Override per device with `?shell=phone`, `?shell=desktop`, or `?shell=auto`.

```
web/            The Wizard UX itself (plain JS, no build step)
  core/           SHARED by both shells
    shell.js        picks phone or desktop before anything else loads
    core.js         helpers (escape, relative time, per-shell storage)
    apps.js         the app registry and app search (each shell asks for its own list)
    chats.js/.css   Chats: thread list, thread view, composer, attachments, voice notes, unsent bubbles
    chat-kit.js     Chats basics: message parsing (photos, <helm_attachments>), full Markdown, media viewer, copy/share, drafts, times
    voice.js        mic capture + transcription for shells without their own voice UI
    bridge.js       native bridge v0: wizard:orb / open / dictation / back events (spec: wizard-os/spec/NATIVE_BRIDGE.md)
    base.css        colour tokens, resets, shared keyframes
  live.js         SHARED: live Wizard data (threads, read state, sends)
  outbox.js       SHARED: durable outbox (saved before send, retried)
  index.html      PHONE shell entry
  app.js          phone: desks, launcher, inbox shade, zoomable reviews, Back stack
  orb.js          phone: the orb (listen, transcribe, route)
  styles.css      phone: orb, desks, sheets
  live-mode.js    phone: Live Mode (hands-free conversation; demo only for now)
  motion/         phone: Wizard Motion Kit (shared animations, also used by Android)
  desktop.html    DESKTOP shell entry
  desktop/        desktop: Omarchy-style workspaces, auto-tiling windows, ⌘K palette, keys, voice key, inbox drawer
  pwa-install.js  per-app PWA install banners
  sw.js, manifest.webmanifest
server.py       Small loopback server: serves web/, plus two endpoints
                  POST /api/transcribe  voice → text (Wizard voice service)
                  POST /api/route       classify an utterance: phone command vs message to the Wizard
android/        Android app ai.wizards.os
                  MainActivity  WebView around the Wizard UX, hardware Back routed into the shell
                  Handoff       intents ai.wizards.os.action.LISTEN / .SAY
                  SideButton    one-tap side-button setup
                  assist/       hold-the-side-button assistant (lock screen + corner orb)
tools/          Thales QA helpers
qa-*.cjs        Playwright and Android QA suites
BRANCHES.md     Feature branch map, verification evidence, build history
```

## Branches

- `daily` is what James runs on his phone. It is the default branch and merges every feature branch.
- `master` is the web shell baseline that feature branches start from.
- `feature/*` and `fix/*`: one feature per branch, each reviewable on its own. See [BRANCHES.md](BRANCHES.md) for what each one adds and how it was verified.

## Running it

```bash
WIZARD_OS_HOME_PORT=9271 python3 server.py
# open http://127.0.0.1:9271/
```

On its own, the shell runs with empty data. For live use it's served under one origin next to the Wizard Agent Service:

- `/wizard-os-home/` → `server.py` (port 9271)
- `/wizard/` → Wizard Agent Service (Chats calls `/wizard/hermes/...`, `/wizard/files/...`, `/wizard/thread-seen`, `/wizard/thread-dispositions`)

Both sit behind the private gateway on Tailscale (`https://wizard.example.ts.net/wizard-os-home/`).

`server.py` reads these environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `WIZARD_OS_HOME_PORT` | `9271` | Listen port (loopback only) |
| `WIZARD_STT_URL` | `http://127.0.0.1:8864/v1/audio/transcriptions` | Voice-to-text endpoint |
| `TINFOIL_PROXY_URL` | `http://127.0.0.1:3301/v1/chat/completions` | LLM used by the orb's command router |
| `WIZARD_OS_ROUTER_MODEL` | `deepseek-v4-1-flash` | Router model |
| `TINFOIL_API_KEY` | read from `~/.hermes/.env` | Key for the router |

### Private review data

The Day, Week and Month reviews read `web/data.js` and `web/summaries.js`. Both are generated from the owner's own Hermes session database by a private extractor that lives outside this repo. They contain real thread titles and message snippets, so they are **gitignored and must never be committed**.

## Android

Package `ai.wizards.os`, currently 0.4.0. Builds run on Thales (the Mac mini build host) through `android-build-thales`. They're signed with the Wizard OS key, so every version installs over the previous one. The signing secrets come from the environment (`WOS_STORE_PASSWORD`, `WOS_KEY_PASSWORD`) and are never stored in the repo. The `qa` build type adds the `.qa` suffix, so QA builds install alongside the real app.

## Rules

- **Back never exits.** Back closes the top overlay, then leaves the nested view, then returns to Home. At Home it shows "Press back again to exit", and only a second Back may leave. Every Back change ships with a test.
- **QA never writes to the live Wizard.** The suites intercept writes to Hermes and the Wizard Agent Service, and check for zero `/v1/runs`.
- **Nothing is sent on the user's behalf.** Words handed in from the side button or another app land as a draft, and the user sends them with one tap.
- **No secrets or private data in git.** Keys stay in the environment. Generated review data stays local.

## Testing

```bash
node qa-os.cjs            # shell: Back, desks, windows, voice routing
node qa-chats-parity.cjs  # Chats against the live Wizard Agent Service (writes intercepted)
node qa-new-chat-first-paint.cjs "$QA_ORIGIN/wizard-os-home/" # empty composer, resize/reload, phone Back
node qa-live.cjs; node qa-livemode.cjs; node qa-motion.cjs; node qa-recordings.cjs
node qa-android-*.cjs     # on Thales, against the emulator
```

The current pass counts per suite are in [BRANCHES.md](BRANCHES.md).

Composer layout changes must run `qa-new-chat-first-paint.cjs` before and after deployment.
It checks the actual New chat action synchronously before the first animation frame, then
before and after typing, at four desktop sizes, in browser/native-like modes, plus phone smoke checks.
Set `QA_PLAYWRIGHT` and `QA_CHROME` for the worker's installed tools; `QA_WEB=<candidate>/web`
overlays candidate assets for the before/after comparison. Omit `QA_WEB` for final live acceptance.
`QA_OUT` contains screenshots and a JSON receipt with served source hashes. All writes are intercepted;
unrelated embedded apps are explicitly omitted. Native-like checks inject bridge presence only.
