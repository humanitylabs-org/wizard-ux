# Chats Focus and owner-created Spaces

Reuse:
- Focus, Filter, row actions, new-chat route: EXTEND web/core/chats.js (one shared phone/desktop implementation).
- Box-wide persistence: WizLive.prefOps item operations on /wizard/v1/ui-preferences (queued, offline cache).
- Voice: REUSE WosCommands focus grammar and matchFilters.
- Thread metadata: REUSE attention.subject and By subject sorting; subjects are not Focus options.
Visual: 32px agent-colour pills inside 44px transparent hit targets; registry-derived colours and a subtle `--ch-agent-hue` list gradient over the skin surface. All / Spaces clear the tint. Dark and Nebula screenshots in acceptance receipt.

Default Focus is All, then every configured agent in registry order (including empty agents).
Section collapse uses the same `wos.chats.sections.v1` state in All, agent and Space Focus; only
nonempty text search temporarily opens matching sections. Ready, Yesterday, Past week, Archive,
Errors and Working all use that one renderer/toggle.

New chats inherit `winAgent(w)` / `modelRoute(wid, '__new__')` through the shared composer/outbox:
list +, empty-agent Start a new chat, desktop empty pane, Alt+Enter, fresh-window Alt+N/palette,
phone orb tap/general voice and desktop mic/new-voice buttons (Alt+V or Alt+Shift+V).
Existing-thread replies keep the recorded thread route. Explicit new-voice takes never borrow
its composer or screen context. A held phone orb remains a local-command surface; an unmatched
command creates no thread and is never silently sent to an agent.
Only owner-requested Spaces follow the agents. A Space is a named collection of thread IDs, not a
folder that moves threads or changes their privacy/agent. Unknown/deleted IDs are ignored.
Saved subject focuses migrate to All. Deleting a Space restores All on the next preferences sync.

Agents: use skills/wizard-spaces/SKILL.md and its scripts/wizard-spaces.mjs. Installation:
copy that skill directory into the agent's native HERMES_HOME/skills directory (default ~/.hermes/skills).
The helper uses the existing owner ui-preferences HTTP endpoint: GET, then PATCH item operations (fallback GET → PUT spaces → GET).
Local host installs default to http://127.0.0.1:8923/wizard/v1/ui-preferences; other installs supply
WIZARD_UI_PREFERENCES_URL for their existing owner-authorized route. It does not weaken authentication,
read secrets or write preference files directly. If that route is denied, stop and use the install's
owner-authorized transport, not an invented credential. Shell and helper edits are item operations
(`WizLive.prefOps`), so simultaneous edits to one collection from devices and agents all survive.

New sends while focused on a Space add the outbox's final, durable thread ID to the collection as soon
as enqueue succeeds. The ID is stable through delivery retries/reload; undelivered IDs remain harmless.
A row's existing context menu adds/removes membership. Names and membership sync via the same
preferences polling as pins. Pending/failed preference saves use the existing preferences-error surface.
