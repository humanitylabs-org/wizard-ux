# Saved Wizards (v1)

`WizWorkspaces` (`web/core/workspaces.js`) is the only saved-Wizard registry client and switcher. This is unrelated to shell desks (`workspace-navigation.js`). Each Wizard owns its own chats, apps, agents and authentication; lists and data are never merged across Wizards.

## Native

Capability: `window.wizardUX.native?.workspaces === true`, injected before scripts run and preserved by `WizCore.bridge.handle`.

Via `WizCore.bridge.call`:

- `workspaces.list {}` → `{active, items:[{id,name,kind,url,status,subtitle?}]}`.
- `workspaces.switch {id}` → `{ok:true}`. Native swaps the shown page and preserves the old page/drafts.
- `workspaces.add {}` → `{ok:true}`. Native owns the add flow.
- `workspaces.rename {id,name}`, `workspaces.remove {id}` → `{ok:true}`. Forgetting never deletes a VM or data; last removal is refused.
- `wizard:workspaces` on `window`, `detail: {active,items}`, refreshes the page on add/switch/rename/remove/status.

Kinds: `this-mac`, `remote`, `company`, `managed`. Status: `ready`, `starting`, `offline`, `unknown`. Roles (`owner`, `technical-admin`, `member`) only label entries; target authentication decides access.

When capability is present the module never falls back to a different saved registry after a native failure.

## Browser / phone / PWA

One read of `/api/system/devices` obtains this box's `devices.json` registry. Existing `WosResources` readings refresh it without another polling loop. Merge order: this Wizard, registry `managed[]`, local entries from `localStorage['wos.workspaces.v1']`. Saved entries contain `{id,name,url,kind:'remote'}` only. Lists and subscriptions cap at 100; text is bounded and rendered as text, not HTML. Corrupt/oversized saved lists are ignored. URLs require HTTP(S), without credentials; private hostnames and ports work.

Registry entries may supply `url`, `kind:'company'|'managed'|'remote'` (`remote` = another Wizard of the same owner, listed under My Wizards; no kind means managed), `role`, and `org`. Entries without an address retain “isn’t running Wizard yet” and are not switchable. `tools/system-devices.mjs` preserves these optional fields on the read path. The installed Agent Service must likewise preserve them; an old service that strips them will honestly show those entries as not connected.

In the Android app, switching asks the app first (`WizardOSNative.switchWizard` → `WizardSwitch`: same-tailnet https only; it probes, saves the new address and reopens inside the app, with Back to your previous Wizard in Connect); if the app refuses or is absent, the browser fallback below applies. Switching uses same-window navigation. A target origin inherits the current shell pathname, never the current query/hash or thread id. An explicit target path remains its own root. `add({url,name})` validates/persists; `add()` opens the URL + name sheet. `rename(id,name)` and `remove(id)` change only locally saved entries. Registry entries remain owned by their registry, not silently overridden on this device.

## UX and lifecycle

The stock control is hidden at one Wizard; at two or more it is an icon in desktop `bar-start` and the phone Home/Chats header. The name is only in its tooltip/accessibility label and menu. Group headings appear only when both My Wizards and Managed exist. Managed organizations are separate headings. Settings → Connections → Add a Wizard is reachable even with one entry; Miguel's Settings → Your network + delegates to the same add flow. His network Home remains his own tweak.

A switch updates active/busy and closes the overlay synchronously before any bridge await; failure restores the previous active Wizard and toasts. An actual scrim catches taps above hosted frames. Menus and sheets use `api.back.push`; shell Back/Esc closes them before underlying navigation and never exits. `--wz-*` roles restyle live and `--wz-panel` is opaque. Standalone consumers load shared `kit/wizard-tokens.css` for dark defaults.

The module has no poll/interval/idle timeout or mutation observer. Three fixed window listeners consume native, storage and already-existing resource events. Per-overlay listeners are AbortController-owned and released on close. The built-in has one subscription and route/render/home handlers owned by `WosSkinHost`; Miguel unsubscribes on teardown.

AI apps view (desktop default): the bar's start slot is the top row over the chat title, so the stock icon is hidden there. With the sidebar showing, its header name (Archimedes ⌄) is the switcher; on the collapsed rail a layers button (`.aad-rws`, two or more Wizards only) opens the same shared menu. Full-screen chat hides both on purpose. ⌥O opens the same menu as the header name, and its own list's Manage workspaces opens Settings › Connections.

Regression checks: `tests/workspaces.test.mjs`, `tests/james-default-home.test.mjs`, `tests/miguel-machines-home.test.mjs`, `qa-workspaces.cjs`. Browser QA uses synthetic fixtures, intercepts all writes, and asserts no `/v1/runs` attempt.
