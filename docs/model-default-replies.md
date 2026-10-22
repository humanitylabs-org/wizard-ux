# Telegram-origin reply model metadata hotfix

James: the top-right model is displayed, but a native voice reply says “Recording saved · choose a model before sending”; default should route to the model shown without another picker action.

Bounded functional hotfix; shared phone/desktop model helper + existing chip. No Hermes core, backend, native binary, design or transport changes. Base e7a4ec7 (daily).

Acceptance:
- Telegram model-only session resolves configured default's provider synchronously before native Send.
- Existing missing-model session shows/sends configured default via one common currentRoute helper.
- Explicit model/provider and private routes retain identity; ambiguous non-default model-only routes stay unresolved.
- Pending picker saves still block; snapshots remain sealed through STT, replay/retry and default changes.
- Exercise native voice-send fixture against baseline/candidate on Thales, verify served bytes and tree identity on real tailnet origin after serialized promotion.

Observed live source: Telegram session 20261013_100017_25ba1216, model gpt-6.1-sol, provider absent. Existing qa-model-route-contract newly added Telegram case fails before source fix: empty provider != openai-codex.

Verification checkpoint (Thales thales.local / Node v22.23.2 / native bridge stand-in in actual Chrome):
- New native/browser reproducer: baseline 12 pass / 6 fail; exact “Recording saved · Choose a model before sending”, no STT/run. Candidate 18 pass / 0 fail; native Stop, transcription, one locked reply, durable take acknowledgement, Back/app retention.
- Model-route contracts 18/18, covering default, unique model-only completion, explicit private/ambiguous routes, pending saves, outage, retry, active runs, acknowledgement, cross-device authority and recovery.
- Existing microphone lifecycle regression 25/25.
- qa-chat-power not exercised: legacy hard-coded Telos Playwright module path unavailable on Thales; focused chip/send tests above exercised instead. These fixtures prove UI/admission payload, not real inference or physical phone behavior.
## Release checkpoint

Initial fix f8c75f6 deployed under Wizard UX release lock; live web tree39c370ff1f422689282a86b1f714f81450ef1a15 verified through :8923 and Thales real tailnet origin. Real served helper bytes and catalogue + executed phone native voice-send/desktop composer voice-send pass10/10 (STT/inference mocked; no real agent admission). Test harness was corrected to open a thread before waiting for lazy catalogue load, use each shell's actual controls, and bypass static-asset GET only; an initial harness mistake let invalid synthetic STT bytes reach the old shell-local route and return502. Final harness fences writes and explicitly intercepts that transcription path.

Older retained-take last mile: voiceRoute now completes saved model-only provider via currentRoute without changing its saved model. Thales extended native fresh/recovery browser candidate20/0 vs original12/8; contracts19/19. Narrow independent review APPROVED at hash81263a813be094ed27827c4bfbf164c5302862fa242f8cd89645c7378a3a5ffc, including ambiguous/unknown/private/corrupt-storage probes. Final product e08202f deployed under serialized lock; live web treef250a3c33682e73d271adcb2b9fe6f7824a89d5e. Thales real tailnet fresh phone voice + older take recovery + desktop composer voice12/12; served helper hashes match exact candidate and :8923, default gpt-6.1-sol/openai-codex. No native/APK/Hermes/backend changes. Physical handset/inference not exercised; synthetic browser admission/STT stand-ins identified above. Release evidence: $HERMES_HOME/data/releases/model-default-replies/receipt.json.

- Independent read-only review APPROVED: riskiest surface is nativeFinish's synchronous route validation; explicit/private preservation, ambiguous fail-closed state and chip/send agreement pass. Reviewed helper hashes chat-models.js 653abe5d0b1809639ab511570f23d09124ff9e40b89446f066b24c339da3a485; chat-power.js c3e9e3a67135223a2f7fa7ecdebb7388def55071e15c490f64f17a97aaca6e0f. These hashes identify the approved initial product delta. The subsequent voiceRoute retained-take extension has its own narrow review gate.
