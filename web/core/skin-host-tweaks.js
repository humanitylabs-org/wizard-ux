/* Wizard UX skin host › a tweak's stylesheet, the API a tweak receives and loading every tweak. Moved verbatim out of core/skin-host.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). The skin host (core/skin-host.js) calls
 * this once, where the code used to be, with the names it reads, and keeps the names it returns under their old names.
 * Names skin-host.js declares only further down are late-bound: it hands them over through bindLate right after it
 * declares them, before anything here can run. Values skin-host.js changes over time (its reassigned lets, like the
 * layout record and the shell) stay in skin-host.js; this code reads and writes them as skinHostVars.<name>, its
 * get/set accessors on the same variables, so every read and write is live. Loaded just before core/skin-host.js.
 * The body below keeps skin-host.js's indentation so `git log -L` and patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.skinHostParts = window.WizCore.skinHostParts || {};
window.WizCore.skinHostParts.tweaks = function ({ fault, guard, inboxThreads, interceptors, isDoc, layoutOf, loadTweaksNow, makeApi, overlays, panelSync, REPLY_LENGTHS, replySummary, safeTweakId, setLayout, skinHostVars, snoozeLast, summaryUsers, tweaks, tweakUrl }) {
  const expected = new Set(), preCss = new Map();   // ids still loading; id -> <link> added ahead of the package
  function tweakCss(id) {
    if (!isDoc) return null;
    let l = preCss.get(id); if (l) return l;
    const href = tweakUrl(id, 'tweak.css'); if (!href) return null;   // a core feature without a stylesheet
    l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; l.setAttribute('blocking', 'render');
    document.head.append(l); preCss.set(id, l); return l;
  }
  // Wait (briefly) for a package's stylesheet before its setup runs, so its view never shows unstyled.
  const cssReady = l => !l || l.sheet !== null || typeof l.addEventListener !== 'function' ? Promise.resolve() : new Promise(done => {
    const t = setTimeout(done, 1500), end = () => { clearTimeout(t); done(); };
    l.addEventListener('load', end, { once: true }); l.addEventListener('error', end, { once: true });
  });
  const bounded = async (promise, ms = 8000) => {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Package timed out')), ms); })]); }
    finally { clearTimeout(timer); }
  };
  function paintTweaks() {
    if (isDoc) document.documentElement.dataset.tweaks = [...new Set([...[...tweaks].filter(([, a]) => !a.dead).map(([id]) => id), ...expected])].join(' ');
    window.WosResources?.sync();
  }
  function tweakApi(a, manifest, trusted) {
    const base = makeApi(a), caps = new Set(manifest.capabilities.filter(c => trusted || c === 'layout' || c === 'nav'));
    const api = { env: base.env, route: base.route, on(type, fn) {
      if (type === 'render' && !caps.has('layout')) throw new Error('render requires layout');
      if (type === 'sent' && (!caps.has('nav') || !trusted)) throw new Error('sent requires trusted navigation');
      if (type === 'voice' && !caps.has('layout')) throw new Error('voice requires layout');
      if (type === 'beside' && !caps.has('layout')) throw new Error('beside requires layout');
      if (type === 'home' && !caps.has('layout')) throw new Error('home requires layout');
      return base.on(type, payload => fn(type === 'render' ? Object.freeze({ part: payload.part }) : payload));
    }, toast: base.toast, storage: base.storage };
    // Trusted packages that replace each other (catalog oneOf) can share one store, so a look-only skin change keeps
    // the owner's choices: manifest `storage: "<name>"` keys it as `wos.skin.shared:<name>.*` instead of by package id.
    if (trusted && typeof manifest.storage === 'string' && /^[a-z0-9-]{1,40}$/.test(manifest.storage)) {
      const ns = 'wos.skin.shared:' + manifest.storage + '.';
      api.storage = Object.freeze({
        get(key) { try {
          let v = localStorage.getItem(ns + key);
          // Before the shared store existed each package kept its own copy: take this package's, else any package of the
          // same name ("<author>/<storage>"), so switching skins after an upgrade keeps the owner's choices.
          if (v == null) v = localStorage.getItem(`wos.skin.${a.id}.${key}`);
          if (v == null) for (let i = 0; i < localStorage.length && v == null; i++) { const k = localStorage.key(i); if (k && /^wos\.skin\.[a-z0-9-]+\//.test(k) && k.endsWith(`/${manifest.storage}.${key}`)) v = localStorage.getItem(k); }
          return v == null ? null : JSON.parse(v);
        } catch (_) { return null; } },
        set(key, value) { try { localStorage.setItem(ns + key, JSON.stringify(value)); } catch (_) {} },
      });
    }
    if (caps.has('layout')) {
      Object.assign(api, { listen: base.listen, frame: base.frame, gesture: base.gesture });
      // Short answer first (--wos-reply-summary): how long replies start and how long the agent writes the short answer,
      // box-wide (ui-preferences replySummary; the Agent Service reads `length` while `on`). use() marks the view on for
      // the box and is released on teardown.
      api.replies = Object.freeze({ lengths: REPLY_LENGTHS, summary: () => replySummary.get(),
        set(patch = {}) { if (!a.dead) replySummary.set({ ...(patch.start ? { start: patch.start } : {}), ...(patch.length ? { length: patch.length } : {}) }); },
        use() { if (a.dead || summaryUsers.has(a.id)) return; summaryUsers.add(a.id); void replySummary.on(true);
          a.offs.add(() => { if (summaryUsers.delete(a.id) && !summaryUsers.size) void replySummary.on(false); }); } });
      // Borrow a built-in layout through the same host; disposal invalidates the handle.
      api.layout = Object.freeze({ foundation(id) {
        if (a.dead) return () => {};
        const release = window.WosSkin?.useFoundation(id) || (() => {});
        a.offs.add(release); return release;
      }, use(id) {
        if (a.dead || !layoutOf(id)) return () => {};
        // Already worn since boot (stored choice): keep the running layout instead of remounting it.
        if (skinHostVars.layoutId !== id || (!skinHostVars.layoutRec && !skinHostVars.layoutSeq)) setLayout(id);
        skinHostVars.layoutHolder = a.id;
        let released = false;
        const release = () => { if (!released) { released = true; if (skinHostVars.layoutHolder === a.id) skinHostVars.layoutHolder = null; if (skinHostVars.layoutId === id && skinHostVars.standardLayout !== id) setLayout('classic'); } };
        a.offs.add(release); return release;
      } });
      api.part = name => /^[a-z-]+$/.test(name) ? skinHostVars.shell?.root()?.querySelector(`[data-part="${name}"]`) || null : null;
      // A package's own overlay joins the shell's Back order (phone Back / browser Back / desktop Esc): the newest
      // open one closes first. push(close) while it is open; the returned release (or teardown) takes it out.
      api.back = Object.freeze({ push(close) {
        if (a.dead || typeof close !== 'function') return () => {};
        const done = guard(a, 'back', close);
        const entry = { a, close: () => { off(); return done(); } }; overlays.push(entry);
        const offEscape = skinHostVars.shell?.escapeOverlay?.(entry.close);
        const off = () => { offEscape?.(); const i = overlays.indexOf(entry); if (i >= 0) overlays.splice(i, 1); a.offs.delete(off); };
        a.offs.add(off); return off;
      } });
      const slot = name => {
        if (!skinHostVars.slotContract?.slots[name]) return null;
        const selector = `[data-slot="${name}"]`;
        // Prefer the focused chats window, then any visible instance: desktop keeps hidden Chats copies around.
        const seen = el => !!el && el.isConnected !== false && (typeof el.getClientRects !== 'function' || el.getClientRects().length > 0);
        const own = skinHostVars.shell?.root()?.querySelector(selector);
        if (seen(own)) return own;
        return [...document.querySelectorAll(selector)].find(seen) || own || document.querySelector(selector);
      };
      const borrowed = new Map();
      slot.mount = (name, node, order = 0) => {
        if (a.dead || !node || node.nodeType !== 1) return false;
        const target = slot(name); if (!target) return false;
        if (!borrowed.has(node)) {
          const parent = node.parentNode, marker = parent ? document.createComment('tweak mount origin') : null;
          if (parent) parent.insertBefore(marker, node);
          borrowed.set(node, marker);
          // Restore borrowed core nodes; owned nodes are removed. Run before common mount cleanup.
          a.offs.add(() => { if (marker?.parentNode?.isConnected) { marker.parentNode.insertBefore(node, marker); marker.remove(); a.mounts.delete(node); } });
        }
        node.dataset.tweakOrder = String(Number(order) || 0);
        const after = [...target.children].find(n => n !== node && +(n.dataset.tweakOrder || 0) > +node.dataset.tweakOrder);
        if (node.parentNode !== target || (after && node.nextSibling !== after)) target.insertBefore(node, after || null);
        a.mounts.add(node); return true;
      };
      api.slot = Object.freeze(slot);
    }
    if (caps.has('nav')) api.nav = Object.freeze({ ...Object.fromEntries(Object.entries(base.nav).map(([key, fn]) => [key, (...args) => !a.dead && fn(...args)])),
      newThread: () => !a.dead && skinHostVars.shell?.newThread?.(),
      intercept(action, fn) {
        if (!trusted || a.dead) throw new Error('Trusted navigation required');
        if (action !== 'snooze' || typeof fn !== 'function') throw new Error('Unknown action');
        const handler = context => Promise.resolve().then(() => !a.dead && fn(Object.freeze({ ...context }))).catch(e => base.toast(e.message));
        interceptors.set(a.id, { action, handler }); a.offs.add(() => interceptors.delete(a.id));
      },
      snoozeSomeday: sessionId => { if (!trusted || a.dead) throw new Error('Trusted navigation required'); return window.WosBoomerang.someday({ sessionId, restore: true }); },
      // Ask the agent from a package view: a new chat carrying { title, message } as a quoted reply card (the shell's
      // contextDraft path). `words` lands as an unsent draft for the owner to check and send; { send: true } sends at
      // once. Trusted only; the key is namespaced so it can't pose as another app.
      ask(id, item = {}, words = '', opts = {}) {
        if (!trusted || a.dead) throw new Error('Trusted navigation required');
        const key = 'home:' + String(id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 100);
        if (key === 'home:' || typeof skinHostVars.shell?.contextDraft !== 'function') return false;
        const w = String(words || '').slice(0, 1000), send = opts?.send === true;
        return !!skinHostVars.shell.contextDraft(key, { title: String(item.title || '').slice(0, 300), message: String(item.message || '').slice(0, 4000) }, send ? w : '', send ? '' : w);
      },
      // Snooze = lowest priority, bottom of Ready (live.js / chats.js read host.snoozeOrder). Released on teardown.
      snoozeOrder(order) {
        if (!trusted || a.dead) throw new Error('Trusted navigation required');
        if (order !== 'last') throw new Error('Unknown order');
        if (snoozeLast.has(a.id)) return;
        snoozeLast.add(a.id); a.offs.add(() => { if (snoozeLast.delete(a.id)) window.dispatchEvent?.(new Event('wos:prefs')); });
      },
    });
    // A layout+navigation package may borrow the shell's overview renderer/input adapter.
    // No DOM or package IDs cross this boundary; the handle is released on every teardown.
    if (caps.has('layout') && caps.has('nav')) api.overview = Object.freeze({ use(options = {}) {
      if (a.dead) return () => {};
      if (!['arrange','offer'].includes(options.hold) || ![null,'home-screen'].includes(options.appAction ?? null) || typeof options.appHold !== 'boolean') throw new Error('Invalid overview mode');
      const release = skinHostVars.shell?.overview?.use?.(Object.freeze({ hold:options.hold, appAction:options.appAction ?? null, appHold:options.appHold })) || (() => {});
      let released = false; const off = () => { if (!released) { released = true; release(); } };
      a.offs.add(off); return off;
    } });
    // A layout+navigation package may ask the shell for ↻ in every window bar and (pull:false) drop Chats pull-to-refresh.
    // The shell owns the button and the refresh; the handle is released on every teardown.
    if (caps.has('layout') && caps.has('nav')) api.windowRefresh = Object.freeze({ use(options = {}) {
      if (a.dead) return () => {};
      if (typeof options.pull !== 'boolean') throw new Error('Invalid window refresh mode');
      const release = skinHostVars.shell?.windowRefresh?.use?.(Object.freeze({ pull: options.pull })) || (() => {});
      let released = false; const off = () => { if (!released) { released = true; release(); } };
      a.offs.add(off); return off;
    } });
    // Trusted packages may show and pause what the apps play (api.media above).
    if (trusted && caps.has('media')) api.media = base.media;
    if (caps.has('models')) {
      api.models = Object.freeze({ list: async () => {
        const options = await skinHostVars.shell?.models?.() || [];
        return a.dead ? [] : options.map(m => Object.freeze({ id: m.value, provider: m.provider, agent: m.agent || '', label: m.name, disabled: !!m.disabled }));
      },
      // The Wizard's default model (what a new chat starts on), or null while it is still loading.
      default: () => { if (a.dead) return null; const o = window.WosModels?.defaultOption?.(); return o ? Object.freeze({ id: String(o.value || ''), provider: String(o.provider || '') }) : null; } });
      api.thread = Object.freeze({ model: choice => a.dead ? null : skinHostVars.shell?.model?.(choice, () => !a.dead) });
    }
    if (trusted && caps.has('data.read')) api.workspaces = window.WizWorkspaces;
    if (caps.has('data.read')) api.data = Object.freeze({ read: Object.freeze({ resources: Object.freeze({
      snapshot: () => structuredClone(window.WosResources?.state || {}), refresh: () => window.WosResources?.sync(),
      // A reading kept on screen outside Home or Settings (the desktop top bar) keeps the feed polling while it shows.
      live: el => { if (!a.dead && el?.nodeType === 1) window.WosResources?.watch?.(el); },
      // resources.js announces each finished poll ('wos:resources'); the handle dies with the package.
      watch(fn) {
        if (a.dead || typeof fn !== 'function' || typeof window.addEventListener !== 'function') return () => {};
        const g = guard(a, 'resources.watch', () => fn(structuredClone(window.WosResources?.state || {})));
        window.addEventListener('wos:resources', g);
        const off = () => { window.removeEventListener('wos:resources', g); a.offs.delete(off); };
        a.offs.add(off); return off;
      },
    }),
    // Trusted packages only: Ready / Working counts as Home shows them, and opening those same lists.
    ...(trusted ? { sessions: Object.freeze({
      counts: () => { if (a.dead) return null; const c = skinHostVars.shell?.sessions?.(); return c ? Object.freeze({ working: c.working | 0, ready: c.ready | 0 }) : null; },
      open: kind => { if (!a.dead && (kind === 'working' || kind === 'ready')) skinHostVars.shell?.openSessions?.(kind); },
    }) } : {}),
    // Trusted packages only: one same-origin GET of an installed app's read API (/<app>/api/<path>), JSON back.
    // No method, header, body or other origin crosses this boundary; null on any failure or after teardown.
    ...(trusted ? { app: async (id, path) => {
      if (a.dead || !/^[a-z0-9][a-z0-9-]{0,40}$/.test(String(id)) || !/^[a-z0-9][a-z0-9/_-]{0,80}$/.test(String(path))) return null;
      try {
        const r = await bounded(fetch(new URL(`/${id}/api/${path}`, document.baseURI).href, { method: 'GET', cache: 'no-store', credentials: 'same-origin', redirect: 'error' }));
        if (!r.ok || !/json/.test(r.headers?.get?.('content-type') || 'application/json')) return null;
        const j = await r.json(); return a.dead ? null : structuredClone(j);
      } catch (_) { return null; }
    } } : {}),
    }) });
    // Trusted packages may show the Notifications inbox (core/notif-bell.js) in Chats: watch unread items, mark one
    // done, or answer it in a new chat (the shell's context-draft path; `words` sends at once). No fetch crosses this
    // boundary and every handle dies with the package.
    // Settings sections: a trusted package fills a System page of Settings (Your network, AI, Network & security,
    // Storage & backups) with its own live node, or puts its own options under its switch in Look (page 'look'), and can
    // open Settings at one of the System pages. Released on teardown.
    if (caps.has('settings')) api.settings = Object.freeze({
      section(id, page, node, opts = {}) {
        if (!trusted || a.dead) throw new Error('Trusted settings required');
        if (!['overview', 'ai', 'network', 'storage', 'look'].includes(page) || !node || typeof node.append !== 'function') throw new Error('Invalid settings section');
        const W = window.WosSettings; if (!W?.register) return () => {};
        // Look: the package's own options, right under its switch in the Tweaks list.
        if (page === 'look') { if (!W.tweakOptions) return () => {}; const off = W.tweakOptions(a.id, node); let done = false; const release = () => { if (!done) { done = true; off(); } }; a.offs.add(release); return release; }
        const fid = ('tweak-' + a.id + '-' + id).replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80);
        const subtitle = typeof opts.subtitle === 'function' ? guard(a, 'settings.subtitle', opts.subtitle) : null;
        const off = W.register({ id: fid, page, ...(subtitle ? { subtitle } : {}), html: () => '<div class="st-tweak" data-st-tweak></div>',
          painted: (ctx, el) => { const slot = el?.firstElementChild; if (slot && node.parentNode !== slot) slot.append(node); window.WosResources?.watch?.(node); },
          deferRefresh: () => node.contains?.(document.activeElement) });
        let done = false; const release = () => { if (!done) { done = true; off(); node.remove?.(); } };
        a.offs.add(release); return release;
      },
      open: page => { if (!a.dead && ['overview', 'ai', 'network', 'storage'].includes(page)) skinHostVars.shell?.openSettings?.(page); },
      // One of the author's own tweaks, switched for this device the same way as Settings › Look (WosExperience
      // mix, no reload). Own author only: a package can never switch someone else's tweak.
      tweakOn: id => typeof id === 'string' && id.startsWith(a.id.split('/')[0] + '/') && tweaks.has(id) && !tweaks.get(id).dead,
      toggleTweak(id) {
        if (!trusted || a.dead) throw new Error('Trusted settings required');
        if (typeof id !== 'string' || !safeTweakId(id) || id === a.id || !id.startsWith(a.id.split('/')[0] + '/')) return Promise.resolve(false);
        return Promise.resolve(window.WosExperience?.toggle?.(id)).then(() => true, () => false);
      },
      refresh: () => { if (!a.dead) window.WosSettings?.refresh?.(); },
    });
    /* Trusted packages may replace where notifications go: the `notify-routing` part in core/notif-bell.js (version 1),
     * and read / save the box's saved choices at Notifications' /notifications/api/routes. No other URL,
     * method or header crosses this boundary. The replacement dies with the package (stock Badge | Chats comes back). */
    if (caps.has('notify') && trusted) api.notify = Object.freeze({
      routing(impl, opts = {}) {
        const R = window.WosBell?.routing; if (!R || a.dead || !impl || typeof impl !== 'object') return false;
        const wrapped = {};
        for (const [k, fn] of Object.entries(impl)) if (typeof fn === 'function' && k !== 'attach') wrapped[k] = (...args) => {
          if (a.dead) throw new Error('turned off');
          try { return fn(...args); } catch (e) { fault(a, 'notify.' + k, e); throw e; }
        };
        // The host handed to the replacement: what it may read and do, nothing more, and only while it lives.
        if (typeof impl.attach === 'function') wrapped.attach = host => { if (!a.dead) impl.attach(Object.freeze({
          stored: () => a.dead ? {} : host.stored(), route: id => host.route(String(id)), installed: () => !a.dead && host.installed(),
          adopt: next => !a.dead && host.adopt(next), changed: () => { if (!a.dead) host.changed(); },
          mark: (ids, marks = {}) => { const m = Object.fromEntries(['read', 'archived'].filter(k => typeof marks[k] === 'boolean').map(k => [k, marks[k]])); return a.dead || !Array.isArray(ids) || !Object.keys(m).length ? Promise.resolve(false) : host.mark(ids.map(String).slice(0, 200), m); },
        })); };
        const r = R.replace(wrapped, { owner: a.id, version: opts?.version });
        if (typeof r === 'function') { a.offs.add(r); return true; }
        try { skinHostVars.shell?.toast?.(r === 'version' ? `${a.label || a.id} paused after an update · ask your Wizard to update it` : `${a.label || a.id} couldn't change notifications (${r})`); } catch (_) {}
        return false;
      },
      routes: Object.freeze({
        async get() {
          if (a.dead) return null;
          try {
            const r = await bounded(fetch(new URL('/notifications/api/routes', document.baseURI).href, { method: 'GET', cache: 'no-store', credentials: 'same-origin', redirect: 'error' }));
            if (!r.ok) return null; const j = await r.json(); return a.dead || !j || typeof j !== 'object' ? null : structuredClone(j);
          } catch (_) { return null; }
        },
        async save(routes) {
          if (a.dead || !routes || typeof routes !== 'object' || Array.isArray(routes)) return false;
          const clean = {}; for (const [k, v] of Object.entries(routes).slice(0, 200)) if (typeof v === 'string' && /^[a-z0-9][a-z0-9:-]{0,80}$/.test(k) && /^[a-z][a-z0-9-]{0,19}$/.test(v)) clean[k] = v;
          if (!Object.keys(clean).length) return false;
          try {
            const r = await bounded(fetch(new URL('/notifications/api/routes', document.baseURI).href, { method: 'POST', credentials: 'same-origin', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ routes: clean }) }));
            return !a.dead && r.ok;
          } catch (_) { return false; }
        },
      }),
    });
    if (caps.has('inbox')) api.inbox = Object.freeze({
      watch(fn) {
        if (a.dead || typeof fn !== 'function' || !window.WosBell?.watch) return () => {};
        const g = guard(a, 'inbox.watch', fn);
        const off = window.WosBell.watch(items => { if (!a.dead) g(items); });
        a.offs.add(off); return off;
      },
      done: id => a.dead || !window.WosBell?.mark ? Promise.resolve(false) : window.WosBell.mark([String(id)], { archived: true, read: true }),
      // read / archived only (snoozed = read and kept; restored = neither).
      set(id, marks = {}) {
        const m = Object.fromEntries(['read', 'archived'].filter(k => typeof marks[k] === 'boolean').map(k => [k, marks[k]]));
        return a.dead || !Object.keys(m).length || !window.WosBell?.mark ? Promise.resolve(false) : window.WosBell.mark([String(id)], m);
      },
      // A notification opened from the list shows in the chat window as a one-message thread; its Done / Snooze /
      // Restore buttons (and keys) call act(action, id). Held while the package lives (chats.js reads host.inboxThreads).
      // `list: true` also lists them in Ready as rows like any chat (time, priority and subject order); a tap on one
      // calls act('open', id).
      threads(handlers = {}) {
        if (a.dead || typeof handlers.act !== 'function') return () => {};
        inboxThreads.set(a.id, { act: guard(a, 'inbox.act', handlers.act), list: handlers.list === true });
        const off = () => { if (inboxThreads.delete(a.id)) window.dispatchEvent?.(new Event('wos:prefs')); };
        a.offs.add(off); window.dispatchEvent?.(new Event('wos:prefs')); return off;
      },
      reply(id, words = '') {
        if (a.dead) return false;
        const it = window.WosBell?.item?.(id); if (!it || typeof skinHostVars.shell?.contextDraft !== 'function') return false;
        // An app's item rides with its app name, so the agent knows where it came from (and which app tools to use).
        const app = it.app || it.from, name = it.appName || it.fromName || app;
        const title = app ? `${name}: ${it.title || 'Item'}` : it.title;
        const message = app ? `${it.message}\n\n(From the ${name} app, ${app}; item ${it.key || it.id})` : it.message;
        return !!skinHostVars.shell.contextDraft('notifications:' + it.id, { title, message }, String(words || ''));
      },
      // An app's item (an app set to Chats in Settings › Notifications): open that app, at the item when it says where.
      open(id) {
        if (a.dead) return false;
        const it = window.WosBell?.item?.(id); if (!(it?.app || it?.from) || typeof window.WizOpenApp !== 'function') return false;
        // Android (wizard-os issue 650): Open shows the app in its own window, as a link does.
        const openApp = (app, path) => window.WizAndroidRelay?.openAppWindow?.(app, path || '') === true || (path ? window.WizOpenApp(app, path) : window.WizOpenApp(app));
        if (!it.app) return !!openApp(it.from);   // a Notifications item about an app: open that app
        if (!it.open) return !!openApp(it.app);
        let base = ''; try { base = (window.WizCore?.apps?.('mobile')?.APPS || []).find(x => x.id === it.app)?.url || ''; } catch (_) {}
        try { const u = new URL(it.open, new URL(base || `/${it.app}/`, location.origin)); if (u.origin === location.origin && openApp(it.app, u.pathname + u.search + u.hash)) return true; } catch (_) {}
        return !!openApp(it.app);
      },
    });
    return Object.freeze(api);
  }
  /* A tweak reload (Settings, a skin pick, coming back to the tab) disposes and re-runs every tweak. A layout's panel
   * must not drop for that blink (Miguel lost every running Orbs app to it): the panel turns off only once the load
   * has settled and no layout claims it again. */
  async function loadTweaks(...args) {
    skinHostVars.panelHold++;
    try { return await loadTweaksNow(...args); } finally { skinHostVars.panelHold--; panelSync(); }
  }
  return { bounded, cssReady, expected, loadTweaks, paintTweaks, preCss, tweakApi, tweakCss };
};
