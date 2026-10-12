/* Wizard OS preview controls (after app.js, core/skins.js and demo/theme-host.js). Preview only.
 *
 *   Skin        WosSkin.set(id): the existing skins module re-dresses the real shell; theme-host forwards the
 *               new tokens to every sample app.
 *   Comparison  CustomEvent('wizard:comparison', { detail: { comparison } }) on window, cancelable, and
 *               html[data-comparison]. Unless a listener calls preventDefault(), the controls also hand it to
 *               WizardAppearance.setComparison() so the apps switch palettes over the same content.
 *   Open        CustomEvent('wizard:open', { detail: { app } }) (or { app: 'architecture', path }), cancelable.
 *               Default (on the next task, so any listener can claim it): the shell's own deep-link route
 *               (?open=<id> → its registry → openApp: placement, desks and Back stay the shell's), or for a
 *               page path __wos.openLinkDesk(). Nothing ever navigates the top page away.
 *   First view  Unless the URL asked for a deep link, the desk holding Wisdom is brought to the front.
 * Back: an open sheet registers its own CloseWatcher (Chrome), so the first Back closes it.
 */
(() => {
  'use strict';
  const root = document.documentElement;
  const NS = 'wos.preview.';
  const device = document.getElementById('device');
  if (!device || !window.__wos) return; // the shell did not boot: nothing to control
  const W = () => window.__wos;
  const toast = (i, t, ms = 1600) => { try { W().toast(i, t, ms); } catch (e) {} };
  const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const SWATCH = { nebula: ['#05030c', '#8f63ff'], grove: ['#0e2116', '#7ddc8a'], paper: ['#f6f3ec', '#d9462b'], tide: ['#052a36', '#3fd2c0'], ember: ['#140a06', '#ff8a3d'], signal: ['#000000', '#39ff8c'] };
  const SKINS = (window.WosSkin?.list || []).filter(s => SWATCH[s.id]);
  const APPS = [['wisdom', 'Wisdom'], ['wizard-music', 'Music'], ['wizard-signal', 'Signal'], ['topics', 'Topics']];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------------- comparison ---------------- */
  function setComparison(value, { quiet = false } = {}) {
    const comparison = value === 'original' ? 'original' : 'unified';
    root.dataset.comparison = comparison; set(NS + 'comparison', comparison);
    const ev = new CustomEvent('wizard:comparison', { detail: { comparison }, cancelable: true });
    const free = dispatchEvent(ev);
    if (free) window.WizardAppearance?.setComparison?.(comparison);
    paint();
    if (!quiet) toast('◐', comparison === 'original' ? 'Original app colours' : 'Unified with Wizard OS', 1400);
  }

  /* ---------------- open ---------------- */
  function open(detail) { dispatchEvent(new CustomEvent('wizard:open', { detail, cancelable: true })); }
  addEventListener('wizard:open', e => {
    setTimeout(() => {
      if (e.defaultPrevented) return;
      const d = e.detail || {};
      if (d.path) {
        let ok = false; try { ok = W().openLinkDesk(new URL(d.path, location.href).href, null); } catch (err) {}
        if (!ok) toast('◇', `Couldn’t open ${esc(d.path)}`, 1800);
        return;
      }
      if (!d.app || !/^[a-z0-9-]{1,40}$/.test(d.app)) return;
      const ok = window.WizCore?.deeplink?.route(new URL('./?open=' + encodeURIComponent(d.app), location.href).href);
      if (!ok) toast('◇', 'The app list is still loading', 1600);
    }, 0);
  });

  /* ---------------- UI ---------------- */
  const wrap = document.createElement('div');
  wrap.className = 'pv';
  wrap.innerHTML = `<button class="pv-pill" type="button" aria-expanded="false" aria-controls="pvSheet">Preview <i aria-hidden="true">▾</i></button>
    <section id="pvSheet" class="pv-sheet" role="dialog" aria-label="Preview controls" hidden>
      <header class="pv-head"><strong>Preview</strong><span>Sample apps · read-only</span><button class="pv-x" type="button" data-pv="close" aria-label="Close preview controls">✕</button></header>
      <div class="pv-label" id="pvSkinL">Skin</div>
      <div class="pv-skins" role="radiogroup" aria-labelledby="pvSkinL">${SKINS.map(s => `<button class="pv-skin" type="button" role="radio" data-skin="${s.id}" aria-checked="false" style="--s-bg:${SWATCH[s.id][0]};--s-ac:${SWATCH[s.id][1]}"><b aria-hidden="true"></b>${esc(s.name)}</button>`).join('')}</div>
      <div class="pv-label" id="pvCmpL">App colours</div>
      <div class="pv-seg" role="radiogroup" aria-labelledby="pvCmpL"><button type="button" role="radio" data-cmp="unified" aria-checked="true">Unified<small>Follows the skin</small></button><button type="button" role="radio" data-cmp="original" aria-checked="false">Original<small>Each app’s own</small></button></div>
      <div class="pv-label">Open</div>
      <div class="pv-apps">${APPS.map(([id, n]) => `<button class="pv-app" type="button" data-app="${id}">${n}</button>`).join('')}<button class="pv-app wide" type="button" data-arch>Architecture notes</button></div>
      <p class="pv-foot">Same content in both colour modes. Nothing here is live: no messages, recordings or saves leave this preview.</p>
    </section>`;
  device.appendChild(wrap);
  const pill = wrap.querySelector('.pv-pill'), sheet = wrap.querySelector('.pv-sheet');
  let watcher = null;
  function paint() {
    const cur = window.WosSkin?.current || root.dataset.skin || 'nebula', cmp = root.dataset.comparison === 'original' ? 'original' : 'unified';
    wrap.querySelectorAll('[data-skin]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.skin === cur)));
    wrap.querySelectorAll('[data-cmp]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.cmp === cmp)));
  }
  function show(on) {
    if (on === !sheet.hidden) return;
    sheet.hidden = !on; pill.setAttribute('aria-expanded', String(on));
    try { watcher?.destroy(); } catch (e) {} watcher = null;
    if (on) {
      paint();
      if ('CloseWatcher' in window) { try { watcher = new CloseWatcher(); watcher.onclose = () => { watcher = null; show(false); }; } catch (e) { watcher = null; } }
      sheet.querySelector('[aria-checked="true"]')?.focus({ preventScroll: true });
    }
  }
  pill.addEventListener('click', e => { e.stopPropagation(); show(sheet.hidden); });
  sheet.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.pv === 'close') { show(false); pill.focus({ preventScroll: true }); return; }
    if (b.dataset.skin) { window.WosSkin?.set(b.dataset.skin); paint(); return; }
    if (b.dataset.cmp) { setComparison(b.dataset.cmp); return; }
    if (b.dataset.app) { show(false); open({ app: b.dataset.app }); return; }
    if (b.hasAttribute('data-arch')) { show(false); open({ app: 'architecture', path: 'demo/architecture.html' }); }
  });
  sheet.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); show(false); pill.focus({ preventScroll: true }); } });
  // A touch anywhere else closes it (the shell still gets that touch).
  document.addEventListener('pointerdown', e => { if (!sheet.hidden && !wrap.contains(e.target)) show(false); }, true);
  // The candidate shell delegates its top Back step here, including iframe and history fallbacks.
  function back() { if (sheet.hidden) return null; show(false); return 'preview-controls'; }

  /* ---------------- boot ---------------- */
  const stored = get(NS + 'comparison');
  if (stored === 'original') setComparison('original', { quiet: true }); else paint();
  if (!window.WosPreview?.explicit) {
    const wins = W().wins || {}, desks = W().desks || [];
    const wid = Object.keys(wins).find(id => wins[id].app === 'frame' && wins[id].appId === 'wisdom' && !wins[id].from);
    const at = wid ? desks.findIndex(d => d.wins.includes(wid)) : -1;
    if (at >= 0) { if (W().idx !== at) W().goDesk(at, true); }
    else open({ app: 'wisdom' });
  }
  window.WosPreviewControls = { open, setComparison, show, back };
})();
