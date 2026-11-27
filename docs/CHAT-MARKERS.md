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
| `[WIZARD_ACTION_V1]{"app":"<app id>","id":"<item id>"}[/WIZARD_ACTION_V1]` | agent, on its own line (an app's propose tool gives it) | an app's proposed action as a card: Approve, Edit, Open in app (below) |
| `[WIZARD_BUTTONS_V1]{"group":"<ask>","buttons":[{"id","label"}]}[/WIZARD_BUTTONS_V1]` | agent, on its own line | tap-to-answer buttons in place (below); elsewhere its labels as text, `[Done]` |
| `[WIZARD_TAPS_V1]{"taps":[{"thread","message","group","button","label"}]}[/WIZARD_TAPS_V1]` | Wizard, on the owner's tap message | a quiet machine line per tap (its readable `Tapped …` lines stay) |

## WIZARD_TWEAK_V1: a tweak toggle in the chat

When an agent ships an off-by-default tweak, it puts the tweak's switch in its reply so the owner can turn it on right
there instead of going to Settings › Look:

```
The new Sent rows are live. They start off; switch them on here:

[WIZARD_TWEAK_V1]{"id":"wizard/sent-threads"}[/WIZARD_TWEAK_V1]
```

- Several at once: `{"ids":["wizard/sent-threads","miguel/ai-apps"]}` (max 8). Ids are catalogue ids
  (`web/tweaks/catalog.json`, `author/name`) or the core features' ids (`web/core/core-features.json`); anything else
  is dropped silently.
- Wizard draws Settings › Look's own switch row (`WosSettings.tweakCard`, same `tweakSwitches` markup, name, "by" line,
  description) on an opaque card, bound to `WosExperience`: a tap flips it on that frame and calls
  `WosExperience.toggle(id)`, the one path Settings uses; every card and Look repaint on `wos:experience`. A failure
  reverts to the real state with the same toast.
- A message is history: the card always shows the tweak's current state, never the state when it was sent.
- Not installed on this Wizard: a quiet line, "This tweak isn't installed on this Wizard". A tweak whose manifest
  `shells` leaves out this shell shows disabled, labelled "Phone only" / "Desktop only".
- Works for experiment tweaks and the release-wide settings (e.g. `wizard/unified-inbox`, Notifications in Chats, built
  into the shell since wizard-ux issue 1352).
- App feature switches (wizard-ux issue 1560, on for everyone): an id
  `<app id>:<switch id>` (the `wizard.app-switches/1` catalog, wizard-os docs/APP_SWITCHES.md) draws the same switch
  row, mixed freely with tweak ids in `ids`. Name, description and current state come from the App Manager's one
  catalog (`/wizard-os-home/store-install/_feature-switches`, read when a card paints, at most every 15 s, and when the
  page shows again); a tap POSTs `{"id","on"}` there with `X-Wizard-Store: 1`, the owner-proof path the Tracker's Try it
  uses, so the app's own `/api/switches` changes. An installed app that doesn't have the switch yet is greyed with
  "Update <app> first" and an Update button (opens that app in the App Store); an app that isn't installed, or declares
  no switches, stays hidden.
- Tests: `tests/chat-tweak-card.test.mjs`; browser: `tests/qa-chat-tweak-card.cjs`, `tests/qa-chat-app-switch-card.cjs`.

## WIZARD_ACTION_V1: an app's proposed action in the chat

wizard-ux issue 1463, on for everyone (switch `wizard/action-cards` removed); contract wizard-os `spec/APP_ACTIONS.md`
(`wizard.app-actions/1`). An app's agent tool keeps a prepared action pending in the app (a Messenger draft, a mail
reply, a calendar event) and hands the agent one marker line naming the app and the item. `web/core/action-cards.js`
(`WosActionCards`) draws a card from the app's own answer at `<app url>api/actions/<id>` (title, body, fields, state,
open path): **Approve** (the app's own word, e.g. Send), **Edit** (editable fields become text boxes; Approve then
sends the edited words), **Open in app** (that item's page inside the app) and a quiet **Reject**. A decision is a
`POST` to the same path with `X-Wizard-Action: 1`. The marker carries no text or route, so the card and what Approve
does always come from the app. A message is history: the card shows the item's current state. The marker is always
hidden from the text. Look: `web/core/action-cards.css`.

- Tests: `tests/action-cards.test.mjs`; browser: `tests/qa-chat-action-cards.cjs`.

## WIZARD_BUTTONS_V1: tap-to-answer buttons in a reply

wizard-ux issue 1889, behind the off-by-default switch `wizard/reply-buttons` (the Agent Service reads the same switch
from the Look file and only then tells the agent about the marker, `server/reply-buttons.mjs`). An agent asks in its
normal text and puts one line per ask where the buttons belong:

```
**Ship desks?** I tried both layouts.
[WIZARD_BUTTONS_V1]{"group":"Ship desks","buttons":[{"id":"go","label":"Go for it"},{"id":"drop","label":"Drop this"}]}[/WIZARD_BUTTONS_V1]
```

- `group`: the ask, 1-60 characters, unique in the reply (it names the ask in the tap line). 1 to 6 buttons, ids
  `[A-Za-z0-9._-]`, labels up to 40 characters; up to 12 groups per reply. Parsed by `WosChat.buttonGroups`
  (core/chat-kit.js), drawn in place by `WosActionCards.replyHtml` (core/action-cards.js); no card, plain buttons.
- A tap marks the button picked on the tap frame (the group's others dim). Taps a few seconds apart (3 s after the last
  tap, at most 10 s) go as one ordinary owner message through the thread's own send path (the durable outbox, routed
  agents, steering a running reply): `Tapped <label> · <group>` lines plus a `[WIZARD_TAPS_V1]` line naming each tap.
  The thread draws it as a quiet machine line. The picked state is read back from the thread's history, so a reload and
  every other device show it; a group can be changed until the agent has replied after its tap.
- Switch off, Copy, the Chats list preview and any client that can't draw them: the labels as text (`[Go for it]
  [Drop this]`), so the owner can type one.
- Tests: `tests/reply-buttons.test.mjs`; browser: `tests/qa-chat-reply-buttons.cjs` (`QA_SWITCH=off` for the off case).
