# Chat markers

Machine lines an agent writes into a reply. Wizard hides every one of them from the message text, Copy/Share, the
Chats list preview (`web/live.js` `clean`) and the streaming answer (`web/core/chats.js` `streamAnswer`). Parsing lives
in `web/core/chat-kit.js` (`cleanText` and the per-marker readers).

| Marker | Who writes it | What Wizard does |
|---|---|---|
| `[WIZARD_STATUS_V1]{…}[/WIZARD_STATUS_V1]` | agent, last line of a final reply | chat list state, ask, subject, title (served by the Agent Service) |
| `[WIZARD_FILES_V1]…` / `[WIZARD_FILE_CHIPS_V1]…` | Wizard, on the owner's message | attachment chips |
| `[WIZARD_CLOSE_AND_FILE_V1]…` | Wizard | close-and-file instruction, hidden |
| `[WIZARD_IMAGE_INTENT_V1]…` | Wizard | image intent, hidden |
| `[WIZARD_REPLY_V1]` / `[WIZARD_REPLY_TO_V1]` | Wizard | Notifications Reply card / Thread tracker quote |
| `[WIZARD_TWEAK_V1]{"id":"<tweak id>"}[/WIZARD_TWEAK_V1]` | agent, on its own line | a live tweak switch in the message (below) |

## WIZARD_TWEAK_V1: a tweak toggle in the chat

When an agent ships an off-by-default tweak, it puts the tweak's switch in its reply so the owner can turn it on right
there instead of going to Settings › Look:

```
The Desktop-style Chats list is live on your phone. It starts off; switch it on here:

[WIZARD_TWEAK_V1]{"id":"wizard/desktop-chats"}[/WIZARD_TWEAK_V1]
```

- Several at once: `{"ids":["wizard/desktop-chats","miguel/ai-apps"]}` (max 8). Ids are catalogue ids
  (`web/tweaks/catalog.json`, `author/name`); anything else is dropped silently.
- Wizard draws Settings › Look's own switch row (`WosSettings.tweakCard`, same `tweakSwitches` markup, name, "by" line,
  description) on an opaque card, bound to `WosExperience`: a tap flips it on that frame and calls
  `WosExperience.toggle(id)`, the one path Settings uses; every card and Look repaint on `wos:experience`. A failure
  reverts to the real state with the same toast.
- A message is history: the card always shows the tweak's current state, never the state when it was sent.
- Not installed on this Wizard: a quiet line, "This tweak isn't installed on this Wizard". A tweak whose manifest
  `shells` leaves out this shell shows disabled, labelled "Phone only" / "Desktop only".
- Works for experiment tweaks and the release-wide settings that are tweaks underneath (e.g. `wizard/unified-inbox`).
- Tests: `tests/chat-tweak-card.test.mjs`.
