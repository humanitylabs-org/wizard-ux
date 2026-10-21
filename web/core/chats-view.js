/* Chats view admission and lifecycle. In-document, owner-installed code, NOT a sandbox. */
(() => {
  'use strict';
  const VERSION = 'wizard.chats-view/1', DEFAULT = 'wizard-chats';
  const providers = new Map(), installed = new Map(), loads = new Map();
  let selected = DEFAULT;
  const fixture = (() => { try { return new URLSearchParams(location.search).get('chatsview') === 'fixture' || localStorage.getItem('wos.chatsview.fixture') === '1'; } catch (_) { return false; } })();
  function register(p) {
    if (!p || p.contract !== VERSION || !installed.has(p.id) || typeof p.mount !== 'function' || !p.name) throw Error('Not an installed Chats view');
    if (providers.has(p.id)) throw Error('Chats view already registered');
    providers.set(p.id, Object.freeze({ ...p }));
  }
  installed.set(DEFAULT, { id: DEFAULT, name: 'Chats' });
  register({ contract: VERSION, id: DEFAULT, name: 'Chats', mount: (_el, host) => ({ update: () => host.renderDefault(), unmount() {} }) });
  if (fixture) {
    installed.set('chats-fixture', { id: 'chats-fixture', name: 'Chats by subject (fixture)', module: new URL('chats-fixture-view.js', document.currentScript.src).href });
    installed.set('chats-throws', { id: 'chats-throws', name: 'Broken Chats (fixture)' });
    register({ contract: VERSION, id: 'chats-throws', name: 'Broken Chats (fixture)', mount() { throw Error('Intentional fixture failure'); } });
  }
  function moduleURL(a) {
    if (a.source !== 'apps.json' || !Array.isArray(a.provides) || !a.provides.includes('chats') || a.chats_view?.contract !== VERSION) return null;
    try {
      const base = new URL(a.url, location.origin), u = new URL(a.chats_view.module, base);
      const prefix = base.pathname.endsWith('/') ? base.pathname : base.pathname.slice(0, base.pathname.lastIndexOf('/') + 1);
      if (base.origin !== location.origin || u.origin !== location.origin || prefix === '/' || !u.pathname.startsWith(prefix) || !u.pathname.endsWith('.js') || u.search || u.hash || u.username || u.password) return null;
      return u.href;
    } catch (_) { return null; }
  }
  // Only a fresh Agent Service registry response admits code. Launcher links and cache never do.
  function configure(snapshot) {
    const keep = new Set([DEFAULT, ...(fixture ? ['chats-fixture', 'chats-throws'] : [])]);
    for (const a of snapshot.apps || []) {
      const module = moduleURL(a);
      if (!module || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(a.id) || keep.has(a.id)) continue;
      keep.add(a.id); installed.set(a.id, { id: a.id, name: String(a.name || a.id), module });
    }
    for (const id of installed.keys()) if (!keep.has(id)) { installed.delete(id); providers.delete(id); loads.delete(id); }
    const choice = snapshot.slots?.chats?.default || snapshot.parking?.find(r => r.slot === 'chats')?.active;
    selected = installed.has(choice) ? choice : DEFAULT;
    if (fixture) { try { const dev = localStorage.getItem('wos.chatsview.default'); if (installed.has(dev)) selected = dev; } catch (_) {} }
  }
  function ensure(id) {
    if (providers.has(id)) return Promise.resolve(providers.get(id));
    if (!installed.has(id)) return Promise.reject(Error('Chats view is not installed'));
    if (!loads.has(id)) {
      const entry = installed.get(id);
      loads.set(id, import(entry.module).then(m => {
        if (installed.get(id) !== entry || m.default?.id !== id) throw Error('Chats view registration changed');
        register(m.default); return providers.get(id);
      }));
    }
    return loads.get(id);
  }
  function create(H) {
    const regions = new Map(), bypass = new Set(), failed = new Set();
    let core;
    const owner = id => H.owner ? H.owner(id) : id;
    const providerFor = w => w?.agent ? DEFAULT : w?.chatsProvider || DEFAULT;
    function release(key) {
      const r = regions.get(key); if (!r) return;
      regions.delete(key);
      try { r.instance?.unmount(); } catch (_) { /* teardown must not strand a shell window */ }
      for (const off of r.offs) off();
    }
    function fallback(r) {
      if (regions.get(r.key) !== r) return;
      const name = installed.get(r.id)?.name || r.id;
      failed.add(r.id); release(r.key); r.el.replaceChildren();
      H.toast('!', `${name} couldn’t open. Showing Chats instead.`, 6000);
      const w = H.win(owner(r.key)); if (w) { w.chatsProvider = DEFAULT; H.save(); }
      r.paint();
    }
    function render(w, el, paint, kind) {
      if (bypass.has(el)) return false;
      const key = w.id, ow = H.win(owner(key)) || w;
      let id = providerFor(ow); if (!installed.has(id) || failed.has(id)) id = DEFAULT;
      el.classList.toggle('chats-view', id !== DEFAULT);
      let r = regions.get(key);
      if (r && (r.id !== id || r.el !== el)) { release(key); r = null; }
      if (!r) {
        r = { key, id, el, paint, w, kind, offs: new Set(), instance: null }; regions.set(key, r);
        const guard = fn => (...args) => { if (regions.get(key) !== r) return; try { return fn(...args); } catch (_) { fallback(r); } };
        const listen = (target, type, fn) => { const cb = guard(fn); target.addEventListener(type, cb); const off = () => target.removeEventListener(type, cb); r.offs.add(off); return off; };
        r.host = Object.freeze({
          contract: VERSION, windowId: owner(key), region: key === owner(key) ? 'main' : 'list',
          get thread() { return r.w.thread || null; },
          get threads() { return (window.WizLive?.sessions || []).filter(s => !s.hidden && (!ow.agent || window.WizLive.agentOf(s.id) === ow.agent)); },
          live: window.WizLive, outbox: window.WosOutbox,
          ready: () => window.WizLive?.groups(),
          isUnread: s => !!window.WizLive?.isNew(s),
          openThread: sid => core.openChat(owner(key), sid),
          openOnDesk: (sid, options) => H.openThread?.(sid, options),
          back: () => { const target = H.win(owner(key)); if (target?.thread) core.chatsBack(target); },
          send: (...args) => core.sendChat(owner(key), ...args),
          voice: () => H.recordReply?.(owner(key), H.win(owner(key))?.thread),
          renderDefault: () => { bypass.add(el); try { r.paint(); } finally { bypass.delete(el); } },
          element: tag => document.createElement(tag),
          listen: (type, fn) => listen(el, type, fn),
          subscribe: fn => { const off = window.WizLive?.onChange(guard(fn)) || (() => {}); r.offs.add(off); return off; },
          onAppearance: fn => { const observer = new MutationObserver(guard(fn)); observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-skin', 'style', 'class'] }); const off = () => observer.disconnect(); r.offs.add(off); return off; },
          toast: (...args) => H.toast(...args),
        });
        const mount = p => {
          if (regions.get(key) !== r || !el.isConnected) return;
          try {
            r.instance = p.mount(el, r.host);
            if (!r.instance || typeof r.instance.update !== 'function' || typeof r.instance.unmount !== 'function') throw Error('Chats view needs update and unmount');
            r.instance.update();
          } catch (_) { fallback(r); }
        };
        if (providers.has(id)) mount(providers.get(id));
        else { r.host.renderDefault(); ensure(id).then(mount, () => fallback(r)); }
      } else {
        r.paint = paint; r.w = w; r.kind = kind;
        try { if (r.instance) r.instance.update(); else r.host.renderDefault(); } catch (_) { fallback(r); }
      }
      return true;
    }
    core = window.WizCore.chats({ ...H, renderView: render });
    const forget = core.forget;
    core.forget = id => { release(id); release(id + '::list'); return forget(id); };
    core.views = Object.freeze({ providerFor, defaultId: () => selected, name: id => installed.get(id)?.name || 'Chats' });
    return core;
  }
  window.WizChatsHost = Object.freeze({ contract: VERSION, register, configure, create, moduleURL,
    defaultId: () => selected, installed: () => [...installed.values()].map(a => ({ ...a })),
    tiles: () => [...installed.values()].filter(a => a.id !== DEFAULT || installed.size > 1).map(a => ({ id: a.id, name: a.id === DEFAULT ? 'Chats (standard)' : a.name, kind: 'chats', chatsProvider: a.id, icon: '✦', g: ['var(--violet-2)', 'var(--violet-2)'], desc: 'Chats view · same conversations' })),
  });
})();
