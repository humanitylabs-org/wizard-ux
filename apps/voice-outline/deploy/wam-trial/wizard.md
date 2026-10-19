---
wizard: 0.2
id: outline-streaming-demo
name: Outline
type: service
category: app
version: 0.2.0
summary: A minimal notes-style nested outline you can type into or dictate into, with durable recovery.
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
provides: [outlining, live-dictation]
system: false
uses: []
needs: [mic]
health: /healthz
---

# Outline

James's one Outline app: a minimal, Obsidian-like nested outline you can type or
dictate into through Wizard's shared microphone. The implementation is in
`apps/voice-outline` at the same source revision; this package connects Wizard to
the owner-supervised runtime on Thales. No cloud credentials or fallback in source.
