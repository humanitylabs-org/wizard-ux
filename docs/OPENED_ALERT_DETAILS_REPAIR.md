# Opened alert: original contents repair

User correction: “I mean, shouldn’t I be able to see the contents / details of this alert and not just its title?”

Reuse:
- REUSE WizCore Chats notification-thread route and existing message scroller.
- EXTEND WizCore Chats (`web/core/chats.js`, `.css`, `chat-power.js`) to render escaped original source directly under its edited summary and retain its reading place.
- EXTEND WosBell (`web/core/notif-bell.js`) projection to retain the complete `details` field, with the full message as legacy fallback.
- NEW none. No new detail route, agent run, markdown renderer, source DB or sidecar.

Visual: same opened yellow notification surface and composer/actions; visible Original alert text follows the summary, using existing skin ink roles and scroller. Phone checks use Nebula and Obsidian Light at 360 and 390 CSS pixels.

Trace: Notifications `readable_messages()` derives `details[id]` from raw title + two newlines + raw message. `_messages()` joins this onto items and `inbox_items()` returns it through `/notifications/api/items`. Shell `cleanItem()` discarded `details`; skin-host opens an unsent context draft, and Chats `NV` rendered only its short message. This repair preserves original source independently of the summary, escapes markup and preserves paragraphs. No change to original data, summary generation or notification marks.

Regressions: `tests/opened-alert-original-details.test.mjs` and `qa-opened-alert-original-details.cjs` cover this exact opened Chats surface, >8,000-character sources, legacy source fallback, inert HTML, visible paragraphs, tail reachability, wrapping, top entry, reading place across repaint and zero API writes merely to read it.
