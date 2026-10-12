/* System: one view of what a Wizard runs on — agents, agent apps and tools, connections, routines — and how they link.
 * Read-only overview from ../store-data/system/v1/overview. The map follows Miguel's layered graph idea (lines only
 * run between layers; tap a node to light its lineage). Back: a focused node → map; the shell owns the rest. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const framed = window.top !== window;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  try { const skin = parent.document.documentElement.dataset.skin; if (skin) document.documentElement.dataset.skin = skin; } catch (_) {}
  const LAYERS = [
    { id: 'views', title: 'You use', color: '#b99bff' },
    { id: 'agents', title: 'Agents', color: '#ff5ccf' },
    { id: 'apps', title: 'Agent apps & tools', color: '#3fe0ff' },
    { id: 'conns', title: 'Connections', color: '#4ff0b0' },
  ];
  const MAX = { views: 6, agents: 5, apps: 12, conns: 9 };
  let D = null, sel = null;
  const nodes = new Map(); // id -> { id, layer, name, sub, status }
  const links = new Map(); // id -> Set(id)
  const link = (a, b) => { if (!nodes.has(a) || !nodes.has(b)) return; (links.get(a) || links.set(a, new Set()).get(a)).add(b); (links.get(b) || links.set(b, new Set()).get(b)).add(a); };
  const ago = iso => { const t = Date.parse(iso); if (!Number.isFinite(t)) return ''; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };

  async function load() {
    try {
      const r = await fetch('../store-data/system/v1/overview', { credentials: 'same-origin', cache: 'no-store' });
      if (!r.ok) throw new Error(r.status); D = await r.json();
    } catch (_) { $('sections').innerHTML = '<p class="empty">Your system overview isn’t reachable right now.</p>'; return; }
    build(); paint();
  }

  function build() {
    nodes.clear(); links.clear();
    const main = D.agents.find(a => a.main) || D.agents[0];
    const add = (id, layer, name, sub, status, extra = {}) => nodes.set(id, { id, layer, name, sub, status, ...extra });
    D.views.slice(0, MAX.views).forEach(v => add('v:' + v.id, 'views', v.name, 'App', 'ok'));
    if (D.views.length > MAX.views) add('v:+', 'views', `+${D.views.length - MAX.views}`, 'more apps', 'more');
    D.agents.slice(0, MAX.agents).forEach(a => add('a:' + a.id, 'agents', a.name, a.model, a.status === 'running' ? 'ok' : 'idle', { main: a.main }));
    if (D.agents.length > MAX.agents) add('a:+', 'agents', `+${D.agents.length - MAX.agents}`, 'more agents', 'more');
    D.apps.slice(0, MAX.apps).forEach(a => add('p:' + a.id, 'apps', a.name, a.kind, a.status === 'running' || a.status === 'connected' ? 'ok' : a.status === 'stopped' ? 'off' : 'warn'));
    const conns = [...D.connections].sort((x, y) => (y.ai ? 1 : 0) - (x.ai ? 1 : 0) || (D.apps.some(a => a.uses.includes('conn:' + y.id)) ? 1 : 0) - (D.apps.some(a => a.uses.includes('conn:' + x.id)) ? 1 : 0));
    conns.slice(0, MAX.conns).forEach(c => add('c:' + c.id, 'conns', c.name, c.group, c.status === 'connected' ? 'ok' : 'warn'));
    if (conns.length > MAX.conns) add('c:+', 'conns', `+${conns.length - MAX.conns}`, 'more connections', 'more');
    const M = 'a:' + main.id;
    for (const id of nodes.keys()) if (id.startsWith('v:')) link(id, M);
    for (const a of D.apps) { link(M, 'p:' + a.id); for (const u of a.uses) if (u.startsWith('conn:')) link('p:' + a.id, 'c:' + u.slice(5)); }
    for (const c of D.connections) if (c.ai) link(M, 'c:' + c.id);
  }

  function lineage(id) {
    const L = Object.fromEntries(LAYERS.map((l, i) => [l.id, i])), out = new Set([id]), edges = [];
    for (const dir of [-1, 1]) {
      const q = [id], seen = new Set(q);
      while (q.length) { const x = q.shift(); for (const y of links.get(x) || []) { if (Math.sign(L[nodes.get(y).layer] - L[nodes.get(x).layer]) !== dir) continue; edges.push(dir < 0 ? [y, x] : [x, y]); out.add(y); if (!seen.has(y)) { seen.add(y); q.push(y); } } }
    }
    return { out, edges };
  }

  function paint() {
    const n = { agents: D.agents.length, apps: D.apps.length, conns: D.connections.length, routines: D.routines.length };
    const bad = D.routines.filter(r => r.status === 'error').length;
    $('sub').textContent = bad ? `${bad} routine${bad === 1 ? '' : 's'} need${bad === 1 ? 's' : ''} attention` : 'Everything your Wizard runs on';
    $('sub').classList.toggle('warn', !!bad);
    $('stats').innerHTML = [['agents', 'Agents', n.agents, '#ff5ccf'], ['apps', 'Agent apps', n.apps, '#3fe0ff'], ['conns', 'Connections', n.conns, '#4ff0b0'], ['routines', 'Routines', n.routines, bad ? '#ff6b86' : '#ffbe55']]
      .map(([id, l, v, c]) => `<button class="stat" data-jump="${id}" style="--c:${c}"><b>${v}</b><span>${l}</span></button>`).join('');
    const map = $('map');
    map.querySelectorAll('.layer').forEach(e => e.remove());
    for (const L of LAYERS) {
      const list = [...nodes.values()].filter(x => x.layer === L.id); if (!list.length) continue;
      const row = document.createElement('div'); row.className = 'layer'; row.style.setProperty('--lc', L.color);
      row.innerHTML = `<h3>${esc(L.title)}</h3><div class="nodes">${list.map(x => `<button class="node ${x.main ? 'main' : ''} st-${x.status}" data-node="${esc(x.id)}"><i></i><b>${esc(x.name)}</b>${x.main ? `<small>${esc(x.sub)}</small>` : ''}</button>`).join('')}</div>`;
      map.appendChild(row);
    }
    sections(); requestAnimationFrame(wires);
  }

  function wires() {
    const map = $('map'), svg = $('wires'), box = map.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`); svg.style.height = box.height + 'px';
    const pos = id => { const e = map.querySelector(`[data-node="${CSS.escape(id)}"]`); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left - box.left + r.width / 2, top: r.top - box.top, bot: r.bottom - box.top }; };
    const lit = sel ? lineage(sel) : null, done = new Set(), paths = [];
    for (const [a, set] of links) for (const b of set) {
      const k = [a, b].sort().join('|'); if (done.has(k)) continue; done.add(k);
      const ia = LAYERS.findIndex(l => l.id === nodes.get(a).layer), ib = LAYERS.findIndex(l => l.id === nodes.get(b).layer);
      const [u, d] = ia < ib ? [a, b] : [b, a]; const p = pos(u), q = pos(d); if (!p || !q) continue;
      const on = lit && lit.edges.some(([x, y]) => x === u && y === d);
      const my = (p.bot + q.top) / 2;
      paths.push(`<path class="${on ? 'on' : lit ? 'dim' : ''}" d="M${p.x},${p.bot} C${p.x},${my} ${q.x},${my} ${q.x},${q.top}"/>`);
    }
    svg.innerHTML = paths.sort((x, y) => (x.includes('"on"') ? 1 : 0) - (y.includes('"on"') ? 1 : 0)).join('');
    map.querySelectorAll('.node').forEach(e => { e.classList.toggle('lit', !!lit && lit.out.has(e.dataset.node)); e.classList.toggle('dim', !!lit && !lit.out.has(e.dataset.node)); e.classList.toggle('sel', e.dataset.node === sel); });
  }

  function focusNode(id) {
    sel = id; wires(); const x = nodes.get(id), f = $('focus');
    if (!x) { f.hidden = true; $('mapHint').textContent = 'Tap anything to see what it’s connected to'; return; }
    const lit = lineage(id), up = [...lit.out].filter(o => o !== id).map(o => nodes.get(o)).filter(Boolean);
    const LT = Object.fromEntries(LAYERS.map(l => [l.id, l.title]));
    f.hidden = false; $('mapHint').textContent = 'Tap it again, or Back, to clear';
    f.innerHTML = `<b>${esc(x.name)}</b><span>${esc(x.sub || LT[x.layer])}</span>${up.length ? `<p>Connected to ${up.slice(0, 8).map(o => esc(o.name)).join(', ')}${up.length > 8 ? ` and ${up.length - 8} more` : ''}.</p>` : '<p>Not linked to anything else yet.</p>'}`;
  }

  function sections() {
    const dot = s => `<i class="dot d-${s}"></i>`;
    const agents = D.agents.map(a => `<div class="item ${a.main ? 'hero' : ''}"><span class="av" style="--c:${a.main ? '#ff5ccf' : '#7d74a3'}">${esc(a.name.charAt(0).toUpperCase())}</span><span class="tx"><b>${esc(a.name)}</b><small>${esc(a.main ? 'Your main agent' : a.kind)} · ${esc(a.model || '—')}</small></span>${dot(a.status === 'running' ? 'ok' : 'idle')}</div>`).join('');
    const apps = D.apps.map(a => `<div class="item"><span class="av" style="--c:${a.kind === 'Agent tool' ? '#3fe0ff' : '#8f63ff'}">${esc(a.name.charAt(0))}</span><span class="tx"><b>${esc(a.name)}</b><small>${esc(a.kind)}${a.summary ? ` · ${esc(a.summary)}` : ''}</small></span><span class="st">${dot(a.status === 'running' || a.status === 'connected' ? 'ok' : a.status === 'stopped' ? 'off' : 'warn')}${esc(a.status === 'connected' ? 'On' : a.status.charAt(0).toUpperCase() + a.status.slice(1))}</span></div>`).join('');
    const groups = {}; for (const c of D.connections) (groups[c.group] = groups[c.group] || []).push(c);
    const conns = Object.entries(groups).sort((x, y) => (y[0] === 'AI account') - (x[0] === 'AI account')).map(([g, list]) => `<h4>${esc(g)}</h4><div class="chips">${list.map(c => `<span class="chip">${dot(c.status === 'connected' ? 'ok' : 'warn')}${esc(c.name)}${c.detail ? `<small>${esc(c.detail)}</small>` : ''}</span>`).join('')}</div>`).join('');
    const rs = [...D.routines].sort((a, b) => (b.status === 'error') - (a.status === 'error'));
    const routines = rs.map(r => `<div class="item r ${r.status === 'error' ? 'bad' : ''}"><span class="tx"><b>${esc(r.name)}</b><small>${esc(r.when)}${r.lastRun ? ` · ran ${esc(ago(r.lastRun))}` : ''}</small></span><span class="st">${dot(r.status === 'error' ? 'bad' : r.status === 'ok' ? 'ok' : 'idle')}${r.status === 'error' ? 'Failed' : r.status === 'ok' ? 'OK' : 'New'}</span></div>`).join('');
    $('sections').innerHTML = `
      <section class="sec" id="s-agents"><h2>Agents</h2><div class="list">${agents}</div></section>
      <section class="sec" id="s-apps"><h2>Agent apps &amp; tools</h2><p class="hint">Installed apps and tools your agents can use. They have no screen of their own.</p><div class="list">${apps}</div></section>
      <section class="sec" id="s-conns"><h2>Connections</h2><p class="hint">Accounts and keys your agents use. Keys never leave your Wizard.</p>${conns}</section>
      <section class="sec" id="s-routines"><h2>Routines</h2><p class="hint">What your agents do on their own, on a schedule.</p><div class="list">${routines}</div></section>`;
  }

  document.addEventListener('click', e => {
    const n = e.target.closest('[data-node]'); if (n) { focusNode(sel === n.dataset.node ? null : n.dataset.node); return; }
    const j = e.target.closest('[data-jump]'); if (j) { $('s-' + j.dataset.jump)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (e.target.closest('#more')) { if (framed) parent.postMessage({ type: 'wizard:open-app', id: 'app-store' }, location.origin); else location.href = '../store/index.html'; }
  });
  addEventListener('resize', () => D && requestAnimationFrame(wires));
  // Canonical hosted-app Back hook: clears a focused node; otherwise the shell takes the step.
  const back = () => { if (sel) { focusNode(null); return true; } return false; };
  window.__wizardCloseOverlay = back;
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && back()) { e.preventDefault(); e.stopPropagation(); } });
  if (!framed) {
    if (history.state?.sys !== 'guard') { history.replaceState({ sys: 'root' }, ''); history.pushState({ sys: 'guard' }, ''); }
    addEventListener('popstate', () => { back(); history.pushState({ sys: 'guard' }, ''); });
  }
  window.__system = { state: () => ({ loaded: !!D, nodes: nodes.size, selected: sel, counts: D && { agents: D.agents.length, apps: D.apps.length, conns: D.connections.length, routines: D.routines.length } }) };
  load();
})();
