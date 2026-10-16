---
name: outline-streaming-demo
description: Use when operating the isolated local Outline voice trial.
---

# Outline local voice trial

Open `/wizard-os-home/?open=outline-streaming-demo`, not a raw URL in an unregistered
link window. Shared capture ownership must be `outline-streaming-demo`.

This private connection package proxies the separately managed web and Nemotron
runtime. Its API, MCP and data semantics are those of `apps/voice-outline` at the
package's exact source revision. No Tinfoil credentials are required or used.

Use App Manager's normal start, stop and uninstall operations for the connection.
Check `/healthz`: `liveReady` must be true, provider `local-sherpa-cpu`, fallback null.
An unavailable upstream/model must fail visibly; never switch to daily provider.
Stopping/uninstalling the connection preserves upstream notes/audio and leaves the
separate runtime services running. The owner deployment receipt names those services
and paths; stop them explicitly only when authorized. Do not delete owner data.

Voice stays in this app; never create a meeting or send test speech to an agent.
Read original audio bytes/hashes back before acknowledging shared capture custody.
