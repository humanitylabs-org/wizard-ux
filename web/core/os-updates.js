/* Wizard OS · Settings → My release & updates: what you are on, Your changes, Channel, Automatic / Ask me, Update now.
 *
 * The box updates the one documented way: the App Manager reruns the installer (`os.sh | bash -s start`) onto the
 * release `releases/stable` names. Automatic (the default) does that overnight, skipping while a chat run is
 * active; Ask me only shows "Update available · Update now" here.
 *
 * Same path as the Store's Get: `../store-install/_updates` is the App Manager's owner-only listener behind
 * Tailscale Serve (owner login, the shell's own Origin, JSON + X-Wizard-Store). No token reaches the browser.
 *   GET                       {mode, chosen, installed, latest, update_available, unpinned, checked, installing,
 *                              interrupted (the last update was cut short, e.g. by a reboot; it is retried)}
 *   POST {"mode":"auto"|"ask"} the owner's choice (kept across installer reruns)
 *   POST {"channel":"stable"|"latest"} release channel (DECISIONS #75): stable = promoted releases (default),
 *                              latest = every release, for testers. GET then also returns {channel, stable};
 *                              `latest` is this box's channel release. Automatic installs stable only, either way.
 *                              An App Manager without channels returns no `channel`, so the picker stays hidden.
 *   POST {"action":"apply"}    start the update now
 * A box whose App Manager has no such route (older, or no Serve mount) shows nothing.
 *
 * My release (wizard-os#186): ../my-release.json {name, base:{ref,label}, changes:[{sha,title,status,date}]} names the
 * owner's own changes layered on the channel; status is Mine (default), Proposed feature, Proposed fix or Merged.
 *
 *   WosUpdates.hero()       → {title, lines, state, tone} for the Settings index card (null while unknown)
 *   WosUpdates.html()       → the My release & updates page ('' while unknown or unavailable)
 *   WosUpdates.act(el, ctx) → handles a [data-osu] tap; true if handled
 *   WosUpdates.load(force)  → refresh the status (cached 60 s here; the App Manager caches stable ~10 min)
 */
(() => {
  'use strict';
  if (window.WosUpdates) return;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const API = new URL('../store-install/_updates', document.currentScript?.src || location.href).href;
  const FRESH = 60e3;
  let st = null, at = 0, inflight = null, busy = '', off = false;
  // My release (wizard-os#186): an owner's own changes on top of a channel. The box writes my-release.json next to
  // the shell when it builds one; a box without it shows nothing new.
  const MINE = new URL('../my-release.json', document.currentScript?.src || location.href).href;
  let mine = null, mineOpen = false;

  const valid = d => d && typeof d === 'object' && ['auto', 'ask'].includes(d.mode) && 'update_available' in d;
  function changed() { try { window.WosSettings?.refresh(); } catch (_) {} }
  function load(force) {
    if (off && !force) return Promise.resolve(st);
    if (!force && st && Date.now() - at < FRESH) return Promise.resolve(st);
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const r = await fetch(API, { credentials: 'same-origin', cache: 'no-store' });
        const d = r.ok ? await r.json().catch(() => null) : null;
        if (valid(d)) { st = d; off = false; } else if (!st) off = true;
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

  // Every change in my release says where it is headed (wizard-os#186). Anything unlabelled is Mine.
  const KINDS = { mine: 'Mine', feature: 'Proposed feature', fix: 'Proposed fix', merged: 'Merged' };
  const kind = v => { v = String(v || '').toLowerCase(); return v.includes('fix') ? 'fix' : v.includes('feature') ? 'feature' : v.includes('merged') ? 'merged' : 'mine'; };
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  function summary(s) {
    if (s.installing) return ['Updating…', 'Takes 10–20 minutes · Wizard reconnects by itself'];
    if (s.unpinned && !mine) return ['Updated by hand', 'This Wizard isn’t on a release, so updates leave it alone'];
    const have = s.installed ? `Wizard OS ${s.installed}` : 'Wizard OS';
    // The last update was cut short (the box restarted mid-update): the App Manager has cleared it so it can rerun.
    if (s.interrupted && s.update_available) return s.mode === 'auto'
      ? ['Update interrupted · retrying', `${have} → ${s.latest} · tries again tonight, or tap Update now`]
      : ['Update interrupted', `${have} → ${s.latest} · tap Update now to try again`];
    if (s.update_available) return ['Update available', `${have} → ${s.latest}`];
    if (!s.checked) return [have, 'Couldn’t check for updates · trying again later'];
    return [have, 'Up to date'];
  }
  // What you are on, in one card: the Settings index and the My release page both use it.
  function hero() {
    if (!st && !mine) return null;
    const [title, sub] = st ? summary(st) : ['', ''];
    const tone = st?.installing ? 'busy' : st?.update_available ? 'ready' : st && st.checked && !st.unpinned ? 'ok' : '';
    if (!mine) return { title: title || 'Wizard OS', lines: sub ? [sub] : [], state: '', tone };
    const state = !st ? '' : title.startsWith('Wizard OS') ? (sub === 'Up to date' ? 'Up to date' : sub) : title;
    return { title: mine.name || 'My release', lines: [`Built on ${mine.base.label || mine.base.ref}`, plural(mine.changes.length, 'change of your own', 'changes of your own')], state, tone, mine: true };
  }
  const seg = (label, items) => `<div class="st-seg" role="radiogroup" aria-label="${esc(label)}">${items.map(([key, name, on]) => `<button type="button" data-osu="${key}" role="radio" aria-checked="${on}" ${busy ? 'disabled' : ''}>${esc(name)}</button>`).join('')}</div>`;
  function changesHtml() {
    if (!mine) return '';
    const n = mine.changes.length, counts = {};
    for (const c of mine.changes) { const k = kind(c.status); counts[k] = (counts[k] || 0) + 1; }
    const tally = Object.keys(KINDS).filter(k => counts[k]).map(k => `${counts[k]} ${KINDS[k].replace('Proposed ', '').toLowerCase()}`).join(' · ');
    const toggle = `<button type="button" class="rl-toggle" data-osu="mine" aria-expanded="${mineOpen}"><span class="st-tx"><b>Your changes</b><small>${esc(tally || 'Kept on every update')}</small></span><span class="st-go" aria-hidden="true">›</span></button>`;
    if (!mineOpen) return toggle;
    const rows = mine.changes.map(c => { const k = kind(c.status); return `<li data-osu-change="${esc(c.sha)}"><span class="rl-ct"><b>${esc(c.title)}</b>${c.date ? `<small>${esc(c.date)}</small>` : ''}</span><span class="rl-chip rl-${k}">${KINDS[k]}</span></li>`; }).join('');
    const legend = `<dl class="rl-legend"><div><dt><span class="rl-chip rl-mine">Mine</span></dt><dd>Only on your Wizard</dd></div><div><dt><span class="rl-chip rl-feature">Proposed feature</span></dt><dd>Review, then Latest, then Stable</dd></div><div><dt><span class="rl-chip rl-fix">Proposed fix</span></dt><dd>Fast lane to Stable</dd></div></dl>`;
    return `${toggle}${n ? `<ul class="rl-changes">${rows}</ul>` : '<p class="st-hint">None yet · everything you have is in main</p>'}${legend}<p class="st-hint">All of them are reapplied on every update.</p>`;
  }
  function html() {
    if (!st && !mine) { if (!off) load(); return ''; }
    if (st && Date.now() - at > FRESH) load();
    const h = hero(), auto = st?.mode === 'auto';
    const now = st?.update_available && !st.installing && !st.unpinned
      ? `<button type="button" class="st-primary" data-osu="apply" ${busy ? 'disabled' : ''}>${busy === 'apply' ? 'Starting…' : 'Update now'}</button>` : '';
    const head = `<div class="rl-hero"><b class="rl-name" data-osu-title>${esc(h.title)}</b>${h.lines.map((l, i) => `<small${i ? '' : ' class="rl-base"'}>${esc(l)}</small>`).join('')}${h.state ? `<span class="rl-state ${h.tone}">${esc(h.state)}</span>` : ''}${now}</div>`;
    const ch = ['stable', 'latest'].includes(st?.channel) ? st.channel : '';
    const channel = ch ? `<h4>Channel</h4>${seg('Release channel', [['ch-stable', 'Stable', ch === 'stable'], ['ch-latest', 'Latest', ch === 'latest']])}<p class="st-hint">${ch === 'stable' ? 'Tested. Fixes arrive the same day.' : `Every approved change, within hours.${auto ? ' Automatic installs Stable only.' : ''}`}</p>` : '';
    const install = st ? `<h4>Install updates</h4>${seg('Install updates', [['auto', 'Automatic', auto], ['ask', 'Ask me', !auto]])}<p class="st-hint">${auto ? 'Overnight, never during a chat.' : 'Nothing installs until you tap Update now.'}</p>` : '';
    return `<div class="st-group rl" data-osu-group>${head}${changesHtml()}${channel}${install}</div>`;
  }
  function pick(chan, ctx) {
    if (!['stable', 'latest'].includes(chan) || chan === st.channel) return true;
    busy = 'ch'; ctx?.render?.(); ctx?.haptic?.(8);
    post({ channel: chan }).then(d => {
      st = valid(d) ? d : { ...st, channel: chan };
      ctx?.toast?.('✓', chan === 'latest' ? (st.mode === 'auto' ? 'Channel: Latest · Automatic still installs Stable only' : 'Channel: Latest') : 'Channel: Stable', 2200);
      at = Date.now();
    }).catch(e => ctx?.toast?.('!', e.message || 'Couldn’t reach the App Manager', 2600))
      .finally(() => { busy = ''; changed(); });
    return true;
  }
  function act(el, ctx) {
    const b = el.closest('[data-osu]'); if (!b) return false;
    const what = b.dataset.osu;
    if (what === 'mine') { mineOpen = !mineOpen; changed(); return true; }
    if (busy || !st) return true;
    if (what.startsWith('ch-')) return pick(what.slice(3), ctx);
    if ((what === 'auto' || what === 'ask') && what === st.mode && st.chosen) return true;
    busy = what; ctx?.render?.(); ctx?.haptic?.(8);
    const body = what === 'apply' ? { action: 'apply' } : { mode: what };
    post(body).then(d => {
      if (what === 'apply') {
        if (d.started) { st = { ...st, installing: true }; ctx?.toast?.('↻', 'Updating Wizard OS · takes 10–20 minutes', 3200); }
        else ctx?.toast?.('!', d.note || d.error || 'Already up to date', 2600);
      } else {
        st = valid(d) ? d : { ...st, mode: what, chosen: true };
        ctx?.toast?.('✓', what === 'auto' ? 'Updates: Automatic' : 'Updates: Ask me', 1800);
      }
      at = Date.now();
    }).catch(e => ctx?.toast?.('!', e.message || 'Couldn’t reach the App Manager', 2600))
      .finally(() => { busy = ''; changed(); if (what === 'apply') setTimeout(() => load(true), 1500); });
    return true;
  }
  window.WosUpdates = { html, act, load, hero, kind, get state() { return st; }, get mine() { return mine; } };
  window.WosSettings?.register({ id: 'updates', page: 'release', aliases: ['updates', 'release', 'my-release'], available: () => !!(st || mine), html: () => html(), act: (ctx, el) => act(el, ctx) });
  load();
  fetch(MINE, { credentials: 'same-origin', cache: 'no-store' }).then(r => r.ok ? r.json() : null)
    .then(d => { if (d && Array.isArray(d.changes) && d.base) { mine = d; changed(); } }).catch(() => {});
})();
