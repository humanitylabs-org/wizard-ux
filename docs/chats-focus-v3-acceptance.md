# Chats Focus v3 acceptance

Reuse:
- REUSE: shared Chats section renderer/toggle and `wos.chats.sections.v1` persistence. Focus no longer overrides a closed section; text search still opens its hits.
- EXTEND: shell voice adapters call existing Chats `winAgent` / `modelRoute` / `sendChat`; no new transport or agent-specific renderer.
- REUSE: `WosAgents.colour` / `distinctHues`, Appearance tokens, native horizontal scroller and shared empty-state action.

## Base versus candidate

The same expanded `qa-chats-focus.cjs` ran against base f742a293 and candidate on isolated read-only origins. Every mutation, transcription, session-create and run request was intercepted. Model options/audio/transcript fixtures are synthetic; no inference reached any agent. Checks inspect BOTH POST session-create/run query and body destination, not a mocked enqueue return.

| New-chat entry point | Base finding | Candidate |
|---|---|---|
| List + (phone/desktop; philosopher/main/private) | Correct | Correct |
| `__new__` composer (same agents) | Correct | Correct |
| Empty-agent Start a new chat | Button absent (only + existed) | Shared button routes to that agent |
| Desktop empty-pane Start a new chat | Correct | Correct |
| Desktop Alt+Enter | Advertised but not bound; no draft | Correct |
| Phone orb tap from focused list | Wrong: main agent | Focused agent |
| Phone explicit new voice | Wrong: main agent | Focused agent |
| Desktop mic from focused list | Wrong: main agent | Focused agent |
| Desktop Alt+Shift+V | Not bound; no recording | Correct (existing Alt+V retained) |
| Desktop new-voice button | Wrong: main agent | Focused agent |
| Desktop Alt+N fresh window / palette shared path | Wrong: main agent | Focus copied to fresh window |
| Phone orb hold | Local command; no chat on unmatched speech | Unchanged; no implicit agent send |
| Space typed new chat | Main agent + durable membership | Preserved |
| Space fresh voice | Main agent, but membership missing | Main agent + durable membership |

Base: **173 pass / 71 fail**. Candidate: **244 pass / 0 fail**. Includes both shells, all six list sections in agent and Space Focus, refresh stability, shared All state, 32px visual/44px hit geometry, registry colours, tint removal in All/Space, Dark/Nebula, touch-scroll and Back/privacy regressions.

PR-branch regressions: unit tests **685/0**; Ready **55/1**, same existing 2c as base; Notifications **15/0**; Desktop **54/1**, same split-width assertion as base (base retried after one reload timeout). Exact live integration results are attached to PR #403 after cherry-picking onto the current live tip; PR and live have unrelated prior differences.

Screenshots: `~/.hermes/cache/screenshots/chats-focus-v3/phone-dark-all.png`, `phone-dark-philosopher.png`, `phone-nebula-philosopher.png`, `desktop-philosopher.png`. Visually inspected. Pills are deliberately slimmer than their hit targets; clipped neighbouring tabs indicate the native horizontal scroller. Agent tint overlays the existing skin, never replaces its text/surface tokens.

No backend changes, service restart, main merge, APK build, real inference or private-history read. Space persistence uses the existing backend/preferences capability; this UI work does not independently certify that capability on every deployment.
