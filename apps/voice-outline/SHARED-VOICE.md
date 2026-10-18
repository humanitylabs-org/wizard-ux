# Shared voice trial repair

Scope: only the separately installed `outline-streaming-demo`; preserve its database,
recovery key and capture owner. Do not deploy this release to `voice-outline`.

The local launcher forced `OUTLINE_PROVIDER=local-nemotron`. Shared microphone
ownership already used WizardApp.capture, but ASR bypassed the daily shared
Tinfoil implementation. The app used explicit non-meeting PCM, which selects the
shell browser AudioWorklet on AAC-only Android DeviceBridge installations. Mizel's
native meeting adapter is meeting-specific and must not be started with a fake
meeting ID. Desktop success does not prove handset microphone permission or PCM.

This repair selects `wizard-shared` in the trial launcher, imports the installed
Mizel TinfoilProvider and calls its openRealtime API. OutlineSharedRealtime only
adapts target lifecycle; it contains no ASR/provider wire protocol. The shared
provider uses Wizard's existing loopback Tinfoil attestation proxy over an SSH
reverse tunnel and voxtral-mini-4b-realtime, with no fallback. The OpenAI SDK is
only the existing provider's WebSocket transport; no OpenAI endpoint is used.
Direct tinfoil-js connections on Thales produced TLS bad-record/illegal-parameter
errors during acceptance, so they are not the deployed route.
The Nemotron implementation remains available explicitly as local-nemotron.

Keep the reverse tunnel on the same loopback port as the attestation proxy;
otherwise its Host validation returns HTTP 400. Runtime config supplies
shared_proxy_url, shared_provider_module and shared_provider_env. The
existing installed module has SHA256
16d6dbcecef7f4440e14e86e630acd684a49369b6e202b45628ef96be2b4732b,
identical to meeting-recorder commit 79b34c2e95d4d1cfdefdddad73efc160fd2ad842,
adoptions/mizel-live/provider.js (https://github.com/humanitylabs-org/meeting-recorder).
No key is copied to source. Its existing SDK/dependency lock is reused.

Acceptance: real installed Wizard shell, phone viewport, actual shared provider
live delta before Stop, targeted final, retained original WAV hash readback,
shared microphone released, nested/root Back stay in app. Android DeviceBridge
selection seam is not physical-handset proof. Baseline browser diagnosis succeeded;
the owner's exact phone-only failure is not established without handset evidence.
