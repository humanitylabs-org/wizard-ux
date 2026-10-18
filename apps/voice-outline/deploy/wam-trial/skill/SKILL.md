---
name: outline-streaming-demo
description: Use when operating the isolated Outline shared-voice trial.
---

# Outline shared voice trial

Open `/wizard-os-home/?open=outline-streaming-demo`, not a raw URL in an unregistered
link window. Shared capture ownership must be `outline-streaming-demo`.

This private connection package proxies a separately managed web runtime. The
owner now explicitly selects shared Wizard voice, not the original local engine.
Default live speech uses WizardApp.capture ownership and the installed Mizel
TinfoilProvider.openRealtime implementation through Wizard's existing attestation
proxy. Model is `voxtral-mini-4b-realtime`; no provider/model fallback is allowed.
Keep the Nemotron adapter code only as an explicitly selected local option.

Use App Manager's normal start, stop and uninstall operations for the connection.
Check `/healthz`: `liveReady` true, provider `wizard-shared-tinfoil`, fallback null.
The trial launcher uses `OUTLINE_PROVIDER=wizard-shared`, runtime references to
the existing provider module/credential, and an SSH loopback reverse tunnel to the
existing Tinfoil proxy. Do not copy credentials into source. Read the deployed
runtime config and systemd override before operating; never alter `voice-outline`.
An unavailable upstream/model must fail visibly and keep original audio.
Stopping/uninstalling the connection preserves upstream notes/audio and leaves the
separate runtime services running. The owner deployment receipt names those services
and paths; stop them explicitly only when authorized. Do not delete owner data.

Voice stays in this app; never create a meeting or send test speech to an agent.
Read original audio bytes/hashes back before acknowledging shared capture custody.
