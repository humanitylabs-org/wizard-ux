/* Setup's single Recommended next list. Store owns authorization, release selection,
 * install jobs and routing; this view never supplies a download URL or repo ref. */
(() => {
  'use strict';
  const BASE = '../store-install/';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
  let apps = [], status = 'loading', changed = () => {}, onScreen = () => true, alive = true;
  const busy = new Set(), errors = new Map();
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function request(path, body) {
    const r = await fetch(BASE + path, {credentials:'same-origin',cache:'no-store',
      ...(body ? {method:'POST',headers:{'Content-Type':'application/json','X-Wizard-Store':'1'},body:JSON.stringify(body)} : {})});
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Error(data.error || 'The App Manager is unavailable. Try again.');
    return data;
  }
  async function load() {
    try {
      const data = await request('_recommended');
      if (!Array.isArray(data.apps)) throw Error('Invalid recommendations');
      apps = data.apps.filter(a => ID.test(a.id)); status = 'ok';
    } catch (_) { status = 'error'; }
    changed();
  }
  function html() {
    let h = '<section class="recommended" aria-label="Recommended next"><h2>Recommended next</h2><p class="intro">Optional. Install only what you want, then sign in. Nothing runs until you choose it.</p>';
    if (status === 'loading') return h + '<p class="muted">Checking available apps…</p></section>';
    if (status === 'error') return h + '<p class="muted">Recommendations aren’t available right now.</p><button class="link" data-recommended-retry>Try again</button></section>';
    h += '<div class="rows">';
    for (const a of apps) {
      const waiting = busy.has(a.id), blocked = !a.installed && !a.selection;
      const label = waiting ? 'Installing…' : a.installed ? 'Open sign-in' : blocked ? 'Not available yet' : 'Install and sign in';
      h += `<button class="row" data-recommended="${esc(a.id)}" ${waiting || blocked ? 'disabled' : ''}><span class="bd"><b>${esc(a.name)}</b><small>${esc(errors.get(a.id) || a.unavailable || a.summary)}</small></span><span class="end recommended-action">${label}</span></button>`;
    }
    return h + '</div></section>';
  }
  function open(id) {
    if (parent !== window) parent.postMessage({type:'wizard:open-app',id}, location.origin);
    else location.href = '../?open=' + encodeURIComponent(id);
  }
  async function install(id) {
    const a = apps.find(a => a.id === id);
    if (!a || busy.has(id)) return;
    if (a.installed) { open(id); return; }
    if (!a.selection) return;
    const selection = {...a.selection};
    busy.add(id); errors.delete(id); changed();
    try {
      let result = await request(encodeURIComponent(id), selection);
      for (let i=0; result.state === 'installing' && i<360 && alive; i++) {
        await sleep(2500);
        if (!alive) return;
        result = await request(encodeURIComponent(id));
      }
      if (result.state !== 'installed') throw Error(result.error || 'Installation has not finished. Try again to check.');
      if (!result.selection || ['source','repo','commit','operation'].some(k => result.selection[k] !== selection[k])) throw Error('The installed release did not match. Refresh before retrying.');
      a.installed = true;
      if (parent !== window) parent.postMessage({type:'wizard:apps-changed',id}, location.origin);
      // Never steal focus if the owner left Setup while the install was running.
      if (alive && onScreen()) open(id);
    } catch (e) { errors.set(id, e.message || 'Installation failed. Try again.'); }
    finally { busy.delete(id); changed(); }
  }
  async function prefetch() {
    try { await request('_recommended', {}); } catch (_) { /* best effort: install still pulls normally */ }
  }
  document.addEventListener('click', e => {
    const retry = e.target.closest('[data-recommended-retry]');
    if (retry) { load(); return; }
    const button = e.target.closest('[data-recommended]');
    if (button) install(button.dataset.recommended);
  });
  addEventListener('pagehide', () => { alive = false; });
  window.WosRecommended = {html, load, prefetch,
    init(render, visible) { changed = render; onScreen = visible; },
  };
})();
