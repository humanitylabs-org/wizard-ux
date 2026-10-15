/* Wizard App Store: an app-discovery app that runs in its own Wizard window (or on its own).
 * Listings come from the public Wizard App Index; "installed" from this Wizard's Runtipi; "Open" asks the shell.
 * Get asks this Wizard's App Manager to install the app (owner only); progress shows on the button. Back: detail → list → Store root,
 * through the shell's canonical hook (window.__wizardCloseOverlay); standalone it guards its own history. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const DATA = '../store-data/';
  const framed = window.top !== window;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const KINDS = [
    { id: 'apps', type: 'view', one: 'App', many: 'Apps', blurb: 'Things you open and use' },
    { id: 'agent-apps', type: 'service', one: 'Agent app', many: 'Agent apps', blurb: 'New skills for your agent' },
    { id: 'agents', type: 'agent', one: 'Agent', many: 'Agents', blurb: 'The minds that run Wizard' },
    { id: 'connections', type: 'external', one: 'Connection', many: 'Connections', blurb: 'Accounts your agents can use' },
  ];
  const KIND_OF = Object.fromEntries(KINDS.map(k => [k.type, k]));
  const kindOf = a => KIND_OF[a.type] || KINDS[1];
  // Four quiet entry points; category lists and app details retain their existing layout.
  const KIND_ICONS = {
    apps: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    'agent-apps': '<path d="m14 3-9 11h7l-2 7 9-11h-7l2-7Z"/>',
    agents: '<rect x="4" y="7" width="16" height="13" rx="4"/><path d="M12 3v4M8 12h.01M16 12h.01M9 16h6"/>',
    connections: '<path d="m10 13 4-4m-6 6-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 3 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"/>',
  };
  const PALETTE = [['#6b46ff', '#c04dff'], ['#3fe0ff', '#3f6bff'], ['#ff5ccf', '#5c3bff'], ['#4ff0b0', '#2f8cff'], ['#ffbe55', '#ff6b86'], ['#ff8a5c', '#ff5ccf']];
  const hue = id => { let h = 0; for (const c of String(id)) h = (h * 31 + c.codePointAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; };
  const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';

  const S = { apps: [], installed: new Map(), busy: new Set(), stack: [], q: '', loaded: false, error: '' };
  if (/\.staging\.wizard001\.com$/.test(location.hostname)) $('preview').hidden = false;
  try { const skin = parent.document.documentElement.dataset.skin; if (skin) document.documentElement.dataset.skin = skin; } catch (_) {}

  /* ---------------- data ---------------- */
  // Every listing is rebuilt from typed, bounded fields: the public index is untrusted input.
  const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
  const txt = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  const ids = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && ID.test(x)).slice(0, 24) : []);
  const words = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.length <= 40).slice(0, 24) : []);
  function clean(a) {
    if (!a || typeof a !== 'object' || !ID.test(a.id || '')) return null;
    return { id: a.id, name: txt(a.name, 60) || a.id, summary: txt(a.summary, 280), publisher: txt(a.publisher, 60), version: txt(a.version, 40),
      type: ['view', 'service', 'agent', 'external'].includes(a.type) ? a.type : 'service', category: txt(a.category, 24), logo: typeof a.logo === 'string' && /^https:\/\//.test(a.logo),
      url: txt(a.url, 200), private: a.private === true, tags: words(a.tags), provides: words(a.provides), uses: ids(a.uses), architectures: words(a.architectures),
      installs: Number.isSafeInteger(a.installs) && a.installs > 0 ? a.installs : 0, checked_at: Number.isFinite(a.checked_at) ? a.checked_at : 0 };
  }
  const get = p => fetch(DATA + p, { credentials: 'same-origin', cache: 'no-store' }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
  async function load() {
    const [idx, inst] = await Promise.allSettled([get('wizard/v1/index/search?limit=100'), get('api/apps/installed')]);
    if (idx.status !== 'fulfilled') { S.error = 'The App Index isn’t reachable right now.'; S.loaded = true; return paint(); }
    S.apps = (Array.isArray(idx.value.apps) ? idx.value.apps : []).map(clean).filter(Boolean).filter(a => a.id !== 'wizard-shell');
    if (inst.status === 'fulfilled') for (const x of inst.value.installed || []) {
      const id = x?.info?.id; if (!id) continue; const prev = S.installed.get(id);
      if (!prev || x.app?.status === 'running') S.installed.set(id, { status: x.app?.status || 'unknown' });
    }
    S.loaded = true; paint();
    const requested = new URLSearchParams(location.search).get('app');
    if (requested && S.apps.some(a => a.id === requested)) openApp(requested);
  }
  const isInstalled = a => S.installed.has(a.id);
  // The shell knows which apps have a view it can open; only those get "Open".
  const canOpen = a => { try { return framed && typeof parent.WizCanOpen === 'function' && parent.WizCanOpen(a.id); } catch (_) { return false; } };

  /* ---------------- pieces ---------------- */
  function icon(a, size = 'm') {
    const [c1, c2] = hue(a.id);
    const letter = esc((a.name || a.id).trim().charAt(0).toUpperCase());
    const img = a.logo ? `<img src="${DATA}logo/${esc(a.id)}" alt="" loading="lazy" decoding="async">` : '';
    return `<span class="ic ic-${size}" style="--c1:${c1};--c2:${c2}"><b>${letter}</b>${img}</span>`;
  }
  function action(a, cls = '') {
    if (isInstalled(a) && canOpen(a)) return `<button class="get open ${cls}" data-open="${esc(a.id)}">Open</button>`;
    if (isInstalled(a)) return `<span class="get have ${cls}" aria-label="Installed">✓ Installed</span>`;
    if (S.busy.has(a.id)) return `<span class="get have ${cls}" aria-live="polite">Installing…</span>`;
    return `<button class="get ${cls}" data-get="${esc(a.id)}">Get</button>`;
  }
  const row = a => `<div class="row" data-app="${esc(a.id)}" role="button" tabindex="0">${icon(a)}<span class="tx"><b>${esc(a.name)}</b><small>${esc(kindOf(a).one)} · ${esc(a.summary)}</small></span>${action(a)}</div>`;

  /* ---------------- screens ---------------- */
  function paint() {
    $('kinds').innerHTML = KINDS.map(k => `<button type="button" class="kind" data-kind="${k.id}"${!S.loaded || S.error ? ' disabled' : ''}>
      <svg class="kind-icon" viewBox="0 0 24 24" aria-hidden="true">${KIND_ICONS[k.id]}</svg>
      <span class="kind-copy"><b>${esc(k.many)}</b><small>${esc(k.blurb)}</small></span>
      <span class="kind-go" aria-hidden="true">›</span></button>`).join('');
    $('browse-status').hidden = S.loaded && !S.error;
    $('browse-status').textContent = S.error || 'Loading the App Index…';
  }

  function showList(title, list, sub = '') {
    $('results').innerHTML = `<div class="list-head"><button class="back" data-back aria-label="Back">‹</button><div><h2>${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}</div></div>
      ${list.length ? `<div class="rows">${list.map(row).join('')}</div>` : `<p class="empty">Nothing matches “${esc(S.q)}”. Try another word.</p>`}`;
  }
  function search(q) {
    S.q = q.trim(); const n = S.q.toLowerCase();
    if (!n) { if (top() === 'search') pop(); return; }
    const hits = S.apps.map(a => {
      const hay = [a.name, a.summary, a.publisher, ...(a.tags || []), ...(a.provides || []), kindOf(a).one].join(' ').toLowerCase();
      const s = a.name.toLowerCase().startsWith(n) ? 3 : a.name.toLowerCase().includes(n) ? 2 : hay.includes(n) ? 1 : 0;
      return [s, a];
    }).filter(([s]) => s).sort((x, y) => y[0] - x[0]).map(([, a]) => a);
    if (top() !== 'search') push('search');
    showList('Results', hits, `${hits.length} for “${S.q}”`);
  }

  function showDetail(id) {
    const a = S.apps.find(x => x.id === id); if (!a) return;
    const k = kindOf(a), [c1, c2] = hue(a.id);
    const uses = (a.uses || []).map(u => S.apps.find(x => x.id === u) || { id: u, name: cap(u.replace(/-/g, ' ')) });
    const needs = uses.length ? `<section class="d-sec"><h3>Works with</h3><p class="d-note">${esc(a.name)} uses these. Wizard installs anything missing first.</p><div class="dep">${uses.map(u =>
      `<div class="dep-i" ${S.apps.includes(u) ? `data-app="${esc(u.id)}" role="button" tabindex="0"` : ''}>${icon(u, 's')}<b>${esc(u.name)}</b><small>${isInstalled(u) ? '✓ Installed' : 'Will be added'}</small></div>`).join('')}</div></section>` : '';
    const usedBy = S.apps.filter(x => (x.uses || []).includes(a.id));
    const powers = usedBy.length ? `<section class="d-sec"><h3>Powers</h3><div class="dep">${usedBy.map(u => `<div class="dep-i" data-app="${esc(u.id)}" role="button" tabindex="0">${icon(u, 's')}<b>${esc(u.name)}</b><small>${esc(kindOf(u).one)}</small></div>`).join('')}</div></section>` : '';
    const gives = (a.provides || []).length ? `<section class="d-sec"><h3>Gives your agent</h3><div class="chips">${a.provides.map(p => `<span>${esc(p.replace(/-/g, ' '))}</span>`).join('')}</div></section>` : '';
    const how = { view: 'Opens in its own Wizard window.', service: 'Runs in the background. Ask your agent to use it — no screen needed.', agent: 'An agent that lives on your Wizard.', external: 'Connect an account once; every agent can use it.' }[a.type] || '';
    const info = [['Kind', k.one], ['Publisher', a.publisher], ['Version', a.version], ['Runs on', (a.architectures || []).join(' · ')], ['Installs', a.installs > 0 ? String(a.installs) : 'New']]
      .filter(([, v]) => v).map(([l, v]) => `<div><dt>${esc(l)}</dt><dd>${esc(v)}</dd></div>`).join('');
    $('detail').innerHTML = `<div class="d-hero" style="--c1:${c1};--c2:${c2}"><button class="back" data-back aria-label="Back">‹</button>
        ${icon(a, 'l')}<div class="d-id"><h2>${esc(a.name)}</h2><p>${esc(k.one)}${a.publisher ? ` · ${esc(a.publisher)}` : ''}</p>${action(a, 'big')}</div></div>
      <div class="d-stats"><div><b>${esc(k.one)}</b><small>Kind</small></div><div><b>${a.installs > 0 ? a.installs : 'New'}</b><small>Installs</small></div><div><b>${esc((a.version || '—').split(/[-+]/)[0])}</b><small>Version</small></div><div><b>${(a.tags || [])[0] ? esc(cap(a.tags[0])) : '—'}</b><small>Topic</small></div></div>
      <section class="d-sec d-lead"><p class="d-sum">${esc(a.summary)}</p><p class="d-how">${esc(how)}</p></section>
      ${needs}${powers}${gives}
      ${a.private ? `<section class="d-sec"><h3>Private test installation</h3><p>Get installs it from the pinned private test catalog (this Wizard needs access to the release). Source and architecture-matching image archives are authenticated and checksum verified; no public registry permission is needed. Your agent can also run <code>wam install ${esc(a.id)}</code>.</p></section>` : ''}
      <section class="d-sec"><h3>Information</h3><dl class="info">${info}</dl>${a.url && /^https:\/\/github\.com\//.test(a.url) ? `<a class="src" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">View source on GitHub ↗</a>` : ''}</section>`;
    window.scrollTo(0, 0);
  }

  /* ---------------- navigation stack: discover → list/search → detail ---------------- */
  const scrolls = [];
  const top = () => S.stack[S.stack.length - 1]?.t;
  function render() {
    const t = top();
    $('discover').hidden = !!t; $('results').hidden = !(t === 'list' || t === 'search'); $('detail').hidden = t !== 'detail';
  }
  function push(t, arg) { scrolls.push(window.scrollY); S.stack.push({ t, arg }); render(); }
  function pop() {
    if (!S.stack.length) return false;
    const was = S.stack.pop(); render();
    if (was.t === 'search') { $('q').value = ''; S.q = ''; }
    const under = S.stack[S.stack.length - 1];
    if (under?.t === 'detail') showDetail(under.arg); else if (under?.t === 'list') openKind(under.arg, true);
    const y = scrolls.pop() || 0; requestAnimationFrame(() => window.scrollTo(0, y));
    return true;
  }
  function openKind(id, keep) {
    const tag = id.startsWith('tag:') ? id.slice(4) : null; const k = KINDS.find(x => x.id === id);
    const list = tag ? S.apps.filter(a => (a.tags || []).includes(tag)) : S.apps.filter(a => kindOf(a) === k);
    if (!keep) push('list', id);
    showList(tag ? cap(tag) : k.many, list, tag ? `${list.length} app${list.length === 1 ? '' : 's'}` : k.blurb);
    if (!keep) window.scrollTo(0, 0);
  }
  function openApp(id) { push('detail', id); showDetail(id); }
  // Repaint whatever screen is showing (buttons change while an install runs) without touching history or scroll.
  function refresh() {
    const t = S.stack[S.stack.length - 1], y = window.scrollY;
    paint();
    if (t?.t === 'detail') showDetail(t.arg); else if (t?.t === 'list') openKind(t.arg, true); else if (t?.t === 'search') search(S.q);
    requestAnimationFrame(() => window.scrollTo(0, y));
  }

  let toastT = 0;
  function toast(html) { const t = $('toast'); t.innerHTML = html; t.hidden = false; requestAnimationFrame(() => t.classList.add('on')); clearTimeout(toastT); toastT = setTimeout(() => { t.classList.remove('on'); setTimeout(() => { t.hidden = true; }, 250); }, 3600); }

  // Get: the App Manager installs it (owner only, on this Wizard's private address). The browser sends only the id.
  const INSTALL = DATA.replace(/store-data\/$/, 'store-install/');
  async function install(a) {
    if (!a || S.busy.has(a.id) || isInstalled(a)) return;
    S.busy.add(a.id); refresh();
    const say = (m, ok) => toast(`<b>${esc(a.name)}${ok ? ' is ready' : ' wasn’t installed'}</b><span>${esc(m)}</span>`);
    try {
      const r = await fetch(INSTALL + encodeURIComponent(a.id), { method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'X-Wizard-Store': '1' }, body: '{}' });
      let j = await r.json().catch(() => ({}));
      if (r.status === 403 || r.status === 404) throw new Error(r.status === 404 && !j.error ? 'Installing from the Store isn’t set up on this Wizard yet. Ask your agent to install it.' : (j.error || 'Not allowed.'));
      if (!r.ok && r.status !== 202) throw new Error(j.error || `Install failed (${r.status}).`);
      for (let i = 0; j.state === 'installing' && i < 360; i++) {
        await new Promise(res => setTimeout(res, 2500));
        const s = await fetch(INSTALL + encodeURIComponent(a.id), { credentials: 'same-origin', cache: 'no-store' });
        j = await s.json().catch(() => ({ state: 'installing' }));
      }
      if (j.state !== 'installed') throw new Error(j.error || 'It didn’t finish. Ask your agent to check the App Manager.');
      S.installed.set(a.id, { status: j.status || 'running' });
      say('Find it in your apps.', true);
      try { if (framed) parent.postMessage({ type: 'wizard:apps-changed', id: a.id }, location.origin); } catch (_) {}
    } catch (err) { say(err.message || 'Install failed.'); }
    finally { S.busy.delete(a.id); refresh(); }
  }

  document.addEventListener('click', e => {
    if (e.target.closest('[data-back]')) { pop(); return; }
    const g = e.target.closest('[data-get]');
    if (g) { e.stopPropagation(); install(S.apps.find(x => x.id === g.dataset.get)); return; }
    const o = e.target.closest('[data-open]');
    if (o) { e.stopPropagation(); if (framed) parent.postMessage({ type: 'wizard:open-app', id: o.dataset.open }, location.origin); else toast('<b>Open it from your apps.</b>'); return; }
    const k = e.target.closest('[data-kind]'); if (k) return openKind(k.dataset.kind);
    const t = e.target.closest('[data-tag]'); if (t) return openKind('tag:' + t.dataset.tag);
    const a = e.target.closest('[data-app]'); if (a) return openApp(a.dataset.app);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches?.('[role="button"]')) { e.target.click(); return; }
    if (e.key === 'Escape' && pop()) { e.preventDefault(); e.stopPropagation(); }
  });
  $('q').addEventListener('input', () => search($('q').value));
  $('q').addEventListener('keydown', e => { if (e.key === 'Enter') $('q').blur(); });

  // Canonical hosted-app Back hook: the shell owns history and calls this; true = handled one layer.
  window.__wizardCloseOverlay = pop;
  if (!framed) {
    if (history.state?.store !== 'guard') { history.replaceState({ store: 'root' }, ''); history.pushState({ store: 'guard' }, ''); }
    addEventListener('popstate', () => { pop(); history.pushState({ store: 'guard' }, ''); });
  }
  // Broken or missing logos fall back to the gradient letter (inline onerror is blocked by CSP).
  document.addEventListener('error', e => { if (e.target.tagName === 'IMG') e.target.remove(); }, true);
  window.__store = { state: () => ({ layers: S.stack.map(x => x.t), apps: S.apps.length, installed: [...S.installed.keys()], q: S.q }) };
  paint(); load();
})();
