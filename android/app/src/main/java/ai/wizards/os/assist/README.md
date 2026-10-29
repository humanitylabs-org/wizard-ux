# Side-button assistant (feature/side-button-assistant)

Hold the phone's side button to talk to the Wizard.

- **Locked phone:** a full-screen Wizard surface (`AssistLockActivity`, `showWhenLocked` + `turnScreenOn`) draws over the real keyguard. The PIN and fingerprint lock is never replaced. Unlocking mid-sentence hands the live recording to the corner orb.
- **Unlocked phone:** only a small orb in the bottom-right corner (`WizardSession`, Android's own assistant window, `TYPE_VOICE_INTERACTION`). Touches outside the orb reach the app underneath.
- **Send:** pause, tap the orb, or hold the side button again. Android never reports the side button's release to an app, so "let go to send" isn't possible.
- **Tap to open:** passes the words to Wizard OS as a draft through `ai.wizards.os.action.SAY` (from feature/assistant-handoff). James sends it with one tap, and nothing is sent automatically.

## How Android routes the button
Power long-press → `PhoneWindowManager` → the default **assistant** role holder. Because Wizard OS declares a `VoiceInteractionService` (`WizardVoiceService` + `res/xml/assist_voice.xml`), it gets the session window when unlocked. On the lock screen it starts `AssistLockActivity`. James sets it up once in Settings → Apps → Default apps → Digital assistant app → Wizard OS, and then Settings → System → Gestures → Press & hold power button → Digital assistant.

## Files (all additive; MainActivity untouched)
- `java/ai/wizards/os/assist/*`: activity, session, services, `VoiceCapture` (one mic engine shared by both surfaces), `Transcriber` (private Wizard voice endpoint), `SilenceDetector` (+ unit test)
- `assets/assist/`: surface page plus a copy of Wizard Motion Kit v1
- `res/xml/assist_voice.xml`, `assist_recognition.xml`; manifest block marked "Side-button assistant"; `Theme.WizardOS.AssistSurface`

## Verified
Thales Android 15 device QA, 30/30, using a real PIN keyguard, real power-key long-press and real transcription. Coverage: locked full surface, Back, unlock mid-talk → corner, unlocked corner orb small and bottom-right, taps pass through, heard bubble, no crashes. Origin: standalone test app `~/apps/wizard-lock` (branch `feat/side-button-corner-orb`).
