# Floating orb, side button and composer mic during a Mizel meeting

James, 18 Oct 2026: "I need to be able to use voice to text when Mizel is recording … Mizel will pause while I
use the blue orb … it could be noted that I did that there and what was said. The mic needs to be passed over to
the blue orb for speech-to-text and then passed back."

## Why it did not work before 0.9.24

The 15–16 Oct handoff (wizard-ux #71, meeting-recorder #5–#7) taught only the **in-app** orb to borrow the meeting
microphone (`web/core/orb-handoff.js` → `DeviceBridge.recHandoff*` → `MeetingRecorderService.beginBorrow/endBorrow`).
The native floating **Everywhere** orb (`EverywhereService.start`) and the side button (`VoiceCapture.start`) still
called `MicOwner.tryAcquire` and, with `MEETING` holding the mic, refused with "A meeting is recording. Pause or stop
it first." The composer mic (`recordReply`) refused with "Microphone held by another app".

## Contract (0.9.24 / 48)

- One physical owner. `MicLoan.acquire` asks the live meeting to lend (`beginBorrow`: capture joined, partial chunk
  flushed, AudioRecord released, receipt persisted), then `MicOwner` moves `MEETING → EVERYWHERE|SIDE` and the take
  is bound (`bindBorrow`). Refused loans change nothing and say why.
- Hand-back happens when the take's file is in the outbox (custody), never after transcription, network or a reply.
  Cancel, empty take, start/save failure, mic loss and service destruction return it too (`MicLoan.release` is
  idempotent). `endBorrow` resumes only a meeting the loan paused: a manual Pause before or during the loan wins; a
  meeting stopped during the loan is never restarted.
- Dictated/asked audio is never in the meeting recording: the meeting is paused for the whole take, and its media
  clock is frozen, so the pre-loan partial chunk ends exactly at the marker's `atMediaMs`.
- The composer mic during a meeting goes through the in-app orb's existing `WosOrbHandoff` loan (`startVoice`).

## Markers (one store)

The native receipt in `meeting-handoffs-v1` (already written by `beginBorrow/endBorrow`) carries the transcript
notes for native borrowers: `source` (everywhere/side), `kind` (dictation/ask), `target` app label, `text`,
`event` status, thread/run/delivery identities and a revision `rev`. `MeetingEventSync` PUTs each unacknowledged
revision to the existing `/mizel-live/orb-events` projection, reads it back, and only then records `acked`; it
retries with backoff and on app open / orb start. In-app orb receipts (no `source`) stay with the shell journal, so
nothing is posted twice.

Live Mizel renders these with its existing card (no server change; `meeting-recorder` was archived 18 Oct):

- voice typing → **On-device operation** · "Voice typing into Messages · see you at five" (`status: local`)
- ask → **Asked Archimedes** · the words · Continue in Wizard (`status: sent`, then `answered` by the server's
  delivery-verified refresh)
- cancel → **Cancelled orb interruption**

## Tests

- `MicLoanTest` (MicOwner transfer, manual pause, pause during loan, stop during loan, idempotent release, refusals)
- `MeetingEventProjectionTest` (receipt → orb-event body, read-back identity/revision, in-app rows skipped)
- `tests/composer-mic-meeting-loan.test.mjs`
- Emulator: `QA_EVERYWHERE_MEETING_ONLY=1 tools/qa_mizel.py APK ai.wizards.os.qa` runs
  `tools/qa_everywhere_meeting.py` (dictate into another app, ask, cancel, manual pause, stop during loan, side
  button, reverse refusal, every native receipt acknowledged).
