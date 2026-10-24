/* Workspace sync (Miguel's release): the same workspaces on every Wizard client.
 *
 * Each shell keeps its desks in localStorage. This module mirrors the part that should follow the owner between
 * devices to his box (/wizard-os-home/workspace-sync/api, reachable only on his tailnet): which desks exist, their
 * order, the apps on each, and the page or thread an app has open when it first arrives on a device. Window
 * layout, focus, full screen and the current desk stay per device, and an app already open on a device keeps its
 * own page (another device never yanks it). Closing a desk closes it everywhere; the box keeps it under Recently
 * closed (Settings) so any device can reopen it.
 *
 *   const sync = WosWorkspaceSync.create({ shell, read, apply })
 *     read()          → { desks: [{ id, wins: [window objects] }] }   this device's desks, in order
 *     apply(state, o) ← put the shared desks on this device; apply(null, { focus: deskId }) shows one desk
 *   sync.changed()  call after every local save; a real change is pushed, debounced
 *
 * Merging is per desk: an edit made here while another device changed a different desk keeps both; the same
 * desk edited on two devices keeps the later save. A device joining for the first time adopts the box's desks
 * and adds only those of its own the box lacks (by their apps), so each device's starter Chats desk never piles up. */
(() => {
  'use strict';
  const API = '/wizard-os-home/workspace-sync/api';
  const KEY = 'wos.wsync.v1', OFF = 'wos.wsync.off';
  const APPS = new Set(['chats', 'frame', 'review', 'maps', 'feature']);
  const FIELDS = ['appId', 'url', 'thread', 'agent', 'chatsProvider', 'title', 'dest', 'mode', 'query', 'featureId', 'z', 'featureOptions'];
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  // Bound views and review peeks belong to the chat that opened them; device-only apps stay on their device.
  const syncable = w => !!w && APPS.has(w.app) && !w.bound && !w.from && !w.servicesAs;
  function pick(w) {
    const o = { id: w.id, app: w.app };
    for (const k of FIELDS) { const v = w[k]; if (v != null && v !== '' && !(k === 'thread' && v === '__new__')) o[k] = v; }
    return o;
  }
  const norm = s => ({ desks: (s?.desks || []).map(d => ({ id: d.id, wins: (d.wins || []).filter(syncable).map(pick) })).filter(d => d.wins.length) });
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const looseSig = d => d.wins.map(w => [w.app, w.appId || '', w.agent || ''].join('|')).sort().join('&');

  /* Three-way merge: start from the box's desks, replay what this device changed since `base`. */
  function merge(base, local, remote) {
    const B = new Map(base.desks.map(d => [d.id, d])), L = new Map(local.desks.map(d => [d.id, d]));
    const out = remote.desks.map(d => ({ ...d }));
    const at = id => out.findIndex(d => d.id === id);
    for (const [id, d] of B) { const j = at(id); if (!L.has(id) && j >= 0 && same(out[j], d)) out.splice(j, 1); } // closed here, untouched there
    local.desks.forEach((d, i) => {
      const b = B.get(d.id), j = at(d.id);
      if (!b) { if (j < 0) out.splice(Math.min(i, out.length), 0, d); }                         // opened here
      else if (!same(b, d)) { if (j >= 0) out[j] = d; else out.splice(Math.min(i, out.length), 0, d); } // edited here
    });
    // Desks reordered here: shared desks follow this device's order, the others keep their places.
    const order = ids => ids.filter(id => L.has(id) && B.has(id));
    if (!same(order(local.desks.map(d => d.id)), order(base.desks.map(d => d.id)))) {
      const slots = out.map((d, i) => (L.has(d.id) ? i : -1)).filter(i => i >= 0);
      const moved = slots.map(i => out[i]).sort((a, b) => local.desks.findIndex(d => d.id === a.id) - local.desks.findIndex(d => d.id === b.id));
      slots.forEach((i, k) => { out[i] = moved[k]; });
    }
    // A window lives on one desk: where this device put it wins, otherwise its first desk.
    const mine = new Map(); local.desks.forEach(d => d.wins.forEach(w => mine.set(w.id, d.id)));
    const home = id => mine.has(id) && out.some(d => d.id === mine.get(id) && d.wins.some(w => w.id === id)) ? mine.get(id) : null;
    const seen = new Set();
    for (const d of out) d.wins = d.wins.filter(w => { const h = home(w.id); if (seen.has(w.id) || (h && h !== d.id)) return false; seen.add(w.id); return true; });
    return { desks: out.filter(d => d.wins.length) };
  }

  /* Put shared desks onto a device's own desk list. Desks and windows keep their local objects (focus, layout, the
   * page an app is on); new ones come from `state`; device-only windows stay on their desk; a desk with more
   * windows than the device shows keeps the rest in `d.more` so nothing is dropped from the shared copy. */
  function reconcile(localDesks, W, state, { fresh, max = Infinity }) {
    const placed = new Set(localDesks.flatMap(d => d.wins)), out = [], added = [];
    const remoteIds = new Set(state.desks.map(d => d.id));
    for (const r of state.desks) {
      const L = localDesks.find(d => d.id === r.id), d = L ? { ...L } : fresh(r.id);
      const ids = r.wins.map(w => { if (!W[w.id]) { W[w.id] = JSON.parse(JSON.stringify(w)); added.push(w.id); } return w.id; });
      const own = (L ? L.wins : []).filter(id => W[id] && !syncable(W[id]));
      const all = [...ids, ...own];
      d.wins = all.slice(0, max);
      const rest = all.slice(max).filter(id => syncable(W[id]));
      if (rest.length) d.more = rest.map(id => pick(W[id])); else delete d.more;
      rest.forEach(id => delete W[id]);
      if (!d.wins.includes(d.focus)) d.focus = d.wins[d.wins.length - 1] || null;
      out.push(d);
    }
    // Desks only this device has: device-only apps, or a fresh empty desk, stay where they were.
    localDesks.forEach((L, i) => {
      if (remoteIds.has(L.id)) return;
      const own = L.wins.filter(id => W[id] && !syncable(W[id]));
      if (L.wins.length && !own.length) return; // closed on another device
      const d = { ...L, wins: own }; delete d.more;
      if (!d.wins.includes(d.focus)) d.focus = d.wins[d.wins.length - 1] || null;
      out.splice(Math.min(i, out.length), 0, d);
    });
    const now = new Set(out.flatMap(d => d.wins));
    const removed = [...placed].filter(id => !now.has(id) && W[id]);
    return { desks: out, removed, added };
  }

  function label(shell) {
    const ua = navigator.userAgent || '';
    const what = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux|X11/.test(ua) ? 'Linux' : 'device';
    return shell === 'desktop' ? `${what} desktop` : what;
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function create({ shell, read, apply, title }) {
    const name = label(shell);
    let st = ls.get(KEY, null) || { rev: -1, base: null };   // base = the box's desks as of rev
    let lastLocal = null;                                     // this device's desks as of base
    let closed = [], info = { device: '', at: '' }, ok = null, timer = 0, busy = false, again = false, applying = false, alive = true;
    const off = () => ls.get(OFF, false) === true;
    const persist = () => ls.set(KEY, st);
    const emit = () => { try { window.dispatchEvent(new Event('wos:workspace-sync')); window.WosSettings?.refresh(); } catch (e) {} };
    const take = j => { closed = Array.isArray(j.closed) ? j.closed : []; info = { device: j.device || '', at: j.at || '' }; };
    const now = () => norm(read());
    function put(state, opts = {}) {
      applying = true;
      try { apply(state, opts); } catch (e) { console.error('workspace sync', e); }
      finally { applying = false; }
      lastLocal = now();
    }
    async function req(method, path, body) {
      const r = await fetch(API + path, { method, cache: 'no-store', credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
      const j = await r.json().catch(() => null);
      if (r.status === 404 && !(j && 'rev' in j)) { const e = new Error('absent'); e.absent = true; throw e; }
      return { status: r.status, j };
    }
    let pending = null; // desks to save that already merge this device's edits onto the box's newest copy
    async function push() {
      timer = 0;
      if (off() || !alive || !st.base) return;
      if (busy) { again = true; return; }
      busy = true;
      try {
        for (let tries = 0; tries < 4; tries++) {
          const local = now();
          if (!pending && lastLocal && same(local, lastLocal)) break;
          const want = pending || merge(lastLocal || st.base, local, st.base);
          const { status, j } = await req('PUT', '/state', { baseRev: st.rev, device: name, state: want });
          if (!j || !Array.isArray(j.state?.desks)) throw new Error('state ' + status);
          st = { rev: j.rev, base: j.state }; persist(); take(j);
          if (status === 200) { pending = null; const cur = now(); if (same(cur, local)) put(j.state); else { pending = merge(local, cur, j.state); put(pending); again = true; } break; }
          if (status !== 409) throw new Error('state ' + status);
          // Another device saved first: lay this device's edits over theirs, show that, save it.
          pending = merge(lastLocal || want, now(), j.state); put(pending);
        }
        ok = true;
      } catch (e) { if (e.absent) ok = null; else { ok = false; setTimeout(schedule, 5000); } }
      finally { busy = false; emit(); if (again) { again = false; schedule(); } }
    }
    function schedule() { clearTimeout(timer); timer = setTimeout(push, 500); }
    function changed() { if (!applying && !off()) schedule(); }
    function arrive(j) {
      take(j);
      const local = now();
      if (!st.base) { // first join: the box's desks, plus this device's own desks the box lacks
        const have = new Set(j.state.desks.map(looseSig)), ids = new Set(j.state.desks.map(d => d.id));
        const extra = local.desks.filter(d => !ids.has(d.id) && !have.has(looseSig(d)));
        st = { rev: j.rev, base: j.state }; persist();
        const joined = { desks: [...j.state.desks, ...extra] };
        put(joined, { join: true });
        if (extra.length) { pending = joined; schedule(); }
        return;
      }
      const dirty = !!lastLocal && !same(local, lastLocal);
      st = { rev: j.rev, base: j.state }; persist();
      if (!dirty) { put(j.state); return; }
      pending = merge(lastLocal, local, j.state); put(pending); schedule();
    }
    async function loop() {
      let fails = 0;
      while (alive) {
        if (off()) { await sleep(5000); continue; }
        try {
          const wait = document.hidden || !st.base || ok !== true ? 0 : 25; // answer at once until in sync, then long-poll
          const { status, j } = await req('GET', `/state?since=${st.base ? st.rev : -1}&wait=${wait}`);
          if (status !== 200 || !j || !Array.isArray(j.state?.desks)) throw new Error('state ' + status);
          if (!busy && (j.rev !== st.rev || !st.base)) arrive(j); else take(j);
          if (ok !== true) { ok = true; } emit(); fails = 0;
          if (document.hidden) await sleep(15000);
        } catch (e) {
          if (e.absent) { ok = null; emit(); return; } // this box has no workspace sync: one-device shell, quietly
          ok = false; emit(); fails++;
          await sleep(Math.min(30000, 1500 * 2 ** Math.min(fails, 5)));
        }
      }
    }
    function reopen(deskId) {
      const c = closed.find(x => x.desk?.id === deskId); if (!c) return false;
      const local = now();
      applying = true;
      try { apply({ desks: [...local.desks.filter(d => d.id !== deskId), c.desk] }, { reopen: true }); apply(null, { focus: deskId }); }
      finally { applying = false; }
      closed = closed.filter(x => x !== c); schedule(); emit(); return true;
    }
    function setOff(v) { ls.set(OFF, !!v); if (!v) { st = { rev: -1, base: null }; lastLocal = null; persist(); } emit(); }
    addEventListener('pagehide', () => { if (timer) { clearTimeout(timer); push(); } });
    setTimeout(loop, 300);
    const api = {
      changed, reopen, setOff, title, stop() { alive = false; },
      get on() { return !off(); }, get ok() { return ok; }, get closed() { return closed; }, get info() { return info; }, get name() { return name; }, get rev() { return st.rev; },
    };
    window.WosWorkspaceSync.current = api;
    return api;
  }

  /* Settings › Workspace sync: on/off for this device, last change, Recently closed with Reopen. */
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ago = iso => { const t = Date.parse(iso || ''); if (!isFinite(t)) return ''; const m = Math.round((Date.now() - t) / 6e4); return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
  const appName = w => { if (w.app === 'chats') return 'Chats'; if (w.app === 'review') return 'Review'; if (w.app === 'maps') return 'Maps'; try { return window.WosWorkspaceSync.current?.title?.(w) || w.title || w.appId || 'App'; } catch (e) { return w.title || w.appId || 'App'; } };
  const deskName = d => [...new Set(d.wins.map(appName))].join(', ');
  const shown = () => { const s = window.WosWorkspaceSync.current; return !!s && (s.ok !== null || !s.on); };
  function html() {
    const s = window.WosWorkspaceSync.current; if (!shown()) return '';
    const status = !s.on ? 'Off on this device' : s.ok === false ? 'Offline · your changes sync when you are back' : s.info.at ? `In sync · last change ${ago(s.info.at)}${s.info.device ? ' on ' + s.info.device : ''}` : 'In sync';
    const rows = s.on ? s.closed.slice(0, 6).map(c => `<button class="st-row" data-wsync="reopen" data-wsync-desk="${esc(c.desk.id)}" aria-label="Reopen ${esc(deskName(c.desk))}"><span class="st-ic">▢</span><span class="st-tx"><b>${esc(deskName(c.desk))}</b><small>Closed ${esc(ago(c.closedAt))}${c.device ? ' on ' + esc(c.device) : ''} · tap to reopen</small></span><span class="st-go">↺</span></button>`).join('') : '';
    return `<div class="st-group" data-wsync-group><h4>Workspace sync</h4><button class="st-row" data-wsync="toggle" role="switch" aria-checked="${s.on}"><span class="st-ic">⇄</span><span class="st-tx"><b>Same workspaces on every device</b><small>${esc(status)}</small></span><span class="st-go">${s.on ? 'On' : 'Off'}</span></button></div>${rows ? `<div class="st-group" data-wsync-closed><h4>Recently closed</h4>${rows}</div>` : ''}`;
  }
  function act(ctx, el) {
    const b = el.closest('[data-wsync]'), s = window.WosWorkspaceSync.current; if (!b || !s) return false;
    if (b.dataset.wsync === 'toggle') { s.setOff(s.on); ctx.toast?.('⇄', s.on ? 'Workspace sync on' : 'Workspace sync off on this device', 1800); }
    if (b.dataset.wsync === 'reopen') { const id = b.dataset.wsyncDesk; if (id && s.reopen(id)) ctx.toast?.('▢', 'Reopened', 1600); }
    ctx.render?.(); return true;
  }
  window.WosWorkspaceSync = { create, merge, reconcile, norm, syncable, html, current: null };
  try { window.WosSettings?.register({ id: 'workspace-sync', page: 'chats', aliases: ['workspace-sync', 'workspaces'], available: shown, html, act }); } catch (e) { console.error(e); }
})();
