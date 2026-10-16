/* Wizard App Store: an app-discovery app that runs in its own Wizard window (or on its own).
 * Listings merge configured catalogs; installation identity joins WAM, canonical shell and Runtipi reads.
 * Browse-only until App installation lands: Get explains instead of installing. Back: detail → list → Store root,
 * through the shell's canonical hook (window.__wizardCloseOverlay); standalone it guards its own history. */
import {resolveInstalled, releaseState, preferredRelease, compareApps, isUserApp} from './store-status.js';
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

  const S = { apps: [], installed: new Map(), complete:false, stack: [], q: '', loaded: false, error: '', sources: [], selections: new Map() };
  const key = a => `${a.id}|${a.repo || ''}`;
  const find = id => S.apps.find(a => key(a) === id) || S.apps.find(a => a.id === id);
  const selected = a => ({...a, ...preferredRelease(a,S.installed.get(key(a))), ...(a.releases || []).find(r => `${r.source}:${r.commit}` === S.selections.get(key(a))), releases:a.releases, conflict:a.conflict, alpha_badge:a.alpha_badge});
  const badge = a => (a.alpha_badge ? '<span class="alpha-badge">Alpha</span>' : '') + (a.conflict ? '<span class="conflict-badge">Source conflict</span>' : '');
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
      url: txt(a.url, 250), repo: txt(a.repo, 201), source: ID.test(a.source || '') ? a.source : 'standard', source_name: txt(a.source_name,60), channel: a.channel === 'alpha' ? 'alpha' : 'standard', commit: /^[a-f0-9]{40}$/.test(a.commit || '') ? a.commit : '', release_notes: txt(a.release_notes,2000),
      releases: Array.isArray(a.releases) ? a.releases.slice(0,16).map(r => clean({...r,releases:null})).filter(Boolean) : [],
      alpha_badge: ['Alpha','Alpha available'].includes(a.alpha_badge) ? a.alpha_badge : '', conflict: a.conflict === true, installed_source: txt(a.installed_source,64), installed_commit: txt(a.installed_commit,40), installed_app_id: txt(a.installed_app_id,64), update_available: a.update_available === true,
      private: a.private === true, tags: words(a.tags), provides: words(a.provides), uses: ids(a.uses), architectures: words(a.architectures),
      installs: Number.isSafeInteger(a.installs) && a.installs > 0 ? a.installs : 0, checked_at: Number.isFinite(a.checked_at) ? a.checked_at : 0 };
  }
  const get = p => fetch(DATA + p, { credentials: 'same-origin', cache: 'no-store' }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
  async function allApps(force) {
    const apps=[], seen=new Set(); let offset=0, sources=[];
    for (let page=0;page<100;page++) {
      const d=await get(`wizard/v1/index/search?limit=100&offset=${offset}${force && page===0 ? '&refresh=1' : ''}`);
      apps.push(...(d.apps || [])); sources=d.sources || [];
      if(d.next_offset == null) return {apps,sources};
      if(!Number.isSafeInteger(d.next_offset) || d.next_offset<=offset || seen.has(d.next_offset)) throw Error('pagination');
      seen.add(d.next_offset); offset=d.next_offset;
    }
    throw Error('catalog_limit');
  }
  async function load(force=false) {
    $('refresh').disabled=true;
    const [idx, inst, registry] = await Promise.allSettled([allApps(force), get('api/apps/installed'), get('wizard/v1/installed-apps')]);
    $('refresh').disabled=false;
    if (idx.status !== 'fulfilled') {
      S.error = 'The App Index isn’t reachable right now.'; S.loaded = true; S.complete=false; paint();
      if(top()==='detail') showDetail(S.stack.at(-1).arg);
      else if(top()==='list') openKind(S.stack.at(-1).arg,true);
      else if(top()==='search') search(S.q);
      return;
    }
    S.error=''; S.sources=idx.value.sources;
    S.apps = (Array.isArray(idx.value.apps) ? idx.value.apps : []).map(clean).filter(Boolean).filter(isUserApp).sort(compareApps);
    S.installed.clear();
    const snapshot=registry.status==='fulfilled' ? registry.value : {wam:[],shell:[],complete:false};
    const runtipi=inst.status==='fulfilled' && Array.isArray(inst.value.installed) ? inst.value.installed : [];
    S.complete=snapshot.complete===true && Array.isArray(snapshot.wam) && Array.isArray(snapshot.shell) && inst.status==='fulfilled' && Array.isArray(inst.value.installed);
    for (const a of S.apps) {
      const i=resolveInstalled(a,snapshot,runtipi); if(i) S.installed.set(key(a),i);
      // Never silently substitute a removed explicit release after Refresh.
      if(S.selections.has(key(a)) && !a.releases.some(r=>`${r.source}:${r.commit}`===S.selections.get(key(a)))) S.selections.set(key(a),'unavailable');
    }
    // First-run shell discovery can finish after the Store's own reads.
    try { if(framed) await parent.WizCore?.appsLoaded?.(); } catch (_) {}
    S.loaded = true; paint();
    if(top()==='detail') showDetail(S.stack.at(-1).arg);
    else if(top()==='list') openKind(S.stack.at(-1).arg,true);
    else if(top()==='search') search(S.q);
    const requested = new URLSearchParams(location.search).get('app');
    if (requested && !S.stack.length && S.apps.some(a => a.id === requested)) {
      const a=find(requested), source=new URLSearchParams(location.search).get('source'), r=a.releases.find(r=>r.source===source);
      if(r) S.selections.set(key(a),`${r.source}:${r.commit}`);
      openApp(key(a));
    }
  }
  const isInstalled = a => !!S.installed.get(key(a)) && !S.installed.get(key(a)).conflict;
  const status = a => S.selections.get(key(a))==='unavailable' ? 'unknown' : releaseState(a,S.installed.get(key(a)),S.selections.has(key(a)),S.complete);
  // The shell knows which apps have a view it can open; only those get "Open".
  const openId = a => S.installed.get(key(a))?.id || '';
  const canOpen = a => { try { return framed && typeof parent.WizCanOpen === 'function' && parent.WizCanOpen(openId(a)); } catch (_) { return false; } };

  /* ---------------- pieces ---------------- */
  function icon(a, size = 'm') {
    const [c1, c2] = hue(a.id);
    const letter = esc((a.name || a.id).trim().charAt(0).toUpperCase());
    const img = a.logo ? `<img src="${DATA}logo/${esc(a.id)}" alt="" loading="lazy" decoding="async">` : '';
    return `<span class="ic ic-${size}" style="--c1:${c1};--c2:${c2}"><b>${letter}</b>${img}</span>`;
  }
  function action(a, cls = '') {
    const state=status(a);
    if(state==='conflict') return '<span class="get have">Resolve conflict</span>';
    if(state==='unknown') return '<span class="get have" aria-label="Status unavailable">Status unavailable</span>';
    if(state==='switch' || state==='update') return `<button class="get ${cls}" data-get="${esc(key(a))}">${state==='update'?'Update':'Switch release'}</button>`;
    if (isInstalled(a) && canOpen(a)) return `<button class="get open ${cls}" data-open="${esc(openId(a))}">Open</button>`;
    if (isInstalled(a)) return `<span class="get have ${cls}" aria-label="Installed">✓ Installed</span>`;
    return `<button class="get ${cls}" data-get="${esc(key(a))}">Get</button>`;
  }
  const row = base => {const a=selected(base); return `<div class="row" data-app="${esc(key(a))}" role="button" tabindex="0">${icon(a)}<span class="tx"><b>${esc(a.name)}</b>${badge(base)}<small>${esc(kindOf(a).one)} · ${esc(a.summary)}</small></span>${action(a)}</div>`;};

  /* ---------------- screens ---------------- */
  function paint() {
    $('kinds').innerHTML = KINDS.map(k => `<button type="button" class="kind" data-kind="${k.id}"${!S.loaded || S.error ? ' disabled' : ''}>
      <svg class="kind-icon" viewBox="0 0 24 24" aria-hidden="true">${KIND_ICONS[k.id]}</svg>
      <span class="kind-copy"><b>${esc(k.many)}</b><small>${esc(k.blurb)}</small></span>
      <span class="kind-go" aria-hidden="true">›</span></button>`).join('');
    $('browse-status').hidden = S.loaded && !S.error;
    $('browse-status').textContent = S.error || 'Loading the App Index…';
    const stale=S.sources.filter(s=>s.stale);
    $('source-status').hidden=!stale.length && S.complete;
    $('source-status').textContent=[...stale.map(s=>`${txt(s.name,60)} unavailable — showing last valid data where available.`),...(!S.complete && S.loaded?['Installed status is incomplete. Refresh before requesting a release change.']:[])].join(' ');
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
    }).filter(([s]) => s).sort((x, y) => Number(!!y[1].alpha_badge)-Number(!!x[1].alpha_badge) || y[0]-x[0] || compareApps(x[1],y[1])).map(([, a]) => a);
    if (top() !== 'search') push('search');
    showList('Results', hits, `${hits.length} for “${S.q}”`);
  }

  function showDetail(id) {
    const base=find(id); if(!base) return; const a=selected(base);
    const k = kindOf(a), [c1, c2] = hue(a.id);
    const uses = (a.uses || []).map(u => S.apps.find(x => x.id === u) || { id: u, name: cap(u.replace(/-/g, ' ')) });
    const needs = uses.length ? `<section class="d-sec"><h3>Works with</h3><p class="d-note">${esc(a.name)} uses these. Wizard installs anything missing first.</p><div class="dep">${uses.map(u =>
      `<div class="dep-i" ${S.apps.includes(u) ? `data-app="${esc(u.id)}" role="button" tabindex="0"` : ''}>${icon(u, 's')}<b>${esc(u.name)}</b><small>${isInstalled(u) ? '✓ Installed' : 'Will be added'}</small></div>`).join('')}</div></section>` : '';
    const usedBy = S.apps.filter(x => (x.uses || []).includes(a.id));
    const powers = usedBy.length ? `<section class="d-sec"><h3>Powers</h3><div class="dep">${usedBy.map(u => `<div class="dep-i" data-app="${esc(u.id)}" role="button" tabindex="0">${icon(u, 's')}<b>${esc(u.name)}</b><small>${esc(kindOf(u).one)}</small></div>`).join('')}</div></section>` : '';
    const gives = (a.provides || []).length ? `<section class="d-sec"><h3>Gives your agent</h3><div class="chips">${a.provides.map(p => `<span>${esc(p.replace(/-/g, ' '))}</span>`).join('')}</div></section>` : '';
    const how = { view: 'Opens in its own Wizard window.', service: 'Runs in the background. Ask your agent to use it — no screen needed.', agent: 'An agent that lives on your Wizard.', external: 'Connect an account once; every agent can use it.' }[a.type] || '';
    const info = [['Kind', k.one], ['Source', a.source_name || 'Standard'], ['Publisher', a.publisher], ['Version', a.version], ['Commit', a.commit], ['Runs on', (a.architectures || []).join(' · ')], ['Installs', a.installs > 0 ? String(a.installs) : 'New']]
      .filter(([, v]) => v).map(([l, v]) => `<div><dt>${esc(l)}</dt><dd>${esc(v)}</dd></div>`).join('');
    $('detail').innerHTML = `<div class="d-hero" style="--c1:${c1};--c2:${c2}"><button class="back" data-back aria-label="Back">‹</button>
        ${icon(a, 'l')}<div class="d-id"><h2>${esc(a.name)}</h2>${badge(base)}<p>${esc(k.one)}${a.publisher ? ` · ${esc(a.publisher)}` : ''}</p>${action(a, 'big')}</div></div>
      ${base.releases.length ? `<section class="d-sec"><label class="release-label">Release <select id="release-choice" data-release="${esc(key(base))}">${S.selections.get(key(base))==='unavailable'?'<option selected disabled>Selected release no longer available</option>':''}${base.releases.map(r=>`<option value="${esc(`${r.source}:${r.commit}`)}" ${S.selections.get(key(base))!=='unavailable' && r.source===a.source && r.commit===a.commit?'selected':''}>${r.channel==='alpha'?'Alpha':'Standard'} · ${esc(r.version)} · ${esc(r.source_name)}</option>`).join('')}</select></label><p class="d-note">Alpha marks availability, not your installed channel. Open uses your existing app; choosing another release never installs it automatically.</p></section>` : ''}
      ${base.conflict?'<section class="d-sec"><p class="d-note">This app ID belongs to different repositories across sources. Installation is blocked here; ask your agent to resolve the source conflict without overwriting an installed app.</p></section>':''}
      <div class="d-stats"><div><b>${esc(k.one)}</b><small>Kind</small></div><div><b>${a.installs > 0 ? a.installs : 'New'}</b><small>Installs</small></div><div><b>${esc((a.version || '—').split(/[-+]/)[0])}</b><small>Version</small></div><div><b>${(a.tags || [])[0] ? esc(cap(a.tags[0])) : '—'}</b><small>Topic</small></div></div>
      <section class="d-sec d-lead"><p class="d-sum">${esc(a.summary)}</p><p class="d-how">${esc(how)}</p></section>
      ${needs}${powers}${gives}
      ${a.release_notes ? `<section class="d-sec"><h3>Release notes</h3><p>${esc(a.release_notes)}</p></section>` : ''}
      ${a.private ? `<section class="d-sec"><h3>Agent-mediated installation</h3><p>Requires your own repository and release access. ${esc(installRequest(a))}</p></section>` : ''}
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

  let toastT = 0, lastInstallRequest = '';
  function installRequest(a) {
    const verb=status(a)==='switch'?'Switch release for':status(a)==='update'?'Update':isInstalled(a)?'Selected release for':'Install';
    if(a.channel==='alpha') return `${verb} ${a.name} from ${a.source_name}: source ${a.source}, app ${a.id}, repository ${a.repo}, commit ${a.commit}, version ${a.version}. Use wizard-alpha install --source ${a.source} --app ${a.id} --commit ${a.commit}${isInstalled(a)?' --update':''}. Preserve existing data. Verify the authenticated view opens before reporting success.`;
    if(a.private) return `${verb} ${a.name} using owner-private source, repository ${a.repo}, exact commit ${a.commit}, version ${a.version}. Do not substitute the Alpha release.`;
    return `${verb} ${a.name} from Standard, repository ${a.repo}, version ${a.version}${a.commit?`, commit ${a.commit}`:''}. Do not substitute an Alpha release.`;
  }
  function toast(html, duration=3600) { const t = $('toast'); t.innerHTML = html; t.hidden = false; requestAnimationFrame(() => t.classList.add('on')); clearTimeout(toastT); toastT = setTimeout(() => { t.classList.remove('on'); setTimeout(() => { if(!t.classList.contains('on')) t.hidden = true; }, 250); }, duration); }

  document.addEventListener('click', e => {
    if (e.target.closest('[data-back]')) { pop(); return; }
    const g = e.target.closest('[data-get]');
    if (g) { e.stopPropagation(); const base=find(g.dataset.get); if(!base) return; const a=selected(base); if(!['get','switch','update'].includes(status(a))) return; lastInstallRequest=installRequest(a); toast(`<b>Ask your agent</b><span>${esc(lastInstallRequest)}</span><button class="get" data-copy-install>Copy request</button>`,15000); return; }
    if(e.target.closest('[data-copy-install]')) { if(!navigator.clipboard?.writeText) {toast('<b>Select the request in app details to copy it.</b>');return;} navigator.clipboard.writeText(lastInstallRequest).then(()=>toast('<b>Request copied</b>')).catch(()=>toast('<b>Select the request in app details to copy it.</b>')); return; }
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
  $('refresh').addEventListener('click',()=>load(true));
  const shellChanged=()=>{
    if(!S.loaded) return;
    if(top()==='detail') showDetail(S.stack.at(-1).arg);
    else if(top()==='list') openKind(S.stack.at(-1).arg,true);
    else if(top()==='search') search(S.q);
  };
  try { if(framed) {
    parent.addEventListener('wizard:apps',shellChanged);
    addEventListener('pagehide',()=>parent.removeEventListener('wizard:apps',shellChanged),{once:true});
  } } catch (_) {}
  document.addEventListener('change',e=>{if(e.target.matches('[data-release]')) {S.selections.set(e.target.dataset.release,e.target.value);showDetail(e.target.dataset.release);}});
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
