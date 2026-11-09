# Browser Reader link routing

**Off by default since 9 Nov 2026 (James: "our browser takes like many seconds to load, whereas if I open something in Brave, it loads very quickly").** Live reads took 2.4-6.3 s against about 1 s in his own browser, so outside links in chats, Search results and hosted apps open the way they did before Reader: in the owner's own browser on the first tap (Android `openInBrowser`, a new tab on desktop), never `/browser/?url=`. Wizard's own pages keep their in-Wizard routes. The one switch is WizardOS settings.json `links.reader: true` (`readerLinks()` in `core/links.js`), which restores everything below unchanged. The Browser app, its Reading list, Save, Reader's own hand-off and agent browsing are untouched; with the switch off the remembered-direct-hosts list is simply never consulted.

Reuse:
- Link capture, browser escape, downloads, media and link menus: **EXTEND** `WizLinks` (`core/links.js`). There is no chat-only or Search-only implementation.
- Phone and desktop windows, instant loading frame, source-aware Back: **REUSE** existing shell window paths (`openLinkDesk` / `asWindow`). No new iframe sheet or native code.
- App registration, capabilities and ready/appearance/Back service: **REUSE** `WizCore` and `WizardApp`.
- Article rendering, sanitizing and resource proxy: **NEW** Browser app domain service, outside this shell repository.

`readerApp` supplies the installed, openable Browser app row. Its same-origin view URL is used as the one Reader entry, with the original URL in `url`. With no openable Browser view, outside links keep their system-browser behavior. File links are dispatched before Reader admission. Internal Wizard links retain their established routes.

`readerOpen` lets the phone use its existing link desk immediately, preserving the source thread and Back path; desktop uses its existing normal-window path. Neither awaits a backend response. The Browser app paints its own reading state before its fetch.

Only trusted app UI uses `data-wizard-browse` on an original-source link. WizLinks consumes that explicit action with its existing browser escape (including Android `openInBrowser`), not Reader. Source article HTML cannot set that marker because the Browser sanitizer does not admit it.

The shared hosted-frame guard handles Search result anchors and app links through the same path. Search does not embed another Reader. Long-press keeps browser/download/copy choices; its text panel uses opaque Appearance v1 tokens. No outside site scripts are loaded by this component.

## Wizard's own pages and pages Reader cannot read (James, 7 Nov 2026)

Wizard's own servers never go into Reader: the shell's own host and configured `network.base_url` host, `*.ts.net`, `wizard.aiwizards.com`, `*.wizard001.com`, and private/LAN/single-label hosts open exactly as before Reader (same origin in-app; other origins via the existing browser escape, Android `openInBrowser`). Reader could not sign in to them and its render browser is refused those addresses anyway.

No double tap. When Reader cannot read a page, its JSON failure carries a `reason` (`blocked`, `signin`, `noarticle`, `unavailable`, `private`) and `handoff:true`. The Browser app then clicks a hidden `data-wizard-browse="auto"` anchor in its own frame. WizLinks honors `auto` only from the installed Reader's frame:

- Phone (native shell): opens the original through `openInBrowser` at once; Reader then calls `WizardApp.nav.back()` so the owner returns to the tapped chat, as links behaved before Reader. The guard takes the anchor with `preventDefault()` and `stopPropagation()` in the capture phase, so Reader reads `dispatchEvent()`'s result rather than a listener on the anchor (gate 7 Nov 2026: that listener never ran and Reader stayed open over the chat).
- Desktop browser: opens a tab only while the owner's tap is still a fresh user activation (`navigator.userActivation.isActive`, about 5 s in Chrome); Reader fails bot walls in about a second, so the first tap normally lands in the original. Without activation the shell declines (no blocked popup) and Reader keeps its visible "Open in your browser" fallback. After a taken hand-off Reader calls `WizardApp.nav.back()`; on desktop that closes the link's Reader preview window (as Esc does; `closePreview` in `desktop.js`, installed apps' own windows never close this way), so the chat is left as it was.
- `blocked`/`signin`/`private` hosts are remembered owner-locally (`localStorage["wos.readerDirect.v1"]`: hostname → time only, 14 days, at most 200) so the next link to that host opens directly in the browser on the first tap. `noarticle`/`unavailable` are transient and not remembered.

Sanitization, SSRF/deny-host, CSRF and the edge allowlist are unchanged; Reader's sanitizer still never admits `data-wizard-browse` from source HTML.

## Required final acceptance

Unit routing fixtures cover chat, a hosted Search-shaped result, installed/missing/foreign Reader rows, files, internal links and Android/desktop source escape. These are not a substitute for the final in-shell gate: phone and desktop, two skins and a live skin change, real Search result and chat taps, Back and same-frame loading capture, followed by live server and phone update-feed version readbacks. See the Browser app's `docs/reader.md` for security and packaging gates. No Android native change or APK is required.
