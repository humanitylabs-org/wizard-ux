# Agents MVP — Lane B (UX)

Lane A (spec, Agent Service) owns the API: wizard-os `spec/AGENTS.md`.

## What the UX does

- **Agents** is its own system app (`web/agents/`, app id `agents`). Home reaches it from the system area (phone: the people button beside *Your system*; desktop: the Home chip on an empty workspace). System links to it from its header. It is not listed in Apps, the launcher grid, desktop app search defaults, or the App Store.
- **List**: sigil, name, harness, model provider · model, Private/Standard, status, Main agent; a stopped agent that apps route through shows *N apps waiting*. Below the list, **App routing**: every installed app that sends work to an agent, with *Routes through [agent ▾]*.
- **New agent**: three steps, *Harness → Model provider → Permissions*. Permissions start from a preset (Private / Standard) and stay adjustable in the same step: outside tools, files, Wizard apps, agent apps (tools/connectors), other agents. Private needs a confidential provider; the UI says so and does not offer a downgrade.
- **Agent page**: edit any time — rename, start/stop, model (same provider only), outside tools (a private agent asks before turning one on), files, add/remove Wizard app, add/remove agent app, add tool or connector, other agents. The main agent is shown read-only (its permissions belong to the Wizard setup). **Apps that send work here** lists the apps bound to this agent, each with its route picker.
- **Per-agent Chats**: *Open chats* opens a Chats window pinned to that agent (`w.agent`). It lists only that agent's threads (`GET /wizard/hermes/api/sessions?agent=<id>`), starts new chats on it, and every thread/run call names it (`?agent=<id>`, plus `agent` in create/run bodies). A persistent strip names the agent on list and thread, phone and desktop: sigil, agent colour (also a coloured window edge), label, model, lock + *Private* for a private agent. The window title and desk label carry the agent's sigil and name. When more than one agent exists, the main Chats shows the main agent's strip too.
- **Model picker** in an agent's chats lists only `allowed_models` on the agent's provider; no "more models". Sends seal the agent's route (`{model, provider, agent}`); a model outside the list fails before sending.
- **Privacy in the client**: an agent's threads never enter the main list, Home cards, body search or the main thread-seen store (their read state is device-local, `wos.agentSeen.v1`). The orb's screen context names a private agent's window but never reads its titles. Voice in an agent's Chats goes to that agent (open thread, else a new chat), never to the main agent or the cloud router; held-orb commands still run on-device only.
- **Back**: agent page/sheet/flow step → previous screen (WizardApp back facade); agent Chats thread → list → the Agents app it was opened from → Home; at Home, Back stays (native "You're home"; browser tab: "Press back again" floor). The app settings sheet closes first and leaves the app open. Tested in `qa-agents.cjs`.
- Deep links: `?view=agents`, `?open=agents`, `?agent=<id>` (that agent's Chats).

## App → agent binding ("Routes through")

An installed app that makes work for an agent (recording recaps, reports, automations) declares `agent_binding` in its `wizard.md`; the owner picks the agent it routes through. Default = the main agent (a fresh box has only that one). The app never names an agent.

- **Shell** (`web/core/app-route.js`, both shells): an app with a binding gets a route button in its window bar (arrow + the agent's sigil; red dot when the bound agent is stopped or missing). It opens the app's settings sheet: what the app sends, *Routes through* with every agent (a private agent carries its lock, nothing extra), and the default note. A bound agent that is stopped is said plainly: the work waits, it never goes to another agent. *Agents* opens the Agents app at that agent. Back/Esc closes the sheet only.
- **Agents app**: *App routing* on the list, *Apps that send work here* on each agent page, both with the same picker (in-app sheet, WizardApp back).
- **System**: *App routing* section; tapping a route asks the shell for the app's settings sheet (`wizard:app-route`, only System/Agents frames may ask).
- After a change the shell tells open System/Agents frames to re-read (`wizard:bindings-changed`).

API used (wizard-os spec/AGENTS.md, Lane A):

- `GET /wizard/v1/app-bindings` → `{ apps: [{ app_id, label, purpose, required, agent, is_default }] }` (optional: without it the client derives the routes from each agent's `bound_apps`).
- `GET /wizard/v1/apps/<app_id>/binding` → the same view; `PUT { agent }` → the new view (`404 agent_not_found`, codes humanised with their `check`).
- `GET /wizard/v1/agents[/<id>]` → each agent carries `bound_apps: [{ id, label, purpose }]`.

## Fixture and preview

`tools/agents-fixture.mjs` implements the contract in memory and serves a web dir.

- QA: `--main=fixture` fakes the main agent too. `--binding-apps=id:Label:Purpose,…` names the installed apps that declare a binding (default: one universal Meeting Recorder, served as a stand-in page at `/__fixture/apps/<id>/`).
- Staged preview: `--main=proxy` reads the main agent from a real Agent Service (`--main-upstream=http://127.0.0.1:8923`) and refuses every main-agent write; fixture agents take writes in memory (replies are fixture text).
- Live Lane A service: add `--agents-upstream=http://127.0.0.1:<port>` to forward all agents and binding traffic (all methods) to it.
- `WIZARD_UX_FALLBACK_WEB=<web dir>` serves untracked build outputs (data.js, summaries.js) from another checkout.

## QA

`PW=<playwright module> tools/agents-qa.sh <stage> <out>` on the browser QA host (under its shared heavy-worker lock). Phone 390×844 touch + desktop 1440×900, dark. The suite seeds the shell's cached app list with the fixture's binding app.

## Open with Lane A

- Lane A error bodies are codes (`model_not_allowed`, check `agent.allowed_models`); the Agents app humanises the code and shows the check.
- Lane A agent_apps carry no `kind`; *Add tool or connector* then offers every agent app (same pool as *Add agent app*). A `kind: tool|connector` field would split them.
- Deep links `?session=<agent thread>` before the agent lists load open in the main Chats; the client learns a thread's agent from `?agent=` lists (or `thread.agent`).
- `thread-dispositions` and `filings` (Defer/Done) for agent threads send `?agent=`; Lane A must route or refuse them without writing private ids into the main stores.
- Agent thread lists are re-read every Chats poll (full list per agent); fine for one or two agents.
- Binding list: the UX prefers `GET /wizard/v1/app-bindings` (shows apps still on the default agent). Without it, apps on the main agent appear only if the main agent's `bound_apps` lists them.
