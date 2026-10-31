# Wizard share sheet

Share opens **Agents → Apps → Other apps…**. A normal tap stays inside Wizard; holding a Share control for 500 ms goes straight to the Android/system tray. Nothing sends without a final tap by the owner: in the agent's chat or in the receiving app.

## Owner experience

- Tap Share in a reply, quote, code block, selection menu, media viewer, or an app's `WizardApp.share.text / file`.
- **Agents** (James, 31 Oct 2026: "share things to you instead of copying and pasting or screenshotting"): one tile per agent he can chat with, using each agent's own label and sigil from `WosAgents` (hidden agents left out). Main agent first by default, then most recently shared-to first. Tapping one opens a **new chat** with that agent: text and links are staged in the composer as a Markdown quote under the unchanged attribution line (`From Archimedes:` then `> …`), with an empty line for his note; an image or file is staged in the composer tray through the Chats paperclip path (`addFiles`). Unsent words already in that agent's new-chat draft stay, the quote goes after them. Nothing is sent: he adds his note and taps Send. A stopped agent shows dimmed and cannot be picked; an agent whose file access is off (`permissions.files: 'none'`) is not offered images or files.
- **Apps**: apps accepting this kind. Messenger with no target opens its own **Send to…** picker, so the person is chosen inside Messenger. That replaced the separate People row (31 Oct 2026): People + Agents + Apps was too long. `targets` remain in the receiver API (and `deliver(app, item, target)` still honours one) but the sheet no longer lists them.
- **Other apps…**: the existing Android tray, browser share or text-copy fallback.
- Back, Escape or tapping outside closes the sheet and reports `cancelled`; Back never exits.
- With no agent and no installed receiver for this kind, sharing goes straight to the existing native/browser path.
- **Privacy of the Agents row.** The sheet works out where the Share came from (the tapped control, the live selection, else the window in front, including the media viewer over it). Content from a **private agent's** chat is offered only to **that same agent**, never to the main or another agent. Content from an **Incognito** chat gets **no** Agents row: Incognito words stay in their RAM-only chat. Apps and Other apps… stay available there, because handing words to a person or another app is his explicit choice, exactly as before this row existed. Shares from apps or Home offer every visible agent.
- Hold any shell Share control (mouse or touch) for 500 ms to bypass the Wizard sheet. Moving more than 10 px, releasing early or cancelling the pointer cancels the hold. Its following click and WebView context menu are suppressed. `WosChat.bindSharePress` is the one delegated implementation, reusing each control's existing action, not a parallel action per button.
- Hosted callers can explicitly bypass with `WizardApp.share.text({text, direct:true})` or `WizardApp.share.file(file, {direct:true})`.

## Contract

Shell: `WosShareSheet` (`web/core/share-sheet.js`, `web/core/share-sheet.css`), entered from `WosChat.sharePayload / shareFile`. Agents go through the one agent opener `WizOpenAgentChats(id, {thread: '__new__', share: true})` (phone `web/app.js`, desktop `web/desktop/desktop.js`; it resolves with the Chats window) and the composer's own `insertText` / `addFiles`; the main agent keeps the list's All focus, like an app-item reply. No new route: nothing reaches the server until he sends, and then it is an ordinary chat message. The media viewer uses `shareFileOpen` so its legacy native bridge can report `opened` without pretending that is a delivery receipt. App callers retain `shared | copied | cancelled | unsupported`.

```js
WizardApp.share.receive({
  accepts: ['text', 'url', 'image'],                 // also 'file' for apps able to receive generic files
  targets: [{ id, name, detail }],                  // optional, up to 24, most recent first
  receive: async item => true,                     // only after visibly placed
});
WizardApp.share.targets(list);
WizardApp.share.check();                           // pull again after unlock; also runs on delivery/registration
```

- Kinds: `text`, `url`, `image` (`image/*`) and `file` (every other MIME type). File items contain `{id, kind, file: Blob|File, name, mime, size, title?, text?, target}`. Files are capped at 32 MB before the sheet or native bridge. The sheet previews the filename and an image thumbnail; its object URL is revoked on every close path.
- Pending items and their Blob/File bytes stay in the sheet's closure, never localStorage, URL fragments, base64 globals, or the public diagnostic snapshot. Native base64 encoding happens only after choosing the native path.
- `receive` resolves true only after visible staging (or explicit dismissal for the existing text picker). False or errors leave the item pending. The shell expires items after 30 minutes or on reload.
- `WizAppServices` claims per-app operations once before frames exist. Only a verified same-origin app frame can register, pull or ack its own items. The first live pulling frame claims each item until it closes; two windows cannot stage the same share. Synchronous connections preserve Blob objects; the existing request/response `postMessage` transport structured-clones them without JSON encoding.
- The receiver registry (`localStorage wos.share.receivers.v1`) caches declared kinds and published target names/ids, never shared content. Reviewed Messenger defaults offer text and URL before first open; images are offered once a Messenger that stages photos registers `image` itself. A runtime registration replaces the default, including older versions that only accept text/URL.
- Messenger accepts **images, not generic files**: its existing Telegram-only multi-photo tray supports up to 10 photos, with the existing 25 MB input-photo cap and resizing. A shared photo uses that exact staging function, waits while locked, opens the selected chat, and acks only once a tray chip is painted. Unsupported chat networks, full trays, decode/size failures, navigation during preparation, or cancelling the image recipient picker leave it pending. Retrying is through `WizardApp.share.check()`; undelivered shares are not durable across a shell reload.
- Apps keep their own auth, CSRF and final send paths. Ranking uses local recency (`wos.share.recent.v1`; agents as `agent:<id>`), then the main agent / the app's own order.

## Not included

A manifest share declaration; generic-file sending in Messenger; Android inbound shares landing here (currently handled by the Share to Wizard picker in `web/device.js`, whose server route `share-agents.mjs` sends at once and so is not reused by this sheet, which never sends). Physical Android intent delivery remains a device acceptance check; browser tests stub the native bridge, not an Android OS tray.

## Tests

`tests/share-sheet.test.mjs` (registry, Agents order/privacy/file permission, quote format) and `qa-share-agents.cjs` (fully fixtured phone + desktop: Agents row names/sigils, new Philosopher chat with the quote staged and nothing sent, image staged, Messenger with no person, Other apps… to the fake Android bridge, Back / tap outside / Esc close, private-agent chat offers only that agent, two skins with a live skin change).
