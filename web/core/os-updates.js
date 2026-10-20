/* Wizard OS · Settings → Updates: Automatic / Ask me, installed vs latest, Update now.
 *
 * The box updates the one documented way: the App Manager reruns the installer (`os.sh | bash -s start`) onto the
 * release `releases/stable` names. Automatic (the default) does that overnight, skipping while a chat run is
 * active; Ask me only shows "Update available · Update now" here.
 *
 * Same path as the Store's Get: `../store-install/_updates` is the App Manager's owner-only listener behind
 * Tailscale Serve (owner login, the shell's own Origin, JSON + X-Wizard-Store). No token reaches the browser.
 *   GET                       {mode, chosen, installed, latest, update_available, unpinned, checked, installing}
 *   POST {"mode":"auto"|"ask"} the owner's choice (kept across installer reruns)
 *   POST {"action":"apply"}    start the update now
 * A box whose App Manager has no such route (older, or no Serve mount) shows nothing.
 *
 *   WosUpdates.html()       → the Settings group ('' while unknown or unavailable)
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

  function summary(s) {
    if (s.installing) return ['Updating…', 'Takes 10–20 minutes · Wizard reconnects by itself'];
    if (s.unpinned) return ['Updated by hand', 'This Wizard isn’t on a release, so updates leave it alone'];
    const have = s.installed ? `Wizard OS ${s.installed}` : 'Wizard OS';
    if (s.update_available) return ['Update available', `${have} → ${s.latest}`];
    if (!s.checked) return [have, 'Couldn’t check for updates · trying again later'];
    return [have, 'Up to date'];
  }
  function html() {
    if (!st) { if (!off) load(); return ''; }
    if (Date.now() - at > FRESH) load();
    const [title, sub] = summary(st), auto = st.mode === 'auto';
    const opt = (key, title, sub, on) => `<button class="st-row" data-osu="${key}" role="radio" aria-checked="${on}" ${busy ? 'disabled' : ''}><span class="st-ic">${key === 'auto' ? '↻' : '?'}</span><span class="st-tx"><b>${esc(title)}</b><small>${esc(sub)}</small></span><span class="st-go">${on ? '●' : '○'}</span></button>`;
    const now = st.update_available && !st.installing && !st.unpinned
      ? `<button class="st-wide" data-osu="apply" ${busy ? 'disabled' : ''}>${busy === 'apply' ? 'Starting…' : 'Update now'}</button>` : '';
    return `<div class="st-group" data-osu-group><h4>Updates</h4><div class="st-row static"><span class="st-ic">◇</span><span class="st-tx"><b data-osu-title>${esc(title)}</b><small>${esc(sub)}</small></span></div>${now ? `<div style="margin:0 0 8px">${now}</div>` : ''}<div role="radiogroup" aria-label="Updates">${opt('auto', 'Automatic', 'New releases install overnight, never during a chat', auto)}${opt('ask', 'Ask me', 'Shows Update here · nothing installs by itself', !auto)}</div></div>`;
  }
  function act(el, ctx) {
    const b = el.closest('[data-osu]'); if (!b || busy || !st) return !!b;
    const what = b.dataset.osu;
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
  window.WosUpdates = { html, act, load, get state() { return st; } };
  window.WosSettings?.register({ id: 'updates', aliases: ['updates'], available: () => !!st, html: () => html(), act: (ctx, el) => act(el, ctx) });
  load();
})();
