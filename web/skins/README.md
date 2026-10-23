# Skin packages

A skin can change how Wizard looks **and** how it behaves, without changing the default shell.
Everything a collaborator's skin needs lives in its own folder here, and only loads for people who pick that skin.
(James, 19 Oct 2026. Architecture reviewed with Claude Fable.)

```
web/skins/<dir>/
  skin.css   look: rules scoped to your skin only
  skin.js    behaviour (optional): gestures, small layout tweaks
```

Declare the package on your skin's entry in `web/core/skins.js`:

```js
{ id: 'obsidian', pkg: { css: true, js: true, when: 'touch', dir: 'obsidian' }, name: 'Obsidian', … }
```

- `when: 'touch'` (default) runs `skin.js` on phones and tablets only. `'always'` runs it on desktop too.
- `dir` lets several skins share one folder (Obsidian and Obsidian Light share `obsidian/`).
- Tokens (colours), the orb tint and the living background stay in the `SKINS` entry. They have to be there
  before first paint and while the picker blends skins.

James's skins (Nebula, Grove, Tide, Ember, Signal) have no package and load nothing from here.

## My skin (every owner's own layer)

Every box also has one personal skin, **My skin**: plain CSS the owner (or their agent) writes, layered on top of
whichever skin is picked. It starts empty, and empty means the picked skin exactly as its author made it.

- **Where it lives:** `Skins/My skin/skin.css` (legacy `Skins/My skin.css` is used when it is absent) in the owner's Files (Runtipi `media/` on a box), outside this image.
  Shell, skin and Agent Service updates never touch it. The Agent Service creates the commented, empty file at
  start and serves it at `GET /wizard/v1/my-skin` (text/css, at most 64 KB, sanitised: no `@import`, no URL to
  another origin, no script hooks); `PUT` (text/css) and `DELETE` (reset) are owner-only and same-origin.
- **How it loads:** `web/core/my-skin.js` puts it in one `<style>` at the very end of `<head>` on phone and
  desktop, after `core/skins.css`, the skin package's `skin.css` and `skin-frame.css`. Same specificity wins later
  in the cascade, so its rules sit on top of every skin. The last good copy is cached for the first frame.
- **Targeting:** `html[data-skin] …` for every skin, `html[data-skin="grove"] …` for one.
- **Optional behaviour:** `Skins/My skin/skin.js` uses the hook API below, after the selected package script.
  It runs only after the owner taps **Turn on** in Settings › Look for its exact SHA-256, saved in
  `wos.myskin.js.ok` on this device. Every edit needs a new owner tap; agents cannot approve it.
  The shell hashes the fetched bytes and imports those same bytes as a Blob module (no URL re-fetch).
  No imports/dependencies or banned APIs; the package host handles guards and cleanup, with a toast naming
  `Skins/My skin/skin.js` after three errors a minute. **Turn off** revokes approval. Never runs in previews.
- **Safety:** A box without the route (404), an error or a non-CSS answer shows the base
  skin; a bad rule only drops that rule. `?myskin=off` skips CSS and JS for one load. The shell CSP allows `script-src blob:` for verified modules, not inline scripts or eval.
- **Orb swipe-up → Desks:** `html[data-skin] { --wos-orb-swipe-up: desks; }` makes a swipe up on the orb open the
  Desks overview (Miguel's gesture) instead of Apps, with no script or approval tap. `pill` instead opens Miguel's
  pill panel (`.ov.ov-pill` markup); the stylesheet setting it carries the `.ov-pill` rules, as `obsidian/skin.css` does.
- **Regenerate under replies:** `html[data-skin] { --wos-reply-regenerate: on; }` shows a Regenerate button under
  the last finished reply. Stock skins leave it off; scope the selector to your own palettes so nobody else gets it.
- **Settings › Look:** a "My skin" row says what it sits on, with Edit (opens the file in Files) and Reset.
- **Agents:** asked to "change my skin", an agent edits My skin only, never a skin in this folder
  (Agent Service run instructions and skill say so).

My skin is not a skin package: it never needs a PR, and it never changes anyone else's Wizard.

## What you can change without asking anyone

A change that only touches your own folder (and your own entry in `skins.js`) goes in through the normal
self-merge rule. Two things keep it off everyone else's Wizard:

- `tests/owner-skins-guard.test.mjs` fingerprints James's skins and the base shell look.
- `tests/skin-packages.test.mjs` checks that your files stay in your lane (below).

Only bring James "this should be the default for everyone", with a preview he can use.

## skin.css

Every selector starts with your skin: `html[data-skin="yours"] …` (or `:is(html[data-skin="a"], html[data-skin="b"]) …`
for skins sharing the folder). You may restyle any shell part, but not hide a `[data-part]` (thread, list,
composer, dock) with `display: none`. No `@import`. The stylesheet loads in the old `skins.css` cascade slot, so it
paints with the first frame.

## skin.js

An ES module with one default export. It gets an `api` object and returns a teardown function:

```js
export default function setup(api) {
  const root = api.part('thread');                      // stable container of the focused chats window
  let start = null;
  if (root) {
    api.listen(root, 'pointerdown', e => {
      if (e.clientX < api.env.edgeInset) return;        // the screen edge belongs to the OS
      start = { x: e.clientX, id: e.pointerId };
      api.gesture.claim(e.pointerId);                   // the dock's desk swipe leaves this finger alone
    });
    api.listen(root, 'pointerup', e => {
      if (start && e.clientX - start.x > 80 && api.route().view === 'thread') api.nav.back();
      start = null;
    });
  }
  return () => {};                                      // listeners/frames registered via api are removed for you
}
```

| API | What it does |
|---|---|
| `api.env` | `{ touch, platform: 'android'\|'ios'\|'desktop', webview, edgeInset, shell }` |
| `api.route()` | `{ view: 'list'\|'thread'\|'desk', thread, desk }` |
| `api.on('route' \| 'render', fn)` | route changes; `{ part, el }` after a chats list or thread repaints |
| `api.nav.back()` | the shell's own Back step (overlay → thread → list → Home). Never exits; false at the root |
| `api.nav.openList()`, `openThread(id)`, `goDesk(i)`, `deskCount()` | shell navigation |
| `api.part(name)` | `'thread'`, `'list'`, `'composer'`: the focused chats window's container; `'dock'`: the dock |
| `api.listen(target, type, fn, opts)` | tracked event listener |
| `api.frame(fn)` | tracked `requestAnimationFrame`, for drags. Settle with CSS transitions |
| `api.gesture.claim(pointerId)` | take a finger before the shell's desk swipe does; false if the shell already has it |
| `api.toast(text)` | a short shell toast |
| `api.storage.get/set(key, value)` | JSON storage namespaced to your skin |

Not allowed in `skin.js` (the test fails): `addEventListener`, timers, `requestAnimationFrame`, `fetch`,
`localStorage`, `innerHTML`, `history`, `window.__wos`, `import()`, `eval`. Use the API instead. If you need a hook
that doesn't exist, open a small core PR adding it; Archimedes reviews those.

## Safety

- The script runs only after the skin is chosen, never while someone swipes through the picker.
- Switching skins runs your teardown and removes everything registered through the API.
- Three errors within a minute turn your script off for that page (your stylesheet stays) with one toast.
- Same-origin code is trusted code: the lint keeps honest skins in their lane, review culture does the rest.
  Third-party skins from outside this repo are not supported.
