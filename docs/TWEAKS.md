# Tweaks, developer mode and updates

How owners (and their Wizards) change Wizard without breaking updates. Agents: read this before changing
anything in Wizard for an owner, and tell them which level a change needs before you start.

## The three levels

| Level | Who | Can change | What an update does to it |
|---|---|---|---|
| **My skin** | everyone | how things look (`Skins/My skin/skin.css`) | nothing; it stays on top |
| **Tweaks** | everyone | anything on screen: looks, gestures, controls, and whole front-end **parts** (pins today) | nothing is merged or rebased; each tweak is checked and **paused** with a plain note if the part it changes moved |
| **Developer mode** | owners who opt in | front end **and** back end: a personal build of Wizard | their changes are merged onto the new version; a clash keeps them on their current version, nothing lost |

Rule of thumb for agents: if the change is only in the browser (`web/`), it is a tweak. If it needs the Agent
Service, App Manager, an app's server or stored data to change, it needs developer mode, or a proposal upstream.
Say so plainly: "That needs developer mode. Want to turn it on?" Never patch core files on a box: the next update
replaces them.

Tweaks never edit Wizard's files. They plug into named slots, events and parts that keep their names and rules
across updates, so an update can't wipe them and they never need a rebase.

Slots are listed in `web/core/slots.json` (removing or renaming one needs an API bump). The desktop bar has two:
`bar-start` (before the Home button) and `bar-center` (the middle of the bar; while it holds anything the date and
time step aside, and it hides under the voice pill like the clock did). Mount with `api.slot.mount(name, node, order)`.

## Parts: replacing a whole piece of the front end

A part is a named front-end piece a tweak can swap out whole (`web/core/parts.js`). Core code calls the part, so
the replacement runs everywhere the stock one did; if it throws, that call falls back to stock, and three errors
in a minute turn the tweak off.

| Part | Version | Methods | Repaint event | Stock |
|---|---|---|---|---|
| `pins` | 1 | `ids()`, `has(id)`, `toggle(id) → pinned?`, `partition(rows, eligible) → {pinned, rest}` | `wos:chat-pins` | `web/core/chat-pins.js` |

Adding a part: call `WosParts.define(name, { version, methods, event }, stock)` in the core file that owns it, make
its core callers use `WosParts.use(name)`, and add a row here. Bump the version only when the methods' meaning
changes; every tweak written for the old version then pauses until it is updated.

### In the owner's own tweak (`Skins/My skin/skin.js`)

The owner approves the exact file in Settings › Look (Turn on). Its API adds:

- `api.parts.replace(name, impl, { version })` → `true`, or `false` with a toast (a wrong version shows
  "… paused after an update · ask your Wizard to update it"). Removed automatically when the script is off.
- `api.parts.changed(name)` repaints whatever shows that part.
- `api.prefs.get()` / `api.prefs.put(patch)`: the box-wide shell preferences (`/wizard/v1/ui-preferences`),
  the same on every device. The service validates every key.
- My skin scripts can't use `fetch`, `localStorage` or timers directly: use `api.prefs`, `api.storage` and
  `api.after`.

```js
// Example: pins that stay the same on every device, kept as the owner's own tweak.
export default function setup(api) {
  let ids = [];
  const pull = async () => { const p = await api.prefs.get(); if (p) { ids = p.pinnedChats || []; api.parts.changed('pins'); } };
  void pull();
  api.parts.replace('pins', {
    ids: () => ids.slice(),
    has: id => ids.includes(id),
    toggle(id) {
      const on = !ids.includes(id);
      ids = on ? ids.concat(id) : ids.filter(x => x !== id);
      void (async () => { const p = await api.prefs.get(), base = (p?.pinnedChats || []).filter(x => x !== id);
        await api.prefs.put({ pinnedChats: on ? base.concat(id) : base }); })();
      return on;
    },
    partition(rows, eligible = () => true) {
      const pinned = ids.map(id => rows.find(r => r.id === id)).filter(r => r && eligible(r));
      return { pinned, rest: rows.filter(r => !pinned.includes(r)) };
    },
  }, { version: 1 });
  return () => {};
}
```

### In a published tweak (`web/tweaks/<author>/<tweak>/`)

Declare the capability and the part versions in `manifest.json`:

```json
{ "capabilities": ["parts", "prefs"], "parts": { "pins": 1 } }
```

`parts` and `prefs` are granted to team authors only. A part version that no longer matches pauses the tweak
before it runs.

## Layouts a tweak can wear

A tweak with the `layout` capability wears a built-in layout (`web/layouts/<id>/`) with `api.layout.use(id)`:
`two-orb` (`wizard/two-orbs`, phone) and `orb` (`miguel/orb-shell`, the Orbs view, desktop only). Switching the tweak
off releases it and the stock shell comes back; a stored layout no live tweak wears goes back to Classic after
tweaks load. Layouts also get the shell's own thread rows, Snooze / Done (Chats' `threadAct`), quick apps, Home and
Settings › Look (`shellApi` in `core/skin-host.js`): see `docs/orb-layout.md`. A layout without desks holds the
**panel** (`api.panel.claim()`): every window then opens in a panel over Home (outside the desks, never synced): a
Chats window in the chat panel, anything else in the app panel on the right, one each, both can be open;
`api.panel.close()` / `back()` / `state()` (`chat`, `app` parts), `api.apps.badges(watch)` (the shell's app counts), `api.route().panel` / `panelApp`; releasing it gives
the desks back untouched. `api.panel.dock(on)` docks the stock Chats list in its own panel on the left for good; a
thread picked in it opens in a column beside it, which closes when the thread is finished (Done, Snooze, a send).
`api.back.push(close)` puts the layout's own popover in the Esc order.

## App inbox feeds (trusted `inbox` capability)

Installed apps can list what needs the owner (`GET /<app>/api/inbox`, inbox feed v1). The shell reads those feeds only
while a package holds `api.inbox.feeds({ on: true, act, keep })`: off, nothing asks an app for a feed and Chats shows no
app buttons (stock). `act(action, id)` sees an app item's buttons first (`app`, `x:<action id>`, `done`, and `keep` when
`keep: true` asks Chats for a quiet "Keep <App> in its app" button on an opened app item) and returns true when it
handled one; the rest go to the inbox threads package. `api.inbox.sources.list()` / `.set(appId, { chats })` read and
save the per-app "show in Chats" choice on the box (Notifications `/api/sources`). A trusted package's toast can carry
one button: `api.toast(words, { action: 'Undo', run })`. Example: `web/tweaks/miguel/inbox`, which imports
`wizard/unified-inbox`'s setup and loads instead of it (catalog `oneOf`: the first member listed loads; Settings shows
the last member's switch, so the shared inbox keeps its name and place).

## Updates (Settings › About & updates)

- **Version**: **Standard** (the official version; `releases/stable`) or **Early access** (newest changes first,
  may be rough; `releases/latest`).
- **Updates**: **Automatic** (overnight when Wizard is quiet, never during a chat; installs Standard only) or
  **Ask me** (nothing installs until the owner taps Install). Install now is always there. A full update takes
  10–20 minutes and Wizard reconnects by itself.
- My skin and tweaks survive both. After an update, a tweak whose part changed pauses with a plain note; the
  owner's Wizard offers to update it.

## Proposing a change for everyone

When an owner likes a tweak and wants it in Standard, their Wizard writes it up (what changes, why, the tweak's
files) and, with their OK, opens it upstream (today: a ready GitHub issue link or a pull request on
`humanitylabs-org/wizard-ux`). Once it ships in Standard, the owner's copy is no longer needed: turn it off.

## Not built yet

- A **Developer mode** switch in Settings. Today a personal build is set up by the owner's Wizard on request
  (the "My release" tooling: merge main, test, build, swap, with an automatic clash resolver).
- A **Propose** button on a tweak and a gallery of everyone's tweaks.
- A list of paused tweaks in Settings; today the pause is a toast and the tweak stays off until it is updated.
