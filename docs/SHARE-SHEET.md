# Wizard share sheet

Share in Wizard opens Wizard's own sheet first: **people → Apps → Other apps…**. Sharing inside Wizard (send to Miguel in Messenger, later Email, Projects, Reference) takes one tap, and the Android/system tray is one extra tap away.

## Owner experience

- Tap Share (reply row, selection menu, code block, or any app's `WizardApp.share.text`).
- **People**: up to 8 recent people from apps that receive shares (Messenger first). Tap one: the app opens on that person with the text in the composer, ready to send or add a line. Nothing is sent without a final tap in the receiving app.
- **Apps**: each app that receives shares. Tap one: the app opens and asks where it goes (Messenger opens its New chat picker).
- **Other apps…**: the old path (Android share tray on the phone, the browser share or copy elsewhere).
- Back, Escape or tapping outside closes the sheet and reports `cancelled`.
- If no installed app receives the kind being shared, Share goes straight to the old path, with no sheet.

## Contract

Shell: `WosShareSheet` (`web/core/share-sheet.js`, `web/core/share-sheet.css`), entered only from `WosChat.sharePayload`, so every caller of `WizardApp.share.text`, the reply row, code share and the selection menu get it without change. Files (`share.file`) keep the old path until a receiver accepts files.

Apps receive with `WizardApp.share`:

```js
WizardApp.share.receive({
  accepts: ['text', 'url'],                         // v1 kinds
  targets: [{ id, name, detail }],                  // optional direct targets (people), up to 24, most recent first
  receive: async item => true,                      // item: { id, text, title, url, target } (target = a target id or null)
});
WizardApp.share.targets(list);                      // refresh the direct targets whenever they change
WizardApp.share.check();                            // pull again (e.g. after unlock); also runs on registration and on each delivery
```

- `receive` returns (or resolves) `true` only when the item is visibly placed (composer filled) or the owner dismissed the app's own picker. Anything else leaves it pending; the shell drops undelivered items after 30 minutes or on a shell reload.
- Isolation: pending items live only in the share sheet's closure. It hands its per-app ops to `WizAppServices` once at shell load (`claimShare`, before any app frame exists), so a frame reads, acks and registers only under its own verified app id; nothing about receivers or pending content is on a global or in storage except the published target names.
- Registration is runtime and device-local (`localStorage wos.share.receivers.v1`): an app appears in the sheet after it has been opened once on that device. Only names and ids the app chose to publish are cached, never message content.
- Same-origin hosted apps only (the verified synchronous `WizAppServices` connection); the sheet never sends on the app's behalf, so each app keeps its own auth, CSRF and send path.
- Ranking: people and apps used from the sheet rise to the front (`wos.share.recent.v1`), then each app's own order.

## Not in v1

Files and images into Wizard apps; a `share:` field in `wizard.md` so apps appear before first open; sharing *into* Wizard from other Android apps landing on this sheet (today that opens the Share to Wizard chat picker in `web/device.js`).
