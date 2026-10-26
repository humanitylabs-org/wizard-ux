# Voice refactor acceptance follow-up

Reuse:
- background audio: EXTEND WizBackgroundAudio.duck and existing send; REUSE WizBackgroundAudioLegacy for pilot grant/native token.
- QA origin: REUSE opt-in read-only app proxy; EXTEND its test coverage for root-hosted and prefix-owning upstreams.
- voice dispatch: REUSE frozen WosMusic parser and transport; correct the browser assertion, not product text.
- NEW: none.
Visual: none (no UI changes).

## Failure causes and fixes

1. Main lacks live's short-sound ducking. The refactor removed it; the first live cherry-pick restored the algorithm but its VM fixture loaded only background-audio.js, not the new grant adapter, so no provider was selected. Preserve shell-owned serialized/refcounted ducking through generic send and a live registry grant. Keep the native pilot token only in background-audio-legacy.js. Port live's regression tests with unchanged observable assertions (0.25 → 0.8, only one initial volume message, session-one, wizard-music, v:1); load the adapter and a real location.href in the fixture. Also cover a non-Music registry-granted provider.
2. qa-origin correctly strips QA_READ_APP_PREFIX by default. Music server/index.mjs owns /wizard-music (rejects paths outside BASE); it needs QA_READ_APP_UPSTREAM_PREFIX=/wizard-music. Video Editor at :9592 is root-hosted and must retain the empty upstream prefix. Forum's runner exported Music's upstream prefix to every subprocess; the unit fixture overrode app prefix/port but not upstream prefix, unlike CI's clean environment. Explicitly set all three fixture variables, testing both empty and nonempty upstream prefixes without forwarding credentials or writes.
3. Both main and live parse plain play as said:String(text).trim(), retaining the trailing period. Only the finding toast strips terminal punctuation; it is not the wire payload. Fix real-Music browser assertion to preserve the period on both shells. Do not alter the branch parser.

## Live music-voice.js function-by-function mapping

All old functions remain in web/core/voice-legacy.js; web/core/app-voice.js routes to that adapter while adding app-owned claims.

| Live function/value | New location and preserved behavior |
|---|---|
| norm | voice-legacy.js norm: same normalization |
| MUSIC, MUSIC_WORD, FIND, SPELL, PLAIN_FIND | voice-legacy.js: same grammar/constants |
| asSaid (including words.map callback) | voice-legacy.js asSaid: same case-preserving capture |
| parse (including local c) | voice-legacy.js parse: same search precedence, weak/strong commands, playback/control/like/dislike/what, raw said and open-and-play |
| host, seq, pending | voice-legacy.js: same host and transport state |
| log | voice-legacy.js log: same bounded __musicLog |
| settle | voice-legacy.js settle: same once-only completion with exception isolation |
| post (including resend timer callback) | voice-legacy.js post: same frame message, 400 ms retry, 20 s timeout, toast/completion |
| send | voice-legacy.js send: same id, strong removal, pending record and post |
| message listener | voice-legacy.js: same ack/done settlement, timer cleanup, logs, escaped outcome toast; additionally rejects replies from a frame other than the pending receiver (intentional admission hardening) |
| run | voice-legacy.js run: same find/open, play/resume/search-only auto-open, unavailable toast, searching/finding toast and send |
| WosMusic.parse/run/install/available/pending | voice-legacy.js WosMusic: same exported functions and host/pending semantics |

WosVoiceLegacy.install supplies the same Music host from shared registry open/find/frame/toast functions. WosAppVoice.install delegates to it; WosAppVoice.parse/execute delegate Music grammar/run to WosVoiceLegacy. No inert music-voice.js shim is needed.
