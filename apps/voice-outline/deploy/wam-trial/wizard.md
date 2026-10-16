---
wizard: 0.2
id: outline-streaming-demo
name: Outline (voice trial)
type: service
category: app
version: 0.1.1
summary: Isolated local Nemotron voice trial, using Wizard shared capture and a managed private runtime connection.
license: GPL-3.0-only
source: https://github.com/humanitylabs-org/wizard-ux
runtime:
  kind: runtipi
  config: runtipi/config.json
  compose: runtipi/docker-compose.yml
api:
  port: 8799
  path: /api
  spec: openapi.json
mcp:
  path: /mcp
  port: 8799
  transport: streamable-http
skill: skill/SKILL.md
view:
  path: /
  port: 8799
provides: [local-voice-trial]
system: false
uses: []
needs: [mic]
health: /healthz
---

# Outline (voice trial)

Owner-private connection package for the existing Outline local-streaming runtime.
The implementation is in `apps/voice-outline` at the same source revision.
This is not a standalone redistributable inference appliance. The owner provisions
and supervises the private upstream separately. No cloud credentials or fallback.

WAM owns the connection container and its start/stop/uninstall lifecycle. Stopping
or uninstalling this package disconnects the trial; it does NOT stop the separately
managed Mac web/inference services or delete their notes/recordings. `/healthz`
reports upstream and model readiness, not just the connection process.

The upstream URL must refer to the owner's private trusted runtime, never a public
inference endpoint. This host uses an explicit owner-local networking override to
reach its existing loopback SSH tunnel. The distributed recipe remains isolated.

Open `/wizard-os-home/?open=outline-streaming-demo` inside Wizard. Raw unregistered
frames cannot use shared capture. Existing Outline and daily voice are untouched.
