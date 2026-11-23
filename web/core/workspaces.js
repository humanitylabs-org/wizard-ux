/* Saved Wizards, not shell desktops. Native owns its registry; web entries never
 * confer access. Target auth remains authoritative. No polling or idle timers. */
(() => {
  'use strict';
  const KEY = 'wos.workspaces.v1', MAX = 100;
  // The owner's list lives on the box (Agent Service ui-preferences `savedWizards`, wizard-ux issue 1237), so every
  // device signed into this Wizard shows the same switcher. live.js keeps the box list cached in BOX (offline cache)
  // and edits it by item operation (WizLive.prefOps). KEY is only the list from before: uploaded once (MOVED), then
  // left alone. A service without the field never fills BOX, so this device keeps its own list as before.
  const BOX = 'wos.workspaces.box.v1', MOVED = 'wos.workspaces.moved.v1', AUTO = 'wos.workspaces.auto.v1';
  // When this device last reached each saved Wizard, and when it last failed to (wizard-ux#1670): the page can't probe
  // another origin (CSP), so this is what we know: arriving here from it, or the Android app switching to it or not.
  const REACH = 'wos.workspaces.reach.v1', DAY = 864e5, STALE = 30 * DAY;
  const text = (v, n = 120) => typeof v === 'string' ? v.trim().slice(0, n) : '';
  const native = () => window.wizardUX?.native?.workspaces === true;
  function address(value) {
    try {
      const u = new URL(text(value, 2048));
      return ['http:', 'https:'].includes(u.protocol) && u.hostname && !u.username && !u.password ? u.href : '';
    } catch (_) { return ''; }
  }
  function normalize(items) {
    const ids = new Set();
    return (Array.isArray(items) ? items : []).slice(0, MAX).flatMap(v => {
      if (!v || typeof v !== 'object') return [];
      const id = text(v.id); if (!id || ids.has(id)) return []; ids.add(id);
      return [{ id, name: text(v.name) || 'Wizard', url: address(v.url),
        kind: ['this-mac', 'remote', 'company', 'managed'].includes(v.kind) ? v.kind : 'remote',
        status: ['ready', 'starting', 'offline', 'unknown'].includes(v.status) ? v.status : 'unknown',
        subtitle: text(v.subtitle), role: text(v.role), org: text(v.org), source: text(v.source) }];
    });
  }
  let state = { active: 'this', items: [] }, registry = {}, pending = '', handoff = '', handoffTo = '', loading = null, api = null, overlay = null;
  const subscribers = new Set();
  const snapshot = () => ({ active: state.active, items: state.items.map(v => ({ ...v })), pending });
  function accept(value) {
    const items = normalize(value?.items);
    if (!items.length) throw new Error('Couldn’t read your Wizards.');
    state = { active: items.some(i => i.id === value.active) ? value.active : items[0].id, items };
  }
  function notify() {
    for (const fn of subscribers) { try { fn(snapshot()); } catch (_) {} }
    if (overlay?.menu && overlay.signature !== JSON.stringify(state)) openMenu(overlay.anchor, true);
  }
  function publish() { notify(); window.dispatchEvent(new CustomEvent('wizard:workspaces', { detail: snapshot() })); }
  function saved() {
    try {
      const raw = localStorage.getItem(KEY) || '[]'; if (raw.length > 250000) return [];
      return normalize(JSON.parse(raw)).filter(v => v.url).map(v => ({ ...v, kind: 'remote', source: 'local' }));
    } catch (_) { return []; }
  }
  const origin = url => { try { return new URL(url).origin; } catch (_) { return ''; } };
  function reaches() {
    try { const v = JSON.parse(localStorage.getItem(REACH) || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch (_) { return {}; }
  }
  function stamp(url, ok) {
    const at = origin(url); if (!at) return;
    const all = reaches(), cur = all[at] && typeof all[at] === 'object' ? all[at] : {};
    all[at] = { ...cur, [ok ? 'ok' : 'fail']: Date.now() };
    const keep = Object.entries(all).sort((a, b) => Math.max(b[1]?.ok || 0, b[1]?.fail || 0) - Math.max(a[1]?.ok || 0, a[1]?.fail || 0)).slice(0, MAX);
    try { localStorage.setItem(REACH, JSON.stringify(Object.fromEntries(keep))); } catch (_) {}
  }
  const live = () => typeof window.WizLive?.prefOps === 'function' ? window.WizLive : null;
  // null until this box has answered with a savedWizards list (an older Agent Service never does).
  function boxSaved() {
    if (native() || !live()) return null;
    try {
      const raw = localStorage.getItem(BOX); if (raw == null || raw.length > 250000) return null;
      const list = JSON.parse(raw); if (!Array.isArray(list)) return null;
      return normalize(list).filter(v => v.url).map(v => ({ ...v, kind: 'remote', source: 'box' }));
    } catch (_) { return null; }
  }
  const moved = () => { try { return localStorage.getItem(MOVED) === '1'; } catch (_) { return false; } };
  const op = (o, item) => ({ op: o, key: 'savedWizards', item });
  const boxEntry = v => ({ id: v.id, name: v.name, url: v.url });
  // One-time upload of this device's saved Wizards. Adding is a no-op on the box for an id or address it already has,
  // so two devices uploading the same Wizard keep one entry.
  function moveLocal() {
    if (moved() || boxSaved() === null) return;
    const items = saved();
    try { localStorage.setItem(MOVED, '1'); } catch (_) { return; }
    if (items.length) void live().prefOps(items.map(v => op('add', boxEntry(v)))).catch(() => {});
  }
  function persist(items) {
    localStorage.setItem(KEY, JSON.stringify(items.map(({ id, name, url }) => ({ id, name, url, kind: 'remote' }))));
  }
  function merge() {
    const own = { id: 'this', name: text(registry.this?.wizard) || 'This Wizard', url: location.origin, kind: 'remote', status: 'ready', source: 'registry' };
    const managed = (Array.isArray(registry.managed) ? registry.managed : []).slice(0, MAX - 1).map(v => ({ ...v, kind: v.kind === 'company' ? 'company' : v.kind === 'remote' ? 'remote' : 'managed', source: 'registry' }));
    const entries = normalize([own, ...managed]);
    const urls = new Set(entries.filter(v => v.url).map(v => v.url));
    const origins = new Set(entries.filter(v => v.url).map(v => new URL(v.url).origin));
    const box = boxSaved();
    for (const v of box === null ? saved() : moved() ? box : [...box, ...saved()]) if (!entries.some(i => i.id === v.id) && !urls.has(v.url) && !origins.has(new URL(v.url).origin) && entries.length < MAX) { entries.push(v); urls.add(v.url); origins.add(new URL(v.url).origin); }
    accept({ active: 'this', items: entries });
  }
  function ingest(devices) { if (!native() && devices && typeof devices === 'object') { registry = devices; nameForApp(); if (!pending) { merge(); publish(); } } }
  async function list() {
    if (loading) return loading;
    loading = (async () => {
      if (native()) { const result = await window.WizCore.bridge.call('workspaces.list', {}); if (!pending) { accept(result); notify(); } }
      else {
        const cached = window.WosResources?.state?.devices;
        if (cached) registry = cached;
        else {
          try {
            const r = await fetch('/api/system/devices', { method: 'GET', credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000) });
            if (r.ok) { const j = await r.json(); if (j && typeof j === 'object') registry = j; }
          } catch (_) { /* local entries and this Wizard remain usable offline */ }
        }
        nameForApp(); settle();
        if (!pending) { merge(); publish(); }
      }
      return snapshot();
    })().finally(() => { loading = null; });
    return loading;
  }
  function subscribe(fn) {
    if (typeof fn !== 'function' || subscribers.size >= MAX) throw new Error('Too many workspace viewers.');
    subscribers.add(fn); fn(snapshot()); return () => subscribers.delete(fn);
  }
  const subtitle = v => [v.org, v.role === 'technical-admin' ? 'Technical Admin' : v.role === 'owner' ? 'Owner' : v.role === 'member' ? 'Member' : '', v.subtitle || (v.kind === 'this-mac' ? 'This Mac' : v.kind === 'company' ? 'Company Wizard' : '')].filter(Boolean).join(' · ');
  function groups(items = state.items) {
    const mine = items.filter(v => v.kind !== 'managed'), managed = items.filter(v => v.kind === 'managed');
    if (!mine.length || !managed.length) return [{ label: '', items }];
    const out = [{ label: 'My Wizards', items: mine }];
    for (const item of managed) {
      const label = item.org ? `Managed · ${item.org}` : 'Managed';
      let g = out.find(v => v.label === label); if (!g) out.push(g = { label, items: [] }); g.items.push(item);
    }
    return out;
  }
  // Only origin URLs inherit the shell path. An explicitly supplied path stays at
  // its own root, never receives a chat id/query from the current Wizard.
  function destination(value) {
    const u = new URL(address(value) || (() => { throw new Error('Use an http:// or https:// address.'); })());
    if (u.pathname === '/' && !u.search && !u.hash) u.pathname = location.pathname;
    return u.href;
  }
  // A saved Wizard lives in one origin's localStorage, so the Wizard we navigate to cannot see it. Carry a
  // safe way back in the URL hash (name + address only, no access); the target saves it once and strips it.
  const FROM = 'wzfrom=';
  function withReturn(url) {
    if (native()) return url;
    const u = new URL(url); if (u.hash) return url;
    const here = text(registry.this?.wizard) || location.hostname.split('.')[0] || 'Wizard';
    u.hash = FROM + encodeURIComponent(JSON.stringify({ name: text(here, 60), url: location.origin + location.pathname }));
    return u.href;
  }
  function adoptReturn() {
    try {
      if (native() || !location.hash.startsWith('#' + FROM)) return;
      const r = JSON.parse(decodeURIComponent(location.hash.slice(1 + FROM.length)));
      history.replaceState(history.state, '', location.pathname + location.search);
      const url = address(r?.url), name = text(r?.name, 60) || 'Wizard';
      if (!url || new URL(url).origin === location.origin) return;
      arrived = { name, url }; stamp(url, true);
    } catch (_) { /* a malformed hash is ignored */ }
  }
  // Save a Wizard this device has been on (the one we came from, or one the Android app connected to) once, without
  // asking: the owner never has to know or type its address. In the shared list when this box has one.
  function remember(url, name) {
    url = address(url); name = text(name, 60) || 'Wizard';
    if (!url || origin(url) === location.origin) return false;
    const box = boxSaved(), mine = box === null ? saved() : [...box, ...(moved() ? [] : saved())];
    if (mine.some(v => origin(v.url) === origin(url)) || state.items.some(v => v.url && origin(v.url) === origin(url))) return false;
    const id = 'from-' + new URL(url).host.replace(/[^a-z0-9.-]/gi, '-').slice(0, 60);
    if (box === null) persist([...saved(), { id, name, url, kind: 'remote' }].slice(-MAX));
    else void live().prefOps([op('add', { id, name, url })]).catch(() => {});
    return true;
  }
  let arrived = null;
  adoptReturn();
  // The Android app remembers the Wizards it was connected to through Change Wizard (address and name). Each one is
  // added once per device; a Wizard the owner forgets afterwards stays forgotten.
  const droid = () => window.WizardOSNative;
  function fromApp() {
    const app = droid(); if (native() || typeof app?.knownWizards !== 'function') return;
    let known = [], done = [];
    try { known = JSON.parse(app.knownWizards() || '[]'); } catch (_) { return; }
    try { done = JSON.parse(localStorage.getItem(AUTO) || '[]'); if (!Array.isArray(done)) done = []; } catch (_) { done = []; }
    const before = done.length;
    for (const k of Array.isArray(known) ? known.slice(0, 20) : []) {
      const url = address(k?.url), at = origin(url); if (!url || at === location.origin || done.includes(at)) continue;
      remember(url, text(k?.name, 60) || new URL(url).hostname.split('.')[0]); done.push(at);
    }
    if (done.length !== before) try { localStorage.setItem(AUTO, JSON.stringify(done.slice(-MAX))); } catch (_) {}
  }
  // Tell the app this Wizard's name, so another Wizard can list it by name after a Change Wizard.
  function nameForApp() {
    const name = text(registry.this?.wizard, 60), app = droid();
    if (name && !native() && typeof app?.nameThisWizard === 'function') try { app.nameThisWizard(name); } catch (_) {}
  }
  // Runs whenever the lists may have changed (load, box answer, resources): upload once, add arrivals, then show.
  let settling = false;
  function settle() {
    if (settling) return; settling = true;
    try { moveLocal(); if (arrived) { remember(arrived.url, arrived.name); arrived = null; } fromApp(); } finally { settling = false; }
  }
  const toast = message => api?.toast(message);
  // The Android app could not switch (it says why itself): show the Wizard that is still open as the active one.
  function switchFailed() { if (!handoff) return; stamp(handoffTo, false); state.active = handoff; handoff = handoffTo = ''; notify(); }
  // The app checked the other Wizard answers before it reopens on it: this page going away mid-switch means it did.
  window.addEventListener('pagehide', () => { if (handoff && handoffTo) stamp(handoffTo, true); });
  function close() {
    if (!overlay) return false;
    const old = overlay; overlay = null; old.release?.(); old.abort.abort(); old.root.remove();
    old.anchor?.setAttribute('aria-expanded', 'false'); old.anchor?.focus?.({ preventScroll: true }); return true;
  }
  async function switchTo(id) {
    if (pending) throw new Error('A Wizard is already opening.');
    const item = state.items.find(v => v.id === id); if (!item) throw new Error('Wizard not found.');
    if (!native() && !item.url) throw new Error(`${item.name} isn’t running Wizard yet, so there’s nothing to switch to.`);
    if (state.active === id) { close(); return { ok: true }; }
    const previous = state.active;
    // Same click task, before any bridge call/await: retained row is busy+active,
    // control answers, overlay is gone. Rollback preserves the original Wizard.
    pending = id; state.active = id;
    const row = overlay?.root.querySelector('[data-workspace-id="' + CSS.escape(id) + '"]');
    row?.setAttribute('aria-busy', 'true'); row?.setAttribute('aria-checked', 'true');
    close(); notify();
    try {
      if (native()) {
        const result = await window.WizCore.bridge.call('workspaces.switch', { id });
        if (result?.ok !== true) throw new Error('Couldn’t open that Wizard.');
      } else {
        const dest = destination(item.url), droid = window.WizardOSNative;
        // The Android app owns one Wizard at a time: ask it to switch inside the app. Navigating its WebView to
        // another origin would be handed to the phone's browser. It answers "refused" for anything it won't switch to.
        if (typeof droid?.switchWizard === 'function' && droid.switchWizard(new URL(dest).origin) === 'started') { handoff = previous; handoffTo = dest; }
        else location.assign(withReturn(dest));
      }
      return { ok: true };
    } catch (error) { state.active = previous; toast('Couldn’t open that Wizard. Please try again.'); throw error; }
    finally { pending = ''; notify(); }
  }
  // A new address for a saved Wizard: a valid one that no other entry already uses.
  function moveTo(params) {
    const url = address(params.url);
    if (!url) throw new Error('Use an http:// or https:// address, without a password.');
    if (state.items.some(v => v.id !== params.id && v.url && origin(v.url) === origin(url))) throw new Error('That Wizard is already in your list.');
    return url;
  }
  // Undo of a remove puts the same entry back, unless it (or its address) came back meanwhile.
  function restorable(params, list) {
    const url = address(params.url), name = text(params.name) || 'Wizard', id = text(params.id);
    if (!url || !id) throw new Error('Couldn’t put that Wizard back.');
    if (list.some(v => v.id === id) || state.items.some(v => v.url && origin(v.url) === origin(url))) return null;
    return { id, name, url };
  }
  async function mutate(action, params) {
    if (pending) throw new Error('Please wait for your Wizard to open.');
    if (native()) {
      if (action === 'address' || action === 'restore') throw new Error('Change this Wizard in the app that owns the list.');
      const result = await window.WizCore.bridge.call('workspaces.' + action, params);
      if (result?.ok !== true) throw new Error('Couldn’t save that change.');
      await list(); return result;
    }
    const box = boxSaved();
    if (box !== null) {
      moveLocal();
      const all = moved() ? box : [...box, ...saved()];
      let ops;
      if (action === 'add') {
        const url = address(params.url), name = text(params.name);
        if (!url) throw new Error('Use an http:// or https:// address, without a password.');
        if (!name) throw new Error('Give this Wizard a name.');
        if (state.items.length >= MAX) throw new Error('Your Wizard list is full. Remove one first.');
        if (state.items.some(v => v.url === url) || all.some(v => origin(v.url) === origin(url))) throw new Error('That Wizard is already in your list.');
        ops = [op('add', { id: 'remote-' + crypto.randomUUID(), name, url })];
      } else if (action === 'restore') {
        const back = restorable(params, all); if (!back) return { ok: true };
        ops = [op('add', back)];
      } else {
        if (!all.some(v => v.id === params.id)) throw new Error('Manage this entry on the computer that owns the list.');
        if (action === 'rename') { const name = text(params.name); if (!name) throw new Error('Give this Wizard a name.'); ops = [{ op: 'set', key: 'savedWizards/' + params.id + '/name', item: name }]; }
        else if (action === 'address') {
          const url = moveTo(params), was = all.find(v => v.id === params.id);
          // The box has no per-field address edit: the same entry (id and name) goes out and back in with the new address.
          ops = [op('remove', params.id), op('add', { id: params.id, name: was.name, url })];
        } else ops = [op('remove', params.id)];
      }
      // Shown at once from the cached list; the box applies the same operation (queued while offline).
      void live().prefOps(ops).catch(() => {});
      merge(); publish(); return { ok: true };
    }
    const items = saved();
    if (action === 'add') {
      const url = address(params.url), name = text(params.name);
      if (!url) throw new Error('Use an http:// or https:// address, without a password.');
      if (!name) throw new Error('Give this Wizard a name.');
      if (state.items.length >= MAX) throw new Error('Your Wizard list is full. Remove one first.');
      if (state.items.some(v => v.url === url)) throw new Error('That Wizard is already in your list.');
      items.push({ id: 'remote-' + crypto.randomUUID(), name, url, kind: 'remote' });
    } else if (action === 'restore') {
      const back = restorable(params, items); if (!back) return { ok: true };
      items.push({ ...back, kind: 'remote' });
    } else {
      const i = items.findIndex(v => v.id === params.id);
      if (i < 0) throw new Error('Manage this entry on the computer that owns the list.');
      if (action === 'rename') { const name = text(params.name); if (!name) throw new Error('Give this Wizard a name.'); items[i].name = name; }
      if (action === 'address') items[i].url = moveTo(params);
      if (action === 'remove') items.splice(i, 1);
    }
    persist(items); merge(); publish(); return { ok: true };
  }
  function remove(id) {
    if (state.items.length <= 1) return Promise.reject(new Error('Keep at least one Wizard.'));
    if (!state.items.some(v => v.id === id)) return Promise.reject(new Error('Wizard not found.'));
    return mutate('remove', { id });
  }
  const el = (tag, cls, value) => { const n = document.createElement(tag); if (cls) n.className = cls; if (value) n.textContent = value; return n; };
  function layer(anchor, label, sheet = false) {
    close();
    const root = el('div', 'wz-workspaces-layer'), panel = el('section', 'wz-workspaces-panel' + (sheet ? ' is-sheet' : ''));
    panel.setAttribute('role', sheet ? 'dialog' : 'menu'); panel.setAttribute('aria-label', label);
    if (sheet) panel.setAttribute('aria-modal', 'true');
    const abort = new AbortController();
    root.append(panel); document.body.append(root);
    overlay = { root, panel, abort, anchor, release: api?.back.push(close) };
    anchor?.setAttribute('aria-expanded', 'true');
    let outside = false;
    root.addEventListener('pointerdown', e => { outside = e.target === root; }, { signal: abort.signal });
    root.addEventListener('click', e => { if (e.target === root && (outside || e.detail === 0)) { e.stopPropagation(); close(); } }, { signal: abort.signal });
    // Only the anchored menu goes stale on resize. The centred sheet stays: on a phone, focusing its
    // address field raises the keyboard, which resizes the WebView (wizard-ux#1640).
    if (!sheet) {
      window.addEventListener('resize', close, { signal: abort.signal });
      const r = anchor?.getBoundingClientRect();
      panel.style.top = Math.max(8, r ? r.bottom + 6 : 56) + 'px';
      panel.style.left = Math.max(8, Math.min(r?.left || 8, window.innerWidth - Math.min(340, window.innerWidth - 16) - 8)) + 'px';
    }
    panel.addEventListener('keydown', e => {
      if (e.key === 'Tab') {
        const controls = [...panel.querySelectorAll('button,input')].filter(n => !n.disabled);
        const first = controls[0], last = controls.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
        return;
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) || sheet) return;
      e.preventDefault(); const bs = [...panel.querySelectorAll('button')], at = bs.indexOf(document.activeElement);
      bs[e.key === 'Home' ? 0 : e.key === 'End' ? bs.length - 1 : (at + (e.key === 'ArrowUp' ? -1 : 1) + bs.length) % bs.length]?.focus();
    }, { signal: abort.signal });
    return panel;
  }
  function openMenu(anchor, refresh = false) {
    if (!refresh && overlay?.anchor === anchor) { close(); return; }
    const panel = layer(anchor, 'Wizards'); overlay.menu = true; overlay.signature = JSON.stringify(state);
    for (const group of groups()) {
      if (group.label) panel.append(el('h3', 'wz-workspaces-heading', group.label));
      for (const v of group.items) {
        const b = el('button', 'wz-workspaces-item'); b.type = 'button'; b.dataset.workspaceId = v.id;
        b.setAttribute('role', 'menuitemradio'); b.setAttribute('aria-checked', String(v.id === state.active));
        const unavailable = !native() && !v.url;
        if (unavailable) { b.classList.add('is-off'); b.setAttribute('aria-disabled', 'true'); }
        const dot = el('i', 'wz-workspaces-dot'); dot.dataset.status = v.status; dot.title = v.status;
        const words = el('span', 'wz-workspaces-words'); words.append(el('b', '', v.name), el('small', '', [subtitle(v), unavailable ? 'Not connected' : v.status === 'unknown' ? '' : v.status].filter(Boolean).join(' · ')));
        b.append(dot, words, el('span', 'wz-workspaces-check', v.id === state.active ? '✓' : ''));
        b.addEventListener('click', () => {
          if (unavailable) {
            let why = panel.querySelector('.wz-workspaces-why'); if (!why) { why = el('p', 'wz-workspaces-why'); panel.append(why); }
            why.textContent = `${v.name} isn’t running Wizard yet, so there’s nothing to switch to. Once it is, switching swaps everything (apps, chats, agents) for that workspace’s own. The apps will switch in place; a browser opens its address.`;
          } else void switchTo(v.id).catch(() => {});
        }); panel.append(b);
      }
    }
    const add = el('button', 'wz-workspaces-add', '+ Add a Wizard'); add.type = 'button'; add.setAttribute('role', 'menuitem');
    add.addEventListener('click', () => { close(); void addWizard().catch(e => toast(e.message)); }); panel.append(add);
    const man = el('button', 'wz-workspaces-add wz-workspaces-manage', 'Manage Wizards'); man.type = 'button'; man.setAttribute('role', 'menuitem');
    man.addEventListener('click', manage); panel.append(man);
    panel.querySelector('button')?.focus({ preventScroll: true });
  }
  // One small form sheet for Add a Wizard, Rename and Change address: the same layer, fields, error line and footer.
  function formSheet({ title, intro, fields, button, run, focus = fields[0].name }) {
    const panel = layer(null, title, true), form = el('form'); form.noValidate = true;
    panel.append(el('h2', '', title), el('p', '', intro));
    const inputs = {};
    for (const f of fields) {
      const l = el('label', '', f.label), input = el('input'); input.name = f.name; input.type = f.type; input.required = true; input.maxLength = f.name === 'url' ? 2048 : 120;
      if (f.value) input.value = f.value;
      l.append(input); form.append(l); inputs[f.name] = input;
    }
    const error = el('p', 'wz-workspaces-error'); error.setAttribute('role', 'alert'); form.append(error);
    const footer = el('div', 'wz-workspaces-footer'), cancel = el('button', '', 'Cancel'), save = el('button', '', button);
    cancel.type = 'button'; save.type = 'submit'; cancel.addEventListener('click', close); footer.append(cancel, save); form.append(footer); panel.append(form);
    form.addEventListener('submit', async e => {
      e.preventDefault(); error.textContent = ''; save.disabled = true; save.setAttribute('aria-busy', 'true');
      try { await run(Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, v.value]))); close(); }
      catch (e) { error.textContent = e.message; save.disabled = false; save.removeAttribute('aria-busy'); }
    }); inputs[focus]?.focus();
    return panel;
  }
  function addSheet() {
    formSheet({ title: 'Add a Wizard', intro: 'Connect to a Wizard on another computer. Use its address on your private network, including http:// or https://. Keep Tailscale connected if that computer uses it.',
      fields: [{ label: 'Wizard address', name: 'url', type: 'url' }, { label: 'Name', name: 'name', type: 'text' }], button: 'Add a Wizard', run: v => mutate('add', v) });
  }
  // Settings › Connections › Wizards (wizard-ux#1670): every saved Wizard, with Rename, Change address and Remove.
  const find = id => state.items.find(v => v.id === id);
  function renameWizard(id) {
    const v = find(id); if (!v) return;
    formSheet({ title: 'Rename', intro: 'The name this Wizard shows in your switcher and here.', fields: [{ label: 'Name', name: 'name', type: 'text', value: v.name }], button: 'Save', run: x => mutate('rename', { id, name: x.name }) });
  }
  function moveWizard(id) {
    const v = find(id); if (!v) return;
    formSheet({ title: `Change address of ${v.name}`, intro: 'Its new address on your private network, including http:// or https://. Use this when that Wizard was reinstalled or moved and now answers somewhere else.',
      fields: [{ label: 'Wizard address', name: 'url', type: 'url', value: v.url }], button: 'Save', run: x => mutate('address', { id, url: x.url }) });
  }
  // One tap removes; Undo (about six seconds) puts the same entry back.
  let undoEl = null;
  function dropUndo() { undoEl?.remove(); undoEl = null; }
  async function removeWizard(id) {
    const v = find(id); if (!v) return;
    const back = { id: v.id, name: v.name, url: v.url };
    await remove(id);
    dropUndo(); if (native()) { toast(`Removed ${v.name}`); return; }
    const bar = undoEl = el('div', 'wz-workspaces-undo'); bar.setAttribute('role', 'status');
    const undo = el('button', '', 'Undo'); undo.type = 'button';
    bar.append(el('span', '', `Removed ${v.name}`), undo); document.body.append(bar);
    undo.addEventListener('click', () => { dropUndo(); void mutate('restore', back).catch(e => toast(e.message)); });
    setTimeout(() => { if (undoEl === bar) dropUndo(); }, 6000);
    undo.focus?.({ preventScroll: true });
  }
  const editable = v => v.id !== 'this' && v.id !== state.active && (native() ? v.kind !== 'managed' : v.source === 'box' || v.source === 'local');
  function when(t) {
    const days = Math.floor((Date.now() - t) / DAY);
    return days < 1 ? 'today' : days < 2 ? 'yesterday' : days < 30 ? `${days} days ago` : new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }
  // What this device knows about reaching it; stale = it failed last, or was last reached over 30 days ago.
  function reach(v) {
    if (v.id === 'this') return { text: 'You’re on this Wizard', stale: false };
    if (!native() && !v.url) return { text: 'Not connected', stale: true };
    if (v.source === 'registry' || native()) return { text: v.status === 'unknown' ? '' : v.status === 'ready' ? 'Online' : v.status === 'offline' ? 'Offline' : 'Starting', stale: v.status === 'offline' };
    const r = reaches()[origin(v.url)] || {}, ok = Number(r.ok) || 0, fail = Number(r.fail) || 0;
    if (fail > ok) return { text: `Unreachable · couldn’t reach it ${when(fail)}${ok ? `, last reached ${when(ok)}` : ''}`, stale: true };
    if (ok && Date.now() - ok > STALE) return { text: `Unreachable for a long time · last reached ${when(ok)}`, stale: true };
    if (ok) return { text: `Last reached ${when(ok)}`, stale: false };
    return { text: 'Not reached from this device yet', stale: false };
  }
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const hostOf = url => { try { return new URL(url).host; } catch (_) { return ''; } };
  function settingsHtml() {
    const rows = state.items.map(v => {
      const r = reach(v), small = [hostOf(v.url), subtitle(v), r.text].filter(Boolean).join(' · '), id = esc(v.id);
      const acts = editable(v) ? `<div class="ub-a wz-saved-acts"><button type="button" data-wizard-rename="${id}">Rename</button>${native() ? '' : `<button type="button" data-wizard-address="${id}">Change address</button>`}<button type="button" class="ghost" data-wizard-remove="${id}">Remove</button></div>` : '';
      return `<div class="st-row static wz-saved${r.stale ? ' is-stale' : ''}" data-saved-wizard="${id}"><span class="st-tx"><b>${esc(v.name)}</b><small>${esc(small)}</small>${acts}</span></div>`;
    }).join('');
    return `<div class="st-group"><h4>Wizards</h4>${state.items.length > 1 ? rows : ''}<button class="st-row" type="button" data-workspaces-add><span class="st-tx"><b>Add a Wizard</b><small>Connect to a Wizard on another computer.</small></span></button></div>`;
  }
  function settingsAct(el) {
    const add = el.closest('[data-workspaces-add]'), ren = el.closest('[data-wizard-rename]'), mv = el.closest('[data-wizard-address]'), rm = el.closest('[data-wizard-remove]');
    if (add) void addWizard().catch(e => toast(e.message));
    else if (ren) renameWizard(ren.dataset.wizardRename);
    else if (mv) moveWizard(mv.dataset.wizardAddress);
    else if (rm) void removeWizard(rm.dataset.wizardRemove).catch(e => toast(e.message));
    else return false;
    return true;
  }
  // The switcher's Manage Wizards: the Settings section above, through the shell's own deep link (both shells).
  function manage() {
    close();
    const href = location.origin + location.pathname + '?view=saved-wizards';
    if (!window.WizCore?.deeplink?.route?.(href)) toast('Open Settings › Connections to manage your Wizards.');
  }
  function addWizard(params) {
    if (params) return mutate('add', params);
    close(); if (native()) return mutate('add', {});
    addSheet(); return Promise.resolve({ ok: true });
  }
  const W = window.WizWorkspaces = { list, snapshot, subscribe, switch: switchTo, add: addWizard,
    rename: (id, name) => mutate('rename', { id, name }), move: (id, url) => mutate('address', { id, url }), restore: item => mutate('restore', item), remove, switchFailed, manage, groups, subtitle, address, destination, openMenu, close, ingest,
    get visible() { return state.items.length >= 2; } };
  settle(); merge();
  // live.js announces every change to the cached box preferences (a pull from the box, or an edit on this device).
  window.addEventListener('wos:prefs', () => { if (!native() && !pending) { settle(); merge(); publish(); } });
  window.addEventListener('wizard:workspaces', e => { if (native()) { try { accept(e.detail); notify(); } catch (_) {} } });
  // Another tab of this Wizard changed the device list or the cached box list.
  window.addEventListener('storage', e => { if (!native() && (e.key === KEY || e.key === BOX) && !pending) { settle(); merge(); publish(); } });
  window.addEventListener('wos:resources', () => ingest(window.WosResources?.state?.devices));
  window.WosSkinHost?.builtin('workspaces', host => {
    api = host;
    const button = el('button', 'wz-workspaces-control'); button.type = 'button'; button.setAttribute('aria-haspopup', 'menu'); button.setAttribute('aria-expanded', 'false');
    // Stacked layers; one compact icon, never a name label.
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    for (const d of ['M12 3 3 7.5l9 4.5 9-4.5L12 3Z', 'm3 12 9 4.5 9-4.5', 'm3 16.5 9 4.5 9-4.5']) { const p = document.createElementNS(svg.namespaceURI, 'path'); p.setAttribute('d', d); svg.append(p); } button.append(svg);
    const desktop = host.env.shell === 'desktop';
    if (desktop) document.querySelector('[data-slot="bar-start"]')?.append(button); else host.mount(button);
    const paint = () => {
      const route = host.route(), current = state.items.find(v => v.id === state.active);
      button.hidden = !W.visible || (!desktop && !(route.view === 'list' || (route.view === 'desk' && route.desk === 0)));
      if (!desktop) {
        const head = route.view === 'list' ? [...document.querySelectorAll('[data-part="list"] .ch-top')].find(n => n.getClientRects().length) : null;
        button.classList.toggle('in-chats', !!head);
        if (head && button.parentNode !== head) head.prepend(button);
        else if (!head && button.parentNode !== document.getElementById('device')) host.mount(button);
      }
      document.documentElement.toggleAttribute('data-workspace-control', !button.hidden && !desktop);
      button.title = `Wizard: ${current?.name || 'This Wizard'}`;
      button.setAttribute('aria-label', `Wizard: ${current?.name || 'This Wizard'}. Switch Wizard`);
      button.setAttribute('aria-busy', String(!!pending));
      // One Wizard hides the switcher, so its menu goes; the Add a Wizard sheet stays (that is how a second one is added).
      if (!W.visible && overlay?.menu) close();
    };
    const off = subscribe(paint); host.listen(button, 'click', () => openMenu(button));
    host.on('route', paint); host.on('home', paint); host.on('render', paint);
    void list().catch(e => toast(e.message));
    return () => { off(); close(); button.remove(); api = null; document.documentElement.removeAttribute('data-workspace-control'); };
  }, { when: 'always', label: 'Wizard switcher', capabilities: ['layout'] });
  window.WosSettings?.register({ id: 'saved-wizards', page: 'connections', order: 90, aliases: ['saved-wizards', 'wizards'],
    html: settingsHtml, act: (_ctx, el) => settingsAct(el) });
  // The list changed (an edit here, another device, the box): repaint this section in place. Settings › Connections
  // holds back whole-page repaints while its embedded Connections frame is open, so a refresh alone would not show it.
  const painted = new WeakMap();
  subscribe(() => {
    const html = settingsHtml();
    for (const n of globalThis.document?.querySelectorAll?.('[data-settings-feature="saved-wizards"]') || []) if (painted.get(n) !== html) { n.innerHTML = html; painted.set(n, html); }
  });
})();
