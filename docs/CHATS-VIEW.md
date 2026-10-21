# Chats views — `wizard.chats-view/1`

Chats is an **in-document** provider, not an iframe. Settings, windows/desks,
Back, voice recording, the outbox and the Agent Service connection stay in the shell.
`wizard-chats` is the built-in default: the existing `core/chats.js` renderer and
handlers, without a second implementation or a different DOM tree.

## Provider

An installed module exports this descriptor as its default export:

```js
export default {
  contract: 'wizard.chats-view/1', id: 'miguel-chats', name: 'Miguel Chats',
  mount(el, host) {
    return {
      update() { host.renderDefault(); },
      unmount() { /* release provider-owned resources */ },
    };
  },
};
```

The loader registers admitted modules through `WizChatsHost.register(descriptor)`.
`mount` runs once per region element; `update` runs for navigation/live refresh.
Phone: one region alternates list/thread. Desktop: independent `list` and `main`
regions in the same window, with the **same provider id**. On remount, window
close, failure or provider replacement, `unmount` and host subscription/listener
cleanup run. Do not retain detached DOM nodes or create global shell handlers.
`host.renderDefault()` delegates the current paint to standard Chats; it preserves
its scroll, selection, draft, retry, composer, attachment and agent/privacy logic.
The example `chats-fixture-view.js` replaces the list and reuses standard threads.

## Shell → view: seam map

| Host member | Shell-owned service / rule |
| --- | --- |
| `contract`, `windowId`, `region`, `thread` | Version, stable owning window, `main`/`list`, current thread id (null for list). Desktop's synthetic list id never becomes a voice/send target. |
| `threads` | Current non-hidden sessions from **the same `WizLive`**; no per-provider store. Agent-scoped windows remain on the standard provider in v1. |
| `live` | Existing `WizLive` Agent Service client: `session`, `load`, `onChange`, `markSeen`, groups/Ready and thread actions. Reuse its qualified agent routing/read-state authority. Do not copy its thread/read/Ready state. |
| `outbox` | Existing `WosOutbox`, including durable sends, failures and retries; never a view-specific outbox. |
| `ready()`, `isUnread(session)` | Canonical groups and read state, also used by Home/dock badges. |
| `openThread(id)` | Open inside this provider's owning Chats window; core handles seen state, thread generations and voice/composer binding. |
| `openOnDesk(id, options)` | Shell thread navigation (phone desk / desktop window). Uses the selected default provider. |
| `back()` | Thread → list in this owning window; at list root stays put. Shell owns overlay-first native/browser Back, followed by its existing Chats back steps. Providers must not manipulate browser history. |
| `send(text, …)` | Existing Chats send path for this owning window; preserves pinned model/agent and outbox semantics. |
| `voice()` | Existing shell reply recorder pinned to the owning window/thread, not a provider recorder. New-voice routing remains shell-owned and opens the slot default. |
| `renderDefault()` | Standard renderer at the current list/thread paint point. |
| `element(tag)`, `listen(type, callback)` | DOM construction and region-scoped events; host removes listeners on unmount. Use textContent for user content. |
| `subscribe(callback)` | Shared live changes, automatically unsubscribed on unmount. |
| `onAppearance(callback)` | Shell skin/token changes, automatically disconnected. CSS values are live `--wz-*` aliases to shell skin tokens on `.chats-view`; hosted canvas is transparent. No palettes are copied or changed. |
| `toast(icon, text, ms)` | Plain-words shell notices. |

`live` and `outbox` deliberately reuse the existing clients in v1, not a frozen
new network API. Their records are read-only by convention; use their actions to
write. A later contract can narrow these facades without a second state store.

## View → shell

The shell retains the existing Chats controller methods (`openChat`, `chatsBack`,
`renderChats`, `renderChatList`, `bind`, `click`, `forget`, `threadAct`, composer,
voice and hosted-thread helpers). It calls provider rendering only at the two
shared list/thread paint boundaries. The shell still queries thread/list state,
provides titles/badges, and owns persistence, layout, overlays, agent windows and
all navigation. `forget` tears down both desktop regions. No view renders Settings.
A throwing mount/update/host callback is torn down and replaced by standard Chats,
with a note naming the view. Asynchronous module failure has the same fallback;
a late import cannot mount into a replaced/detached region.

## Installation and selection

Only a **fresh** `GET /wizard/v1/apps` response admits external code. Cached
launcher entries, plain links, `?module=` URLs, and arbitrary registration do not.
The proposed registry shape is:

```json
{
  "apps": [{
    "id": "miguel-chats", "name": "Miguel Chats", "source": "apps.json",
    "url": "/miguel-chats/", "provides": ["chats"],
    "chats_view": {"contract": "wizard.chats-view/1", "module": "view.js"}
  }],
  "slots": {"chats": {"default": "miguel-chats"}}
}
```

`parking: [{slot: "chats", active: "miguel-chats"}]` is also understood. The
module must be same-origin, within that app's non-root URL prefix, and a `.js`
resource without credentials/query/hash. An unavailable default uses `wizard-chats`.
Chats entry points and new voice/deep-link windows use the selected slot default;
existing windows retain their provider. Alternative installed providers appear as
launcher/picker entries. Desktop can open each in a separate tiled window.

**Trust boundary:** this is approved installed code with shell-page privileges,
not a JavaScript sandbox. Providers follow the skin-package banned-API rules
(no fetch/storage/history/global listeners/eval/imports/shell internals); the
example is linted by `tests/chats-view.test.mjs`. App Manager must validate/lint
installed packages before forwarding these fields. Do not expose arbitrary owner
links as `provides: [chats]`.

Development only: `?chatsview=fixture` or `wos.chatsview.fixture=1` enables the
subject-list and throwing fixtures. With opt-in enabled,
`wos.chatsview.default=chats-fixture` chooses the example at next registry refresh.
Without opt-in none of these development providers or overrides is admitted.

## Next increment / App Manager dependencies

- Add `chats` to `wam/defaults.json`: built-in `wizard-chats` is the required
  fallback; support multiple providers rather than replacing the shell app.
- Preserve `provides` plus the versioned `chats_view` descriptor at install,
  registry serialization and Agent Service `/v1/apps` projection. Today that
  projection does not emit this descriptor; this PR defines its consumption,
  **not a claim of a real external installation**.
- Persist and expose `slots.chats.default` / parking active; owner-approved
  default selection UI belongs with App Manager/Store. No shell-local replacement
  for that authority is added (the fixture override is development-only).
- Apply install-time banned-API lint, app-prefix/provenance checks, package review,
  uninstall/revocation handling and integrity pinning before real provider admission.
- Expand the fixture to a fully custom thread renderer only if needed; v1 can
  delegate to the standard thread/composer without duplicating send/voice logic.

## Verification

Run `node --test tests/*.test.mjs`, the existing Chats browser suites, and
`qa-chats-view-slot.cjs` against `tools/qa-origin.cjs`. The new suite refuses **every
non-GET** in the browser; qa-origin independently refuses backend writes. Run
browser suites on Thales with evidence/profile scratch on the external volume.
Keep screenshots private: they contain real conversation labels. See PR evidence
for exact baseline/candidate counts; baseline failures are not parity proof.
