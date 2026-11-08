# Android Downloads port v1

`window.wizardDownloadsPort` is how the Wizard shell reads and manages the in-app Downloads list
(`web/core/downloads.js`). It replaces four `WizardOSNative.downloads*` JavaScript-interface methods
(PR #1140), which were exposed to **every** frame: `addJavascriptInterface` cannot tell the shell from
a hosted-app iframe, and the guard only looked at the top-level URL, so an iframe inside the normal
shell passed it. Those methods no longer exist. The toast path (`WizardOSNative.download(url)` →
`DownloadManager`) is unchanged.

## Who may call (native, `downloads/DownloadsCallerPolicy`)

Added with `WebViewCompat.addWebMessageListener` for the selected Wizard's primary origin, like
`wizardScreenPort`. A message is admitted only if **all** hold:

1. the WebView supports `WEB_MESSAGE_LISTENER` — otherwise the port is simply not installed
   (fail closed; the shell shows no Downloads UI);
2. it comes from the current WebView (not a replaced or destroyed one);
3. the sending frame is the main frame;
4. its origin equals the primary origin exactly;
5. the page now at the top is `/wizard-os-home` or `/wizard-os-home/…` on that origin.

A denied message gets no reply and runs nothing. After admission, the answer (list) is re-checked
against a per-page-load counter, the WebView and the top URL before it is posted; open / cancel /
remove are carried out in the same UI-thread task as their admission. Hosted-app iframes (same- or
cross-origin) and any non-shell top-level page are refused.

## Envelope

```
page → native  {"v":1,"id":"dl1","method":"list"|"open"|"cancel"|"remove","params":{"id":"<digits>"}}
native → page  {"v":1,"id":"dl1","ok":true,"result":…} | {"v":1,"id":"dl1","ok":false,"error":"…"}
```

`list` → `{"v":1,"items":[{id,name,mime,size,got,status,started,finished}]}`; `open` → `"ok" | "missing"
| "none"`; `cancel` / `remove` → `"ok" | "missing"`. Ids are DownloadManager ids as plain digits;
anything else never reaches native. Native events (`start | done | failed | sync`) arrive on the same private port as
`{"v":1,"event":{...}}` (no `id`), posted through the reply proxy of the last admitted main-frame message and only while the
shell is the top page in the same page load. There is no global entry point: an earlier version had `window.__wosDownloads`,
which a hosted app could call to make the shell read the native list and paint the real name of any id it guessed
(PR #1143 review). The first `list` the module sends at load is what tells native which document to post to.

## What the tests do and do not prove

* `DownloadsCallerPolicyTest` (pure JUnit): the admission rules above, request parsing, that a denied
  caller runs nothing and the tracked transfer survives, and that `MainActivity` has no `downloads*`
  JavaScript-interface methods.
* `tests/downloads.test.mjs`: the web consumer against a **fake** port. A fake bridge does not certify
  native security.
* Not covered by either: a real WebView with a hosted iframe. That needs a device/emulator check.

## Same-origin hosted frames (honest limit)

`addWebMessageListener` places the port object on every frame whose origin matches, and a call made through
`parent.wizardDownloadsPort.postMessage(...)` is attributed to the parent's frame, so `isMainFrame` alone cannot tell it
from the shell. Native cannot close that by itself. What this change does:

* Removes the frame-blind exposure: no JavaScript-interface methods, so cross-origin frames, sandboxed frames, frames on
  other pages and any non-shell top-level page reach nothing. A frame's own copy of the port is refused natively.
* Defence in depth in the page: `web/core/downloads.js` takes the port into its closure at startup (before any hosted
  frame exists), binds `postMessage` / `addEventListener`, and removes `window.wizardDownloadsPort`, so
  `parent.wizardDownloadsPort` is gone for hosted apps. Fake-window web tests cover it.
* Native->page events (`start | done | failed | sync`) go out only while the shell is the top page, on the private port
  (no global to call).

## Same-origin hosted apps: this is NOT an isolation boundary

A same-origin hosted app has the shell's authority. This change does not close that, and nothing here should be read as
closing it. Closing it needs hosted apps on their own origin or in sandboxed iframes without `allow-same-origin`, an
architecture change outside this fix. The acceptance hold (`wizard-ux#1140:downloads-frame-isolation`) stays open.

Bounded hardening in `web/core/downloads.js` (closure hiding; each item is covered by a fake-window parent probe in
`tests/downloads.test.mjs`, which does not certify native or real-WebView behaviour):

* `window.WosDownloads` is frozen and exports only `available`, `isOpen`, `back`. No list, no `_state`, no open /
  cancel / remove / show. Native actions live in the module closure.
* The raw port is taken into the closure at startup and `window.wizardDownloadsPort` is removed.
* Actions run only from a click with `isTrusted === true` on the shell's own buttons; the row a tap acts on comes from a
  private map the shell filled when it drew the rows, not from DOM attributes (the markup carries no download ids).
* No callable event entry point exists (see above). Events are still only a nudge: banners and toasts show what the
  native list returns for the id, never text from the event.
* `JSON.stringify/parse` are captured at load.

What a same-origin script can still do, because it shares the realm: read the sheet's DOM while it is open (names, sizes,
no ids) via `parent.document`; patch other globals (`Promise`, `Map`, `Array.prototype`, `document.createElement`,
`Function.prototype`) before the module runs on a later load or around a real tap; cover or imitate the shell UI to
mislead a real tap; and reach every other shell module the same way (`wizardScreenPort`, `wizardAppsPort`, ...).
Whether the real WebView lets a page delete the injected property, and what a hosted iframe finds, is part of the
on-device acceptance (queued on forum, not run here).

## Receiver (`DownloadsReceiver`, separate from the port)

`android.intent.action.DOWNLOAD_COMPLETE` is sent by DownloadProvider (`android:sharedUserId="android.media"`, not this
app's UID and not UID 1000), addressed to the requesting package with `setPackage`. A non-exported manifest receiver
accepts broadcasts only from its own app UID, root or system, so `exported="false"` would drop genuine completions; it
stays `exported="true"` but is protected by `android:permission="android.permission.SEND_DOWNLOAD_COMPLETED_INTENTS"` (AOSP DownloadProvider manifest: `protectionLevel="signature"`, requested by DownloadProvider), so a third-party app cannot send the action. Not verified on a device or on other ROMs: if completion banners never appear on some phone, check this first (the sheet still refreshes from the list). A source-level review found a raw `Thread` started for every non-negative id before the id was
checked. Now: exact action and id >= 0, then the id must be one WizardOS tracked (`Downloads.isTracked`), only then
`goAsync()`, with work on a single bounded worker (`DownloadsReceiverPolicy`). No device exploit was shown for the old code.

Download rows are only taken off the list ("remove"); the file is never deleted.
Whether the real WebView lets the page delete the injected property, and what a hosted iframe finds, is part of the
on-device acceptance (queued on forum, not run here).
