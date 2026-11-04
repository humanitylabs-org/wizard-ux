# Single OS-window New chat: remaining reset repair

## Diagnosis and scope

The supplied 1190×1890 image does not establish CSS viewport or device-pixel ratio. Test both provisional interpretations: CSS 1190/DPR1 and CSS 595/DPR2, each with one app filling one OS/browser window. Heights are synthetic (1890/945); browser chrome prevents claiming exact web content height. The title `Archimedes Main Agent` does not establish a separate agent window or saved Focus. Actual registry launcher and supported saved main-agent Focus are separate fixture entries.

Unmodified source `37ed1d2bcb021e6b6ad890c4c4eb99833319fbf8` guards new sends only when the workspace has multiple tiles or `.dchats` width is ≤620px. At a single-window 1190px layout, its real submit capture schedules `toNewChat` after 180ms, undoing shared Chats' list return. Composer-mic handoff uses the same restrictive helper. The source-bound Node regression reproduces `__new__` after draining those actual branches at 1190px; 595px already passes. This is branch evidence, not executed browser evidence.

## Repair

Reuse:
- navigation: REUSE shared Chats `leaveAfterSend`, draft recovery and pane sync.
- desktop adapter: EXTEND `keepNewSendList` to follow the pinned `sid === '__new__'`, independent of guessed OS tiling/viewport.
- send custody: REUSE existing model/provider sealing and native recorder/outbox.
- tests: EXTEND `qa-thread-trail.cjs` and `tests/desktop-tiled-new-send.test.mjs`.
- NEW: none.

Only production change: simplify the existing new-send helper. Both typed and mic callers already use it. Existing-thread desktop fresh-draft shortcuts remain; phone shared leave/Back remains. Preserving a wide desktop *new*-send reset was an earlier agent-invented constraint, not an owner requirement. No OS split-screen heuristic or extra geometry query is added.

## Harness correction and parent packet

Launcher selection reads `WizCore.apps('desktop').APP.wizard.name`, then matches its exact `.nm` inside the real palette button and performs an ordinary click. Do not assume titlebar text or concatenate label/subtitle. Persist registry name, count, every palette tile and a failure screenshot if unique binding fails. Saved Focus uses the source-supported stored shape, then the same visible launcher route.

`QA_SEND_RETURN=1 QA_SCREENSHOT_NEW=1` runs 14 bounded cases: eight width × skin × typed/native-mic launcher new sends; two saved-Focus new sends; two existing-thread desktop typed/native-mic replies; phone new and existing typed sends. Native audio is actual Chromium fake-device MediaRecorder output (not substituted bytes), requires ≥1200 bytes, and retains original capture identity through exactly one STT/upload/run/ACK. All content/routes/models are synthetic; no owner history, private agents, real model runs or real transcription. Confirm real Nebula/Grove skin state and inspect in-shell screenshots; no styles change.

`QA_SCREENSHOT_RED=1` selects only the first real-launcher 1190px typed case for the unmodified-source browser canary. Baseline must fail only the held/post-ACK navigation checks with exact single-window/source/run preconditions, never a boot/selector/model/custody exception. Preserve its failed journal. Only after valid SOURCE_RED may the runner admit the candidate matrix. A baseline exception is FIXTURE_OR_OTHER_FAILURE, not evidence of the bug.

The parent stages one complete tracked candidate archive plus the exact baseline desktop asset; all other web assets must hash identically to the pinned baseline. The runner constructs an isolated baseline copy, verifies its complete web closure, runs red then green sequentially, retains screenshots/assertion journals, and terminates the owned process group on timeout. No HTTP server is required; static and synthetic API requests are intercepted under wizard.test. No browser run, heavy submission, merge or deployment is authorized to this child.

## Executed checks

- Candidate Node branch tests: 27 pass / 0 fail.
- Same tests against hash-verified unmodified desktop source: 18 pass / 9 fail. Failures are the newly corrected 1190/1920/fullscreen new-send policy, including 1190 typed/native handoff with main/saved Focus; all existing-thread cases and 595px cases pass.
- `node --check qa-thread-trail.cjs` passes.
- Browser red/green and visual review remain parent-owned and unexecuted by this worker. Do not claim this packet is browser-green or deploy it before admission.
