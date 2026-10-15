---
wizard: 0.2
id: voice-outline
name: Outline
type: service
category: app
version: 0.1.0
summary: A voice-first nested outline with continuous verbatim dictation and durable recovery.
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
  source:
    path: web
    build: npm run check
    dist: web
provides: [outlining, live-dictation]
system: false
uses: []
needs: []
health: /healthz
---

# Outline

Private candidate. Single owner document API, revision-checked durable SQLite writes, MCP over the same service functions, and an editable vanilla view. Live uses the existing configured attested Tinfoil provider, never a meeting route. See README.md for integration and QA boundaries.
