# Agents MVP — Lane B (UX)

Brief: `~/projects/wizard-os-integration/briefs/agents-mvp.md` (James, 14 Oct 2026). Lane A (spec, Agent Service, recordings) owns the API.

## What the UX does

- **Agents** is its own system app (`web/agents/`, app id `agents`). Home reaches it from the system area (phone: the people button beside *Your system*; desktop: the Home chip). System links to it from its header. It is not listed in Apps, the launcher grid, desktop app search defaults, or the App Store.
- **List**: sigil, name, harness, model provider · model, Private/Standard, status, Main agent.
- **New agent**: three steps, *Harness → Model provider → Permissions*. Permissions start from a preset (Private / Standard) and stay adjustable in the same step: outside tools, files, Wizard apps, agent apps (tools/connectors), other agents. Private needs a confidential provider; the UI says so and does not offer a downgrade.
- **Agent page**: edit any time — rename, start/stop, model (same provider only), outside tools (a private agent asks before turning one on), files, add/remove Wizard app, add/remove agent app, add tool or connector, other agents. The main agent is shown read-only (its permissions belong to the Wizard setup).
- **Per-agent Chats**: *Open chats* opens a Chats window pinned to that agent (`w.agent`). It lists only that agent's threads (`GET /wizard/hermes/api/sessions?agent=<id>`), starts new chats on it, and every thread/run call names it (`?agent=<id>`, plus `agent` in create/run bodies). A persistent strip names the agent on list and thread, phone and desktop: sigil, agent colour (also a coloured window edge), label, model, lock + *Private* for a private agent. The window title and desk label carry the agent's sigil and name. When more than one agent exists, the main Chats shows the main agent's strip too.
- **Model picker** in an agent's chats lists only `allowed_models` on the agent's provider; no "more models". Sends seal the agent's route (`{model, provider, agent}`); a model outside the list fails before sending.
- **Privacy in the client**: an agent's threads never enter the main list, Home cards, body search or the main thread-seen store (their read state is device-local, `wos.agentSeen.v1`). The orb's screen context names a private agent's window but never reads its titles. Voice in an agent's Chats goes to that agent (open thread, else a new chat), never to the main agent or the cloud router; held-orb commands still run on-device only.
- **Back**: agent page/sheet/flow step → previous screen (WizardApp back facade); agent Chats thread → list → the Agents app it was opened from → Home; at Home, Back stays (native "You're home"; browser tab: "Press back again" floor). Tested in `qa-agents.cjs`.
- Deep links: `?view=agents`, `?open=agents`, `?agent=<id>` (that agent's Chats).

## Fixture and preview

`tools/agents-fixture.mjs` implements the brief's contract in memory and serves a web dir.

- QA (Thales): `--main=fixture` fakes the main agent too.
- Staged preview (Telos): `--main=proxy` reads the main agent from the real Agent Service on :8923 and refuses every main-agent write; fixture agents take writes in memory (replies are fixture text, not Tinfoil).
- Switching to Lane A: add `--agents-upstream=http://127.0.0.1:<port>` to forward all agents traffic (all methods) to Lane A's staged service.

## QA

`tools/thales-agents-qa.sh <stage> <out>` on Thales under `/usr/bin/lockf -k … /Volumes/ThalesMedia/AndroidBuilds/worker.lock`, Playwright from `/Users/thales/workspace/wizard-mobile-link-candidate`. Phone 390×844 touch + desktop 1440×900, dark.

## Open with Lane A

- Lane A error bodies are codes (`model_not_allowed`, check `agent.allowed_models`); the Agents app humanises the code and shows the check.
- Lane A agent_apps carry no `kind`; *Add tool or connector* then offers every agent app (same pool as *Add agent app*). A `kind: tool|connector` field would split them.
- Deep links `?session=<agent thread>` before the agent lists load open in the main Chats; the client learns a thread's agent from `?agent=` lists (or `thread.agent`).
- `thread-dispositions` and `filings` (Defer/Done) for agent threads send `?agent=`; Lane A must route or refuse them without writing private ids into the main stores.
- Agent thread lists are re-read every Chats poll (full list per agent); fine for one or two agents.
