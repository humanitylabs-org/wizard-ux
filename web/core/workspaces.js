/* Saved Wizards, not shell desktops. Native owns its registry; web entries never
 * confer access. Target auth remains authoritative. No polling or idle timers. */
(() => {
  'use strict';
  const KEY = 'wos.workspaces.v1', MAX = 100;
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
  let state = { active: 'this', items: [] }, registry = {}, pending = '', handoff = '', loading = null, api = null, overlay = null;
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
  function persist(items) {
    localStorage.setItem(KEY, JSON.stringify(items.map(({ id, name, url }) => ({ id, name, url, kind: 'remote' }))));
  }
  function merge() {
    const own = { id: 'this', name: text(registry.this?.wizard) || 'This Wizard', url: location.origin, kind: 'remote', status: 'ready', source: 'registry' };
    const managed = (Array.isArray(registry.managed) ? registry.managed : []).slice(0, MAX - 1).map(v => ({ ...v, kind: v.kind === 'company' ? 'company' : v.kind === 'remote' ? 'remote' : 'managed', source: 'registry' }));
    const entries = normalize([own, ...managed]);
    const urls = new Set(entries.filter(v => v.url).map(v => v.url));
    const origins = new Set(entries.filter(v => v.url).map(v => new URL(v.url).origin));
    for (const v of saved()) if (!entries.some(i => i.id === v.id) && !urls.has(v.url) && !origins.has(new URL(v.url).origin) && entries.length < MAX) { entries.push(v); urls.add(v.url); origins.add(new URL(v.url).origin); }
    accept({ active: 'this', items: entries });
  }
  function ingest(devices) { if (!native() && devices && typeof devices === 'object') { registry = devices; if (!pending) { merge(); publish(); } } }
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
      const items = saved(); if (items.some(v => new URL(v.url).origin === new URL(url).origin)) return;
      const id = 'from-' + new URL(url).host.replace(/[^a-z0-9.-]/gi, '-').slice(0, 60);
      persist([...items, { id, name, url, kind: 'remote' }].slice(-MAX));
    } catch (_) { /* a malformed hash is ignored */ }
  }
  adoptReturn();
  const toast = message => api?.toast(message);
  // The Android app could not switch (it says why itself): show the Wizard that is still open as the active one.
  function switchFailed() { if (!handoff) return; state.active = handoff; handoff = ''; notify(); }
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
        if (typeof droid?.switchWizard === 'function' && droid.switchWizard(new URL(dest).origin) === 'started') handoff = previous;
        else location.assign(withReturn(dest));
      }
      return { ok: true };
    } catch (error) { state.active = previous; toast('Couldn’t open that Wizard. Please try again.'); throw error; }
    finally { pending = ''; notify(); }
  }
  async function mutate(action, params) {
    if (pending) throw new Error('Please wait for your Wizard to open.');
    if (native()) {
      const result = await window.WizCore.bridge.call('workspaces.' + action, params);
      if (result?.ok !== true) throw new Error('Couldn’t save that change.');
      await list(); return result;
    }
    const items = saved();
    if (action === 'add') {
      const url = address(params.url), name = text(params.name);
      if (!url) throw new Error('Use an http:// or https:// address, without a password.');
      if (!name) throw new Error('Give this Wizard a name.');
      if (state.items.length >= MAX) throw new Error('Your Wizard list is full. Remove one first.');
      if (state.items.some(v => v.url === url)) throw new Error('That Wizard is already in your list.');
      items.push({ id: 'remote-' + crypto.randomUUID(), name, url, kind: 'remote' });
    } else {
      const i = items.findIndex(v => v.id === params.id);
      if (i < 0) throw new Error('Manage this entry on the computer that owns the list.');
      if (action === 'rename') { const name = text(params.name); if (!name) throw new Error('Give this Wizard a name.'); items[i].name = name; }
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
    window.addEventListener('resize', close, { signal: abort.signal });
    if (!sheet) {
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
    panel.querySelector('button')?.focus({ preventScroll: true });
  }
  function addSheet() {
    const panel = layer(null, 'Add a Wizard', true), form = el('form'); form.noValidate = true;
    panel.append(el('h2', '', 'Add a Wizard'), el('p', '', 'Connect to a Wizard on another computer. Use its address on your private network, including http:// or https://. Keep Tailscale connected if that computer uses it.'));
    const field = (label, name, type) => {
      const l = el('label', '', label), input = el('input'); input.name = name; input.type = type; input.required = true; input.maxLength = name === 'url' ? 2048 : 120;
      l.append(input); form.append(l); return input;
    };
    const url = field('Wizard address', 'url', 'url'), name = field('Name', 'name', 'text');
    const error = el('p', 'wz-workspaces-error'); error.setAttribute('role', 'alert'); form.append(error);
    const footer = el('div', 'wz-workspaces-footer'), cancel = el('button', '', 'Cancel'), save = el('button', '', 'Add a Wizard');
    cancel.type = 'button'; save.type = 'submit'; cancel.addEventListener('click', close); footer.append(cancel, save); form.append(footer); panel.append(form);
    form.addEventListener('submit', async e => {
      e.preventDefault(); error.textContent = ''; save.disabled = true; save.setAttribute('aria-busy', 'true');
      try { await mutate('add', { url: url.value, name: name.value }); close(); }
      catch (e) { error.textContent = e.message; save.disabled = false; save.removeAttribute('aria-busy'); }
    }); url.focus();
  }
  function addWizard(params) {
    if (params) return mutate('add', params);
    close(); if (native()) return mutate('add', {});
    addSheet(); return Promise.resolve({ ok: true });
  }
  const W = window.WizWorkspaces = { list, snapshot, subscribe, switch: switchTo, add: addWizard,
    rename: (id, name) => mutate('rename', { id, name }), remove, switchFailed, groups, subtitle, address, destination, openMenu, close, ingest,
    get visible() { return state.items.length >= 2; } };
  merge();
  window.addEventListener('wizard:workspaces', e => { if (native()) { try { accept(e.detail); notify(); } catch (_) {} } });
  window.addEventListener('storage', e => { if (!native() && e.key === KEY && !pending) { merge(); publish(); } });
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
      if (!W.visible) close();
    };
    const off = subscribe(paint); host.listen(button, 'click', () => openMenu(button));
    host.on('route', paint); host.on('home', paint); host.on('render', paint);
    void list().catch(e => toast(e.message));
    return () => { off(); close(); button.remove(); api = null; document.documentElement.removeAttribute('data-workspace-control'); };
  }, { when: 'always', label: 'Wizard switcher', capabilities: ['layout'] });
  window.WosSettings?.register({ id: 'saved-wizards', page: 'connections', order: 90,
    html: () => '<div class="st-group"><h4>Wizards</h4><button class="st-row" type="button" data-workspaces-add><span class="st-tx"><b>Add a Wizard</b><small>Connect to a Wizard on another computer.</small></span></button></div>',
    act: (_ctx, el) => { if (!el.closest('[data-workspaces-add]')) return false; void addWizard().catch(e => toast(e.message)); return true; } });
})();
