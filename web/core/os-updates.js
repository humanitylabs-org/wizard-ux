/* Wizard OS · Settings → My release (or Updates on a stock box): one update card, Your changes, Automatic / Ask me.
 *
 * The box updates the one documented way: the App Manager reruns the installer (`os.sh | bash -s start`).
 * Automatic (the default) does that by itself, skipping while a chat run is active; Ask me waits for a tap.
 *
 * Same path as the Store's Get: `../store-install/_updates` is the App Manager's owner-only listener behind
 * Tailscale Serve (owner login, the shell's own Origin, JSON + X-Wizard-Store). No token reaches the browser.
 *   GET                       {mode, chosen, channel?, installed, latest, stable?, update_available, unpinned,
 *                              checked, installing, interrupted, release?}
 *       release (a My release box, wizard-os#186): {name, base, build, behind, new:[{sha,title}], building,
 *                              failed, checked_at}; update_available = behind > 0.
 *   POST {"mode":"auto"|"ask"} the owner's choice (kept across installer reruns)
 *   POST {"channel":"stable"|"latest"} release channel (stock boxes; a release box always builds on Latest)
 *   POST {"action":"apply"}    start the update now → {started:true, …}
 * A box whose App Manager has no such route (older, or no Serve mount) shows nothing.
 *
 * My release: ../my-release.json {name, base:{ref,label}, build?, built_at?, changes:[{sha,title,label?,status,date}]}
 * names the owner's own changes layered on Latest. Each Mine change offers Propose: Settings closes and a fresh chat
 * opens with the change attached as a reply (the shell's openContextDraft hook); the composer stays empty.
 *
 * One card, same look for every state; only the words change (Miguel, 24 Oct):
 *   reload    my-release.json now names another build than this page loaded → "New build ready" · Reload
 *             (after an update: "Update installed"). Polled every 60 s and when the page becomes visible.
 *   building  "Updating…" · "Your changes are being reapplied" · button disabled
 *   failed    "Couldn’t update" · short reason · Try again
 *   behind    Ask me and Latest has N new changes → "N new changes on Latest" · "Get them under your release" · Update
 *   nothing to do → no card.
 *
 *   WosUpdates.card()        → {state, title, line, action, label, disabled, more?} or null
 *   WosUpdates.cardHtml()    → the card's markup ('' when there is nothing to do)
 *   WosUpdates.html()        → the My release / Updates page ('' while unknown or unavailable)
 *   WosUpdates.title()       → the page name: 'My release' on a release box, else 'Updates'
 *   WosUpdates.act(el, ctx)  → handles a [data-osu] tap; true if handled
 *   WosUpdates.load(force)   → refresh the App Manager status (cached 60 s)
 *   WosUpdates.poll()        → re-read my-release.json (and the status) now; the timer and visibility call it
 *   WosUpdates.popup()       → show / hide the Home pop-up now (shells call it when Home comes into view)
 *
 * Home pop-up (wizard-os#186): when the card says Update, Reload or Couldn’t update, Home shows the same words and the
 * same button in a small card clear of the dock, with a ×. × hides it for that exact state (keyed by the build, the
 * Latest sha or the failure) until something new arrives. It replaces the old "Wizard OS was updated · Reload"
 * banner (core/web-update.js asks ownsReload() and stays away while the pop-up has the reload), so only one shows.
 */
(() => {
  'use strict';
  if (window.WosUpdates) return;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const API = new URL('../store-install/_updates', document.currentScript?.src || location.href).href;
  const MINE = new URL('../my-release.json', document.currentScript?.src || location.href).href;
  const FRESH = 60e3;
  // QA can shorten the build poll (window.__wosReleasePollMs before this script runs); 60 s otherwise.
  const POLL = Math.max(1e3, Number(window.__wosReleasePollMs) || 60e3);
  let st = null, at = 0, inflight = null, busy = '', off = false;
  let mine = null, mineOpen = false, newOpen = false;
  // Reload detection: the build this page was loaded with, the newest one seen since, and whether Latest had
  // changes waiting at some point (so a new build can say "Update installed" instead of "New build ready").
  let build0 = '', buildNow = '', sawBehind = false;

  const valid = d => d && typeof d === 'object' && ['auto', 'ask'].includes(d.mode) && 'update_available' in d;
  const rel = () => (st?.release && typeof st.release === 'object' ? st.release : null);
  function changed() { try { window.WosSettings?.refresh(); } catch (_) {} try { popup(); } catch (_) {} }
  function take(d) { st = d; if (rel()?.behind > 0) sawBehind = true; }
  function load(force) {
    if (off && !force) return Promise.resolve(st);
    if (!force && st && Date.now() - at < FRESH) return Promise.resolve(st);
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const r = await fetch(API, { credentials: 'same-origin', cache: 'no-store' });
        const d = r.ok ? await r.json().catch(() => null) : null;
        if (valid(d)) { take(d); off = false; } else if (!st) off = true;
      } catch (_) { if (!st) off = true; }
      at = Date.now(); inflight = null; changed(); return st;
    })();
    return inflight;
  }
  async function post(body) {
    const r = await fetch(API, { method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-Wizard-Store': '1' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok && !d.note) throw new Error(d.error || `The App Manager said ${r.status}`);
    return d;
  }
  async function readMine() {
    try {
      const r = await fetch(MINE, { credentials: 'same-origin', cache: 'no-store' });
      const d = r.ok ? await r.json() : null;
      if (!d || !Array.isArray(d.changes) || !d.base) return;
      const b = typeof d.build === 'string' ? d.build : '';
      if (!mine) { mine = d; build0 = buildNow = b; changed(); return; }
      // Keep showing the changes this page was built with; only note that a newer build exists.
      if (b && b !== buildNow) { buildNow = b; changed(); }
    } catch (_) {}
  }
  // A tick: the build file always (it is tiny), the App Manager while something is happening or on a release box.
  function poll() {
    const work = [readMine()];
    if (st && (rel() || st.installing)) work.push(load(true));
    return Promise.all(work).then(() => card());
  }

  // Every change in my release says where it is headed (wizard-os#186). Anything unlabelled is Mine.
  const KINDS = { mine: 'Mine', feature: 'Proposed feature', fix: 'Proposed fix', merged: 'Merged' };
  const kind = v => { v = String(v || '').toLowerCase(); return v.includes('fix') ? 'fix' : v.includes('feature') ? 'feature' : v.includes('merged') ? 'merged' : 'mine'; };
  // A change in plain words: its own label, else the commit title without a conventional prefix ("fix:", "Docs:",
  // "feat(chats):") or a trailing issue reference ("(wizard-os#186)").
  const PREFIX = /^(?:feat|feature|fix|docs?|chore|refactor|tests?|style|perf|build|ci|revert)(?:\([^)]*\))?!?:\s*/i;
  function label(c) {
    const own = String(c?.label || '').trim(); if (own) return own;
    const t = String(c?.title || '').trim().replace(/\s*\((?:[\w.-]+)?#\d+\)$/, '').replace(PREFIX, '').trim();
    return t ? t[0].toUpperCase() + t.slice(1) : String(c?.sha || '');
  }
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = v => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || '')); return m && +m[2] >= 1 && +m[2] <= 12 ? `${+m[3]} ${MONTHS[m[2] - 1]}` : String(v || ''); };
  const failReason = f => {
    const code = String(typeof f === 'object' ? f?.code || f?.reason || '' : f || '');
    if (/conflict/i.test(code)) return 'Your change clashes with Latest';
    const msg = typeof f === 'object' ? String(f?.message || '').trim() : '';
    return msg && msg.length <= 80 ? msg : 'The update stopped before it finished';
  };

  // The one card. Same shape for every state; null when there is nothing to do.
  function card() {
    const R = rel(), have = st?.installed ? `Wizard OS ${st.installed}` : 'Wizard OS';
    // A new build of my own release (or of the web shell) is on the box: reload to see it.
    const webPending = !!window.WizWebUpdate?.pending;
    if ((build0 && buildNow && buildNow !== build0) || webPending) {
      const installed = sawBehind && !(R?.behind > 0);
      return { state: 'reload', title: installed ? 'Update installed' : 'New build ready', line: 'Reload to see it', action: 'reload', label: 'Reload' };
    }
    if (!st) return null;
    if (R) {
      if (R.building || st.installing) return { state: 'building', title: 'Updating…', line: 'Your changes are being reapplied', action: 'apply', label: 'Update', disabled: true };
      if (R.failed) return { state: 'failed', title: 'Couldn’t update', line: failReason(R.failed), action: 'apply', label: busy === 'apply' ? 'Starting…' : 'Try again', disabled: !!busy };
      const n = Number(R.behind) || 0;
      if (n > 0 && st.mode === 'ask') {
        const more = (Array.isArray(R.new) ? R.new : []).map(label).filter(Boolean);
        return { state: 'behind', title: `${n} new ${n === 1 ? 'change' : 'changes'} on Latest`, line: 'Get them under your release', action: 'apply', label: busy === 'apply' ? 'Starting…' : 'Update', disabled: !!busy, more };
      }
      return null;
    }
    // A stock box: the installer's own release numbers.
    if (st.installing) return { state: 'building', title: 'Updating…', line: 'Takes 10–20 minutes · Wizard reconnects by itself', action: 'apply', label: 'Update', disabled: true };
    if (st.unpinned || !st.update_available) return null;
    const go = busy === 'apply' ? 'Starting…' : st.interrupted ? 'Try again' : 'Update';
    return { state: st.interrupted ? 'failed' : 'behind', title: st.interrupted ? 'Update interrupted' : 'Update available', line: `${have} → ${st.latest}`, action: 'apply', label: go, disabled: !!busy };
  }
  function cardHtml() {
    const c = card(); if (!c) return '';
    const more = c.more?.length ? `<button type="button" class="osu-more" data-osu="new" aria-expanded="${newOpen}">${newOpen ? 'Hide' : 'What’s new'}</button>${newOpen ? `<ul class="osu-new">${c.more.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}` : '';
    return `<div class="osu-card" data-osu-card="${c.state}" role="status"><div class="osu-tx"><b data-osu-title>${esc(c.title)}</b><span>${esc(c.line)}</span>${more}</div><button type="button" class="osu-go" data-osu="${c.action}" ${c.disabled ? 'disabled' : ''}>${esc(c.label)}</button></div>`;
  }
  const title = () => (mine || rel() ? 'My release' : 'Updates');
  const seg = (name, items) => `<div class="st-seg" role="radiogroup" aria-label="${esc(name)}">${items.map(([key, text, on]) => `<button type="button" data-osu="${key}" role="radio" aria-checked="${on}" ${busy ? 'disabled' : ''}>${esc(text)}</button>`).join('')}</div>`;
  function changesHtml() {
    if (!mine) return '';
    const n = mine.changes.length;
    const toggle = `<button type="button" class="rl-toggle" data-osu="mine" aria-expanded="${mineOpen}"><span class="rl-tl">Your changes</span><span class="st-val">${n}</span><span class="st-go" aria-hidden="true">›</span></button>`;
    if (!mineOpen) return toggle;
    const rows = mine.changes.map(c => {
      const k = kind(c.status), name = label(c);
      const go = k === 'mine' ? `<button type="button" class="rl-propose" data-osu="propose" data-sha="${esc(c.sha)}" aria-label="Propose ${esc(name)} to main">Propose</button>` : '';
      return `<li data-osu-change="${esc(c.sha)}"><span class="rl-ct"><b>${esc(name)}</b><span class="rl-meta"><span class="rl-chip rl-${k}">${KINDS[k]}</span>${c.date ? `<small>${esc(day(c.date))}</small>` : ''}</span></span>${go}</li>`;
    }).join('');
    const legend = `<details class="rl-legend"><summary>What the labels mean</summary><p><b>Mine</b> only on your Wizard · <b>Feature</b> review, then Latest, then Stable · <b>Fix</b> fast lane to Stable. All are reapplied on every update.</p></details>`;
    return `${toggle}${n ? `<ul class="rl-changes">${rows}</ul>` : '<p class="st-hint">None yet · everything you have is in main</p>'}${legend}`;
  }
  function stockHead() {
    if (!st || card()) return '';
    const have = st.installed ? `Wizard OS ${st.installed}` : 'Wizard OS';
    const sub = st.unpinned ? 'Updated by hand · not on a release' : !st.checked ? 'Couldn’t check for updates' : 'Up to date';
    return `<div class="rl-head"><b class="rl-name" data-osu-title>${esc(have)}</b><small class="rl-base">${esc(sub)}</small></div>`;
  }
  function html() {
    if (!st && !mine) { if (!off) load(); return ''; }
    if (st && Date.now() - at > FRESH) load();
    const R = rel(), auto = st?.mode === 'auto', release = !!(mine || R);
    const base = mine ? mine.base.label || mine.base.ref : R?.base ? (typeof R.base === 'object' ? R.base.label || R.base.ref : R.base) : '';
    const head = release ? `<div class="rl-head"><b class="rl-name" data-osu-title>${esc(mine?.name || R?.name || 'My release')}</b>${base ? `<small class="rl-base">Built on ${esc(String(base).replace(/^Built on /, ''))}</small>` : ''}</div>` : stockHead();
    // A release box always builds on Latest (the head says so); only a stock box picks a channel.
    const ch = !release && ['stable', 'latest'].includes(st?.channel) ? st.channel : '';
    const channel = ch ? `<div class="rl-sec"><span class="rl-lbl">Channel</span>${seg('Release channel', [['ch-stable', 'Stable', ch === 'stable'], ['ch-latest', 'Latest', ch === 'latest']])}<p class="st-hint">${ch === 'stable' ? 'Tested. Fixes arrive the same day.' : `Every approved change, within hours.${auto ? ' Automatic installs Stable only.' : ''}`}</p></div>` : '';
    const hint = release
      ? (auto ? 'New changes from Latest are applied under yours by themselves.' : 'You choose when. Your own changes always apply right away.')
      : (auto ? 'Overnight, never during a chat.' : 'Nothing installs until you tap Update.');
    const install = st ? `<div class="rl-sec"><span class="rl-lbl">Updates</span>${seg('Updates', [['auto', 'Automatic', auto], ['ask', 'Ask me', !auto]])}<p class="st-hint">${hint}</p></div>` : '';
    return `<div class="st-group rl" data-osu-group>${cardHtml()}${head}${changesHtml()}${install}${channel}</div>`;
  }
  function pick(chan, ctx) {
    if (!['stable', 'latest'].includes(chan) || chan === st.channel) return true;
    busy = 'ch'; ctx?.render?.(); ctx?.haptic?.(8);
    post({ channel: chan }).then(d => {
      if (valid(d)) take(d); else st = { ...st, channel: chan };
      ctx?.toast?.('✓', chan === 'latest' ? (st.mode === 'auto' ? 'Channel: Latest · Automatic still installs Stable only' : 'Channel: Latest') : 'Channel: Stable', 2200);
      at = Date.now();
    }).catch(e => ctx?.toast?.('!', e.message || 'Couldn’t reach the App Manager', 2600))
      .finally(() => { busy = ''; changed(); });
    return true;
  }
  // Propose: close Settings and open a fresh chat with this change attached as a reply bubble (the composer stays
  // empty for the owner's own words). Uses the shell's hook: window.__wos (phone) or window.__wux (desktop).
  function propose(sha, ctx) {
    const c = mine?.changes.find(x => x.sha === sha);
    if (!c || kind(c.status) !== 'mine') return true;
    const open = window.__wux?.openContextDraft || window.__wos?.openContextDraft;
    if (typeof open !== 'function') { ctx?.toast?.('!', 'Couldn’t open a chat for this change here', 2600); return true; }
    ctx?.haptic?.(8);
    try {
      open('release-change:' + sha, { title: `Propose to main: ${label(c)}`, message: `Change ${sha} from my release.\nSay feature or fix, and I'll open the PR.` });
    } catch (e) { ctx?.toast?.('!', e?.message || 'Couldn’t open a chat for this change', 2600); }
    return true;
  }
  // Reload through the shell's guarded reload (waits for a recording, saves first) when it is there.
  function reload() {
    const W = window.WizWebUpdate;
    if (typeof W?.reload === 'function') { W.reload('tap'); return; }
    location.reload();
  }
  function act(el, ctx, event) {
    const b = el.closest('[data-osu]'); if (!b) return false;
    const what = b.dataset.osu;
    if (what === 'mine' || what === 'new') {
      if (what === 'mine') mineOpen = !mineOpen; else newOpen = !newOpen;
      changed();
      // Settings re-renders and puts focus back on the toggle in code, which browsers paint as a keyboard ring.
      // A tap or click (detail > 0) leaves no ring; Enter/Space (detail 0) keeps it for keyboard users.
      if (event?.detail > 0) { const t = ctx?.root?.querySelector?.(`[data-osu="${what}"]`); if (t && t === document.activeElement) t.blur(); }
      return true;
    }
    if (what === 'propose') return propose(b.dataset.sha, ctx);
    if (what === 'reload') { ctx?.haptic?.(8); reload(); return true; }
    if (busy || !st) return true;
    if (what.startsWith('ch-')) return pick(what.slice(3), ctx);
    if ((what === 'auto' || what === 'ask') && what === st.mode && st.chosen) return true;
    if (what === 'apply' && card()?.disabled) return true;
    busy = what; ctx?.render?.(); ctx?.haptic?.(8);
    const body = what === 'apply' ? { action: 'apply' } : { mode: what };
    post(body).then(d => {
      if (what === 'apply') {
        if (d.started) {
          const R = rel();
          st = R ? { ...st, release: { ...R, building: true, failed: null } } : { ...st, installing: true };
          ctx?.toast?.('↻', R ? 'Updating · your changes are being reapplied' : 'Updating Wizard OS · takes 10–20 minutes', 3200);
        } else ctx?.toast?.('!', d.note || d.error || 'Already up to date', 2600);
      } else {
        if (valid(d)) take(d); else st = { ...st, mode: what, chosen: true };
        ctx?.toast?.('✓', what === 'auto' ? 'Updates: Automatic' : 'Updates: Ask me', 1800);
      }
      at = Date.now();
    }).catch(e => ctx?.toast?.('!', e.message || 'Couldn’t reach the App Manager', 2600))
      .finally(() => { busy = ''; changed(); if (what === 'apply') setTimeout(() => load(true), 1500); });
    return true;
  }
  /* ---- Home pop-up ---- */
  const POP_STATES = ['behind', 'reload', 'failed'], DISMISS = 'wos.osu.dismissed';
  const store = { get() { try { return window.localStorage.getItem(DISMISS) || ''; } catch (_) { return ''; } }, set(v) { try { window.localStorage.setItem(DISMISS, v); } catch (_) {} } };
  // One key per state worth telling: a new build, new commits on Latest, or a new failure each count as new.
  function popKey(c) {
    if (!c || !POP_STATES.includes(c.state)) return '';
    const R = rel(), W = window.WizWebUpdate;
    if (c.state === 'reload') return 'reload:' + (buildNow && buildNow !== build0 ? buildNow : W?.version || 'web');
    if (c.state === 'failed') return 'failed:' + (R ? `${R.base || ''}:${typeof R.failed === 'object' ? R.failed?.code || R.failed?.at || '' : R.failed}` : st?.latest || '');
    const last = Array.isArray(R?.new) && R.new.length ? R.new[R.new.length - 1]?.sha || R.new[0]?.sha : '';
    return 'behind:' + (R ? `${last || ''}:${R.behind}` : st?.latest || '');
  }
  // Home in view, nothing over it: phone desk 0 with no windows and no sheet; desktop Home or an empty desk, no Settings.
  function homeInView() {
    if (typeof document === 'undefined' || document.hidden || document.querySelector?.('.mz-intro, .rs-sheet, .wos-burst, .tour.on')) return false;
    const P = window.__wos, D = window.__wux;
    if (D) return !!(D.homeOpen || !D.ws?.[D.cur]?.wins?.length) && !document.querySelector?.('.dsettings:not([hidden])');
    if (P) return P.idx === 0 && !P.sheet && !P.desks?.[0]?.wins?.length;
    return false;
  }
  function ownsReload() { const c = card(); if (c?.state !== 'reload') return false; const k = popKey(c); return k === store.get() || popShown === k; }
  let popEl = null, popShown = '', popTimer = 0;
  const popCtx = () => { const H = window.__wos || window.__wux; return { toast: (...a) => H?.toast?.(...a), haptic: n => { try { navigator.vibrate?.(n); } catch (_) {} }, render: () => popup(), root: popEl }; };
  // Phone: sit just above the dock (measured, so any skin's pill or orb stays clear); desktop: under the top bar, right.
  function place() {
    if (!popEl || window.__wux) return;
    const dock = document.querySelector('#dock, .dock'), r = dock?.getBoundingClientRect?.();
    const vh = window.innerHeight || 0, top = r && r.height ? Math.min(r.top, vh) : vh - 140;
    popEl.style.bottom = Math.max(16, vh - top + 12) + 'px';
  }
  function popup() {
    if (typeof document === 'undefined' || !document.body) return;
    const c = card(), k = popKey(c), show = !!k && k !== store.get() && homeInView();
    const was = popShown; popShown = show ? k : '';
    if (!show) { if (popEl) { popEl.remove(); popEl = null; } }
    else {
      if (!popEl) {
        popEl = document.createElement('div'); popEl.className = 'osu-pop'; popEl.setAttribute('role', 'status'); popEl.setAttribute('aria-live', 'polite');
        popEl.dataset.shell = window.__wux ? 'desktop' : 'phone';
        popEl.addEventListener('click', e => {
          const x = e.target.closest('[data-osu-dismiss]');
          if (x) { store.set(popEl?.dataset.key || ''); popup(); return; }
          if (e.target.closest('[data-osu]')) act(e.target, popCtx(), e);
          popup();
        });
        document.body.appendChild(popEl);
      }
      const armed = c.state === 'reload' && window.WizWebUpdate?.armed;
      const html = `<div class="osu-pop-tx"><b>${esc(c.title)}</b><span>${esc(c.line)}</span></div><button type="button" class="osu-pop-go" data-osu="${c.action}" ${c.disabled ? 'disabled' : ''}>${esc(armed ? 'Waiting…' : c.label)}</button><button type="button" class="osu-pop-x" data-osu-dismiss aria-label="Dismiss">×</button>`;
      if (popEl.dataset.key !== k || popEl.dataset.html !== html) { popEl.innerHTML = html; popEl.dataset.key = k; popEl.dataset.html = html; popEl.dataset.state = c.state; }
      place();
    }
    // The old "Wizard OS was updated" banner steps aside while the pop-up has the reload (and after its ×).
    if (was !== popShown) { try { window.WizWebUpdate?.render?.(); } catch (_) {} }
    // Home comes and goes without telling this module; while there is something to say, look again every second.
    clearInterval(popTimer); popTimer = 0;
    if (k && k !== store.get() && typeof setInterval === 'function') { popTimer = setInterval(popup, 1000); popTimer?.unref?.(); }
  }
  window.WosUpdates = { html, act, load, poll, card, cardHtml, title, kind, label, popup, popKey, ownsReload, homeInView, get state() { return st; }, get mine() { return mine; }, get build() { return { loaded: build0, now: buildNow }; } };
  window.WosSettings?.register({ id: 'updates', page: 'release', aliases: ['updates', 'release', 'my-release'], available: () => !!(st || mine), html: () => html(), act: (ctx, el, event) => act(el, ctx, event) });
  load();
  readMine();
  // Only a release that names its build can say a new one is ready; an older box polls nothing new.
  const tick = () => { if (build0 || rel() || st?.installing) poll(); };
  const timer = typeof setInterval === 'function' ? setInterval(() => { if (!document.hidden) tick(); }, POLL) : 0;
  timer?.unref?.();
  document.addEventListener?.('visibilitychange', () => { if (!document.hidden) tick(); });
  window.addEventListener?.('wos-native-resume', tick);
})();
