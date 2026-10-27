/* Miguel's Home = his Machines map (owner-approved Machines mockup v2, Backup app 0.5.4), read-only and on real data.
 * Rows by role: Storage on top, Main + Standby side by side, Helpers below. Node size follows the machine's
 * resources; Main is marked by its glow and label. Lines carry backup freshness. The workspace switcher lists his
 * network and the company Wizards he manages. People come first, left of Main: on his network his own devices,
 * on a Wizard he manages one node per person who uses it (registry `people`, or just `peopleCount`).
 * Data: the shell's Devices feed (api.data.read.resources) and the Backup app's read API (api.data.read.app).
 * Nothing here writes: every add / switch / restore says "Coming soon". */
// Nothing about the owner's network is written here: roles and managed Wizards come from his own devices registry
// (~/.wizard-os/devices.json: a device's `use` is standby or helper; `managed` lists the Wizards he looks after),
// served read-only by the shell's Devices feed. Main is always the box this Wizard runs on.
const SOON = 'Coming soon';
const ICONS = {
    mini: [["rect",{"x":"3","y":"7","width":"18","height":"10","rx":"2.5"}],["path",{"d":"M7 14h.01M10.5 14h6.5"}]],
    server: [["rect",{"x":"3.5","y":"4","width":"17","height":"7","rx":"2"}],["rect",{"x":"3.5","y":"13","width":"17","height":"7","rx":"2"}],["path",{"d":"M7.2 7.5h.01M7.2 16.5h.01M11 7.5h5.5M11 16.5h5.5"}]],
    cloud: [["path",{"d":"M7 18.5h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.6 9.1 4.75 4.75 0 0 0 7 18.5Z"}]],
    laptop: [["rect",{"x":"5","y":"5","width":"14","height":"10","rx":"1.6"}],["path",{"d":"M2.5 18.5h19"}]],
    phone: [["rect",{"x":"7","y":"2.5","width":"10","height":"19","rx":"2.5"}],["path",{"d":"M11 18.5h2"}]],
    desktop: [["rect",{"x":"3","y":"4","width":"18","height":"12","rx":"2"}],["path",{"d":"M8.5 20h7M12 16v4"}]],
    plus: [["path",{"d":"M12 6v12M6 12h12"}]],
    x: [["path",{"d":"M6.5 6.5l11 11M17.5 6.5l-11 11"}]],
    check: [["path",{"d":"M5.5 12.5l4 4 9-9"}]],
    lock: [["rect",{"x":"5","y":"10.5","width":"14","height":"9.5","rx":"2.2"}],["path",{"d":"M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"}]],
    cpu: [["rect",{"x":"6.5","y":"6.5","width":"11","height":"11","rx":"2"}],["path",{"d":"M10 3.5v3M14 3.5v3M10 17.5v3M14 17.5v3M3.5 10h3M3.5 14h3M17.5 10h3M17.5 14h3"}]],
    mem: [["rect",{"x":"3","y":"7","width":"18","height":"9","rx":"1.6"}],["path",{"d":"M7 16v3M11 16v3M15 16v3M7 10.5v2M11 10.5v2M15 10.5v2"}]],
    disk: [["ellipse",{"cx":"12","cy":"6.5","rx":"7.5","ry":"3"}],["path",{"d":"M4.5 6.5v11c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3v-11M4.5 12c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3"}]],
    os: [["circle",{"cx":"12","cy":"12","r":"8.5"}],["path",{"d":"M3.5 12h17M12 3.5c2.4 2.4 3.5 5.3 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.3-3.5-8.5S9.6 5.9 12 3.5Z"}]],
    swap: [["path",{"d":"M7 7h11l-3-3M17 17H6l3 3"}]],
    restore: [["path",{"d":"M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9"}],["path",{"d":"M4.5 4.5V9H9M12 8v4l2.5 2"}]],
    arrow: [["path",{"d":"M4 12h15M14 7l5 5-5 5"}]],
    net: [["circle",{"cx":"12","cy":"5.5","r":"2.2"}],["circle",{"cx":"5.5","cy":"18","r":"2.2"}],["circle",{"cx":"18.5","cy":"18","r":"2.2"}],["path",{"d":"M11 7.5 6.6 16M13 7.5l4.4 8.5M7.7 18h8.6"}]],
    person: [["circle",{"cx":"12","cy":"8","r":"3.6"}],["path",{"d":"M4.8 20a7.2 7.2 0 0 1 14.4 0"}]],
    bolt: [["path",{"d":"M13 3 5 13.5h6L10 21l8-10.5h-6L13 3Z"}]],
};
const SVG = 'http://www.w3.org/2000/svg';

export default function setup(api) {
  const S = { ws: api.storage.get('ws') || 'mine', sel: null, res: {}, backup: null, backupErr: false, backupTried: 0, sheet: null };
  let releaseBack = null;

  /* ---------- tiny DOM helpers (no markup strings) ---------- */
  const h = (tag, props = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'cls') el.className = v; else if (k === 'text') el.textContent = v;
      else if (k === 'data') Object.assign(el.dataset, v); else if (k === 'style') for (const [p, x] of Object.entries(v)) el.style?.setProperty?.(p, x);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    return el;
  };
  const sv = (tag, attrs = {}, parent) => { const e = document.createElementNS(SVG, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.append(e); return e; };
  const ico = (name, cls = '') => { const s = sv('svg', { class: ('mh-i ' + cls).trim(), viewBox: '0 0 24 24', 'aria-hidden': 'true' }); for (const [t, a] of ICONS[name] || ICONS.server) sv(t, a, s); return s; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const gbFmt = v => v == null ? '?' : v >= 1000 ? `${(v / 1000).toFixed(1).replace(/\.0$/, '')} TB` : `${Math.round(v)} GB`;
  const agoS = sec => sec < 3600 ? `${Math.max(1, Math.round(sec / 60))}m` : sec < 86400 ? `${Math.round(sec / 3600)}h` : `${Math.round(sec / 86400)}d`;
  const agoL = sec => sec < 3600 ? `${Math.max(1, Math.round(sec / 60))} min` : sec < 86400 ? `${Math.round(sec / 3600)} h` : `${Math.round(sec / 86400)} d`;
  const pretty = n => String(n || '').replace(/([a-z])([A-Z])/g, '$1 $2');  // MyServer → My Server
  const soon = what => api.toast(what ? `${what}: ${SOON.toLowerCase()}` : SOON);

  /* ---------- data → nodes ---------- */
  const devices = () => Array.isArray(S.res.devices?.devices) ? S.res.devices.devices : [];
  const peers = () => S.res.devices?.network?.available && Array.isArray(S.res.devices.network.peers) ? S.res.devices.network.peers : [];
  const devOf = id => devices().find(d => d.id === id) || null;
  const MAIN = 'this';
  const managedList = () => Array.isArray(S.res.devices?.managed) ? S.res.devices.managed : [];
  const managedOf = id => managedList().find(m => m.id === id) || null;
  const usedAs = use => devices().filter(d => d.use === use).map(d => d.id);
  const kindOf = d => d?.id === MAIN ? 'mini' : d?.platform === 'windows' ? 'laptop' : 'server';
  const diskGB = d => (d?.disks || []).reduce((n, x) => n + (+x.sizeGB || 0), 0) || null;
  const freeGB = d => (d?.disks || []).reduce((n, x) => n + (+x.freeGB || 0), 0) || null;
  function sizeOf(m, role) {
    if (role === 'storage') return m.cloud ? 78 : Math.round(clamp(54 + 46 * Math.log2((m.diskGB || 500) / 250 + 1) / Math.log2(65), 54, 100));
    if (!m.cores && !m.ramGB) return 58;
    const score = .45 * clamp((m.cores || 4) / 16, 0, 1.4) + .35 * clamp((m.ramGB || 4) / 64, 0, 1.4) + .2 * clamp((m.diskGB || 100) / 4000, 0, 1.4);
    return Math.round(clamp(52 + 52 * score, 52, 104));
  }
  function machine(id) {
    const d = devOf(id);
    if (!d) return { id, name: id === MAIN ? 'This Wizard' : id, kind: id === MAIN ? 'mini' : 'server', status: 'unknown' };
    return { id, name: pretty(d.name), label: d.role || '', kind: kindOf(d), status: d.status, os: d.platform,
      cores: d.cpus || null, ramGB: d.memoryTotalGB || null, ramUsedGB: d.memoryUsedGB, diskGB: diskGB(d), freeGB: freeGB(d), cpu: d.cpu, mem: d.memory,
      disk: d.disks?.[0]?.pct, lastSeen: d.lastSeen };
  }
  function storage() {
    const b = S.backup?.backup;
    if (!b || !b.configured || !b.target) return null;
    const t = b.target, last = b.last || {}, okAt = last.ok ? (last.finished_at || last.last_success_at) : last.last_success_at;
    const every = b.every === 'hourly' ? 3600 : 86400, age = okAt ? Math.max(0, Date.now() / 1000 - okAt) : null;
    const state = !okAt ? 'no' : b.state === 'failing' || age > 2 * every ? 'tight' : 'ok';
    return { id: 'storage', name: t.kind === 'r2' ? 'Cloudflare R2' : t.kind === 's3' ? 'S3 storage' : 'Backup storage', kind: 'cloud', cloud: true,
      state, age, every: b.every, at: b.at, say: b.say || '', failed: last.ok === false, lastError: last.ok === false, enabled: !!b.enabled };
  }
  function standbyOf(id) {
    const m = machine(id), raw = devOf(id)?.name, warn = (S.backup?.standby?.space_warnings || []).find(w => w.machine === raw || w.machine === m.name);
    const reach = m.status === 'online';
    const fit = !reach || (warn && warn.fits === false) ? 'tight' : 'ok';
    return { ...m, fit, warn, reach };
  }
  const humans = () => peers().filter(p => p.group === 'human').map(p => ({ ...p, name: p.name === 'localhost' && /ios/i.test(p.os || '') ? 'iPhone' : p.name, kind: /ios|android/i.test(p.os || '') ? 'phone' : 'laptop' }));

  // People of a managed Wizard: the names in the registry, plus an unnamed rest when only a count is known.
  function peopleOf(g) {
    const names = Array.isArray(g?.people) ? g.people.filter(n => typeof n === 'string' && n) : [];
    const count = Math.max(names.length, Number.isInteger(g?.peopleCount) ? g.peopleCount : 0);
    return { names, count, rest: count - names.length };
  }
  const PEEK = 4;  // people nodes shown beside Main before a "+N" node
  // The people column, left of Main: small nodes, one per device (his network) or per person (a managed Wizard).
  function peopleGroup(items, label, moreGo) {
    const shown = items.length > PEEK + 1 ? items.slice(0, PEEK) : items;
    const kids = shown.map(it => h('button', { type: 'button', cls: 'mh-pnode', data: { go: it.go, pid: it.go }, 'aria-label': it.aria || it.name },
      h('span', { cls: 'mh-pd' }, it.icon ? ico(it.icon) : h('b', { text: it.initial }), it.online == null ? null : h('span', { cls: 'mh-dot' + (it.online ? '' : ' off'), 'aria-hidden': 'true' })),
      h('span', { cls: 'n', text: it.name })));
    if (shown.length < items.length) kids.push(h('button', { type: 'button', cls: 'mh-pnode is-more', data: { go: moreGo, pid: moreGo }, 'aria-label': `${items.length - shown.length} more` },
      h('span', { cls: 'mh-pd' }, h('b', { text: '+' + (items.length - shown.length) })), h('span', { cls: 'n', text: 'more' })));
    return h('div', { cls: 'mh-people', data: { role: 'people' } }, h('div', { cls: 'mh-people-col' }, kids), h('span', { cls: 'mh-role', text: label }));
  }
  function minePeople() {
    const hs = humans();
    if (!hs.length) return null;
    return peopleGroup(hs.map(p => ({ name: p.name, icon: p.kind, online: !!p.online, go: 'humans', aria: `${p.name}, ${p.online ? 'online' : 'offline'}` })), hs.length === 1 ? 'Device' : 'Devices', 'humans');
  }
  function managedPeople(g) {
    const { names, count, rest } = peopleOf(g);
    if (!count) return null;
    const items = names.map((n, i) => ({ name: n, initial: n.trim()[0].toUpperCase(), go: `person:${i}` }));
    if (rest > 0) items.push({ name: names.length ? `${rest} more` : `${rest} people`, icon: 'person', go: 'people', aria: `${rest} ${names.length ? 'more people' : 'people'}` });
    return peopleGroup(items, count === 1 ? 'Person' : 'People', 'people');
  }

  /* ---------- skeleton ---------- */
  const root = h('section', { cls: 'mh-root', 'aria-label': 'Your machines', data: { mhRoot: '' } });
  const wsBar = h('div', { cls: 'mh-ws', role: 'tablist', 'aria-label': 'Network' });
  const top = h('header', { cls: 'mh-top' }, wsBar);
  const oneway = h('p', { cls: 'mh-oneway', hidden: true });
  const lines = sv('svg', { class: 'mh-lines', 'aria-hidden': 'true' });
  const lane = (cls, label) => { const row = h('div', { cls: 'mh-lane-row' }); return [h('div', { cls: 'mh-lane ' + cls }, h('h2', { cls: 'mh-lane-h', text: label }), row), row]; };
  const [laneSt, rowSt] = lane('is-storage', 'Storage'), [laneMn, rowMn] = lane('is-mainrow', 'Main and standby'), [laneHp, rowHp] = lane('is-helpers', 'Helpers');
  const map = h('div', { cls: 'mh-map' }, lines, laneSt, laneMn, laneHp);
  const note = h('div', { cls: 'mh-managed', hidden: true });
  const stage = h('div', { cls: 'mh-stage' }, oneway, map, note);
  const panel = h('aside', { cls: 'mh-panel', 'aria-live': 'polite' });
  const body = h('div', { cls: 'mh-body' }, stage, panel);
  const sheetIn = h('div', { cls: 'mh-sheet-in' });
  const sheet = h('dialog', { cls: 'mh-sheet', 'aria-label': 'Details' }, h('div', { cls: 'mh-grip', 'aria-hidden': 'true' }),
    h('button', { type: 'button', cls: 'mh-x', 'aria-label': 'Close', data: { act: 'close' } }, ico('x')), sheetIn);
  root.append(top, body, sheet);
  const wide = () => root.clientWidth >= 960;

  /* ---------- workspace switcher ---------- */
  function renderTabs() {
    const tabs = [h('button', { type: 'button', role: 'tab', data: { ws: 'mine' }, 'aria-selected': String(S.ws === 'mine'), 'aria-label': 'My network', title: 'My network' }, ico('net'), h('span', { text: 'My network' }))];
    // Their main's own status is not readable from here yet: a hollow dot, never a made-up green one.
    for (const g of managedList()) tabs.push(h('button', { type: 'button', role: 'tab', data: { ws: g.id }, 'aria-selected': String(S.ws === g.id), title: `${g.org || g.name} · status coming soon` }, h('span', { cls: 'mh-dot unk', 'aria-hidden': 'true' }), h('span', { text: g.name })));
    tabs.push(h('button', { type: 'button', cls: 'mh-ws-add', 'aria-label': 'Add a Main you manage', data: { act: 'add-managed' } }, ico('plus')));
    wsBar.replaceChildren(...tabs);
    const g = managedOf(S.ws);
    oneway.hidden = !g;
    if (g) oneway.replaceChildren(ico('arrow'), h('span', {}, 'You manage ', h('b', { text: g.name }), '. It can’t reach yours.'));
  }

  /* ---------- the map ---------- */
  function ring(frac) {
    const C = 2 * Math.PI * 46, s = sv('svg', { class: 'mh-ring', viewBox: '0 0 100 100', 'aria-hidden': 'true' });
    sv('circle', { class: 't', cx: 50, cy: 50, r: 46 }, s);
    sv('circle', { class: 'v', cx: 50, cy: 50, r: 46, 'stroke-dasharray': `${(C * clamp(frac, .02, 1)).toFixed(1)} ${C.toFixed(1)}` }, s);
    return s;
  }
  function node(m, role, opts = {}) {
    const s = opts.size || sizeOf(m, role), fit = opts.fit || '';
    const disc = h('span', { cls: 'mh-disc' }, ico(m.kind));
    if (role === 'main' && m.mem != null) disc.append(ring(clamp((m.disk ?? 0) / 100, .02, 1)));
    if (role !== 'main' && fit) { disc.append(ring({ ok: 1, tight: .62, no: .3 }[fit])); disc.append(h('span', { cls: 'mh-badge', 'aria-hidden': 'true' }, fit === 'ok' ? ico('check') : h('b', { text: '!' }))); }
    const el = h('button', { type: 'button', cls: `mh-node is-${role}`, data: { id: m.id, role, fit }, 'aria-pressed': String(S.sel === m.id), 'aria-label': `${m.name}, ${opts.roleText || role}`, style: { '--s': String(s) } },
      h('span', { cls: 'mh-hold' }, disc), h('span', { cls: 'mh-name', text: m.name }), h('span', { cls: 'mh-role', text: opts.roleText || role }));
    return el;
  }
  function plus(role, label, lead) {
    return h('button', { type: 'button', cls: 'mh-node is-plus is-empty', data: { act: 'add', role }, 'aria-label': `${label} (coming soon)` },
      h('span', { cls: 'mh-hold' }, h('span', { cls: 'mh-disc' }, ico('plus'))), h('span', { cls: 'mh-name', text: label }), h('span', { cls: 'mh-role', text: lead }));
  }
  const setLane = (row, items) => { row.replaceChildren(...items); const max = Math.max(46, ...items.map(n => +n.style?.getPropertyValue?.('--s') || 46)); row.style?.setProperty?.('--lane', String(max)); };
  function renderMap() {
    if (S.ws !== 'mine' && !managedOf(S.ws) && S.res.devices) S.ws = 'mine';
    const g = managedOf(S.ws);
    root.classList.toggle('is-managed', !!g);
    note.hidden = !g;
    if (g) {
      // Their network's shape, honestly empty: the rows are there, what fills them is not readable yet.
      const ghost = (role, label) => { const n = plus(role, label, SOON); n.dataset.act = 'soon'; n.dataset.what = `${g.name}’s ${label.toLowerCase()}`; n.classList.add('is-ghost'); return n; };
      setLane(rowMn, [managedPeople(g), node({ id: 'managed-' + g.id, name: g.name, kind: 'server' }, 'main', { size: 72, roleText: 'Main' }), ghost('standby', 'Standby')].filter(Boolean));
      setLane(rowSt, [ghost('storage', 'Storage')]); setLane(rowHp, [ghost('helper', 'Helpers')]);
      note.replaceChildren(managedCard(g));
      panel.replaceChildren(managedCard(g, true));
      api.frame(drawLines); return;
    }
    const main = machine(MAIN), st = storage(), sbs = usedAs('standby').map(standbyOf), hps = usedAs('helper');
    // Only a real answer from the Backup app may say "no storage yet"; a failed read says so instead.
    setLane(rowSt, st ? [node(st, 'storage', { fit: st.state, roleText: 'Storage' })] : S.backup?.backup ? [plus('storage', 'Add storage', 'Holds encrypted backups')]
      : [h('p', { cls: 'mh-wait', text: S.backupErr ? 'Backup status unavailable right now' : 'Checking backups…' })]);
    setLane(rowMn, [minePeople(), node(main, 'main', { roleText: 'Main' }), ...sbs.map(m => node(m, 'standby', { fit: m.fit, roleText: m.fit === 'ok' ? 'Standby' : 'Not ready' }))].filter(Boolean));
    setLane(rowHp, hps.length ? hps.map(id => node(machine(id), 'helper', { roleText: 'Helper' })) : [plus('helper', 'Add helper', SOON)]);
    if (wide()) { if (!S.sel) S.sel = 'this'; panel.replaceChildren(card(S.sel)); }
    api.frame(drawLines);
  }

  /* ---------- lines: drawn from the real node positions ---------- */
  function drawLines() {
    if (!root.isConnected || typeof map.getBoundingClientRect !== 'function') return;
    lines.replaceChildren();
    const M = map.getBoundingClientRect(); if (!M.width) return;
    const box = el => { const r = el.getBoundingClientRect(); return { l: r.left - M.left, r: r.right - M.left, t: r.top - M.top, b: r.bottom - M.top, cx: (r.left + r.right) / 2 - M.left, cy: (r.top + r.bottom) / 2 - M.top }; };
    const mainEl = [...rowMn.children].find(n => n.dataset.role === 'main'); if (!mainEl) return;
    const md = box(mainEl.firstElementChild.firstElementChild), mn = box(mainEl);
    map.style.setProperty('--cx', md.cx + 'px'); map.style.setProperty('--cy', md.cy + 'px');
    for (const row of [rowSt, rowMn, rowHp]) { row.classList.toggle('more-l', row.scrollLeft > 2); row.classList.toggle('more-r', row.scrollLeft + row.clientWidth < row.scrollWidth - 2); }
    const defs = sv('defs', {}, lines); let gi = 0;
    const line = (d, kind, col, label) => {
      const base = sv('path', { d, class: 'base ' + kind }, lines);
      if (kind === 'slot') { if (label) pill(base.getPointAtLength(base.getTotalLength() * .5), label, col || 'var(--mh-warn)'); return; }
      const L = base.getTotalLength(), i = gi++, a = base.getPointAtLength(0), z = base.getPointAtLength(L);
      const g = sv('linearGradient', { id: 'mhg' + i, gradientUnits: 'userSpaceOnUse', x1: a.x, y1: a.y, x2: z.x, y2: z.y }, defs);
      const s1 = sv('stop', { offset: '0' }, g), s2 = sv('stop', { offset: '1' }, g);
      s1.style.stopColor = col; s1.style.stopOpacity = '.2'; s2.style.stopColor = col; s2.style.stopOpacity = '1';
      base.style.stroke = col; base.style.strokeOpacity = '.45';
      const seg = Math.min(64, L * .4), c = sv('path', { d, class: 'comet', stroke: `url(#mhg${i})`, 'stroke-dasharray': `${seg.toFixed(1)} ${(L + seg).toFixed(1)}` }, lines);
      c.style.setProperty('--from', seg.toFixed(1)); c.style.setProperty('--to', (-L).toFixed(1)); c.style.setProperty('--dur', (1.4 + L / 150).toFixed(2) + 's');
      if (label) pill(base.getPointAtLength(L * .7), label, col);
    };
    const pill = (pt, text, col) => {
      const grp = sv('g', {}, lines), txt = sv('text', { x: pt.x, y: pt.y + 4, 'text-anchor': 'middle', class: 'mh-age' }, grp);
      txt.textContent = text; const bb = txt.getBBox();
      const r = sv('rect', { x: bb.x - 7, y: bb.y - 4, width: bb.width + 14, height: bb.height + 8, rx: (bb.height + 8) / 2, class: 'mh-age-bg' });
      grp.insertBefore(r, txt); r.style.stroke = col; r.style.strokeOpacity = '.6'; txt.style.fill = col === 'var(--mh-accent)' ? 'var(--ink)' : col;
    };
    // Storage (above): Main's disc top → under the storage disc. Colour and label carry the backup's freshness.
    for (const el of rowSt.children) {
      const disc = el.firstElementChild?.firstElementChild; if (!disc || !el.dataset) continue;
      const b = box(disc), sx = md.cx, sy = md.t - 6, ex = b.cx, ey = b.b + 6, k = (sy - ey) * .55;
      const d = `M${sx.toFixed(1)} ${sy.toFixed(1)} C${sx.toFixed(1)} ${(sy - k).toFixed(1)} ${ex.toFixed(1)} ${(ey + k).toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`;
      if (el.dataset.act === 'add') { line(d, 'slot'); continue; }
      const st = S.ws === 'mine' && storage(); if (!st) continue;
      if (st.state === 'no') line(d, 'slot', 'var(--mh-bad)', 'none yet');
      else line(d, 'backup', st.state === 'ok' ? 'var(--mh-accent)' : 'var(--mh-warn)', agoS(st.age));
    }
    // Standby (beside): a level line from Main's disc edge. Dashed and labelled while nothing reaches it.
    const row = [...rowMn.children], mi = row.indexOf(mainEl);
    // People (left): a quiet line from each person or device into Main's disc.
    for (const el of rowMn.querySelectorAll?.('.mh-pnode .mh-pd') || []) {
      const b = box(el), sx = b.r + 4, ex = md.l - 6; if (ex <= sx) continue;
      const k = (ex - sx) * .5;
      line(`M${sx.toFixed(1)} ${b.cy.toFixed(1)} C${(sx + k).toFixed(1)} ${b.cy.toFixed(1)} ${(ex - k).toFixed(1)} ${md.cy.toFixed(1)} ${ex.toFixed(1)} ${md.cy.toFixed(1)}`, 'slot');
    }
    row.forEach((el, i) => {
      if (i <= mi) return;
      const b = box(el.firstElementChild.firstElementChild), sx = md.r + 6, ex = b.l - 6; if (ex <= sx) return;
      line(`M${sx.toFixed(1)} ${md.cy.toFixed(1)} L${ex.toFixed(1)} ${b.cy.toFixed(1)}`, 'slot', '', el.dataset.act || el.dataset.fit === 'ok' ? '' : 'off');
    });
    // Helpers (below): from under Main's name to above each helper disc.
    for (const el of rowHp.children) {
      const disc = el.firstElementChild?.firstElementChild; if (!disc) continue;
      const b = box(disc), sx = mn.cx, sy = mn.b + 2, ex = b.cx, ey = b.t - 6, k = (ey - sy) * .55;
      line(`M${sx.toFixed(1)} ${sy.toFixed(1)} C${sx.toFixed(1)} ${(sy + k).toFixed(1)} ${ex.toFixed(1)} ${(ey - k).toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`, 'slot');
    }
  }

  /* ---------- cards ---------- */
  const head = (m, pill, accent) => h('div', { cls: 'mh-card-h' }, h('span', { cls: 'mh-disc' + (accent ? ' main' : '') }, ico(m.kind)), h('div', {}, h('h3', { text: m.name }), h('span', { cls: 'mh-pill' + (accent ? ' accent' : ''), text: pill })));
  const fitBox = (state, text, icon) => h('div', { cls: 'mh-fit ' + state }, ico(icon || (state === 'ok' ? 'check' : 'x')), h('span', { text }));
  const bar = pct => { const s = sv('svg', { class: 'mh-bar', viewBox: '0 0 100 12', preserveAspectRatio: 'none', 'aria-hidden': 'true' }); sv('rect', { class: 'tr', x: 0, y: 3, width: 100, height: 6, rx: 3 }, s); sv('rect', { class: 'fl', x: 0, y: 3, width: Math.max(3, clamp(pct, 0, 100)), height: 6, rx: 3 }, s); return s; };
  const usage = rows => h('ul', { cls: 'mh-needs' }, rows.filter(r => r[2] != null).map(([k, icon, pct, v]) => h('li', { cls: 'mh-need', data: { s: pct >= 90 ? 'no' : pct >= 75 ? 'tight' : 'ok' } }, ico(icon), h('span', { cls: 'k', text: k }), h('span', { cls: 'v', text: v }), bar(pct))));
  const facts = rows => h('ul', { cls: 'mh-facts' }, rows.filter(Boolean).map(([k, v, cls]) => h('li', { cls: cls || '' }, h('span', { cls: 'k', text: k }), h('span', { cls: 'v', text: v }))));
  const btn = (label, icon, act, cls = '') => h('button', { type: 'button', cls: 'mh-btn ' + cls, data: { act: 'soon', what: act } }, icon ? ico(icon) : null, label);
  const rowBtn = (m, sub, f, fcls, go) => h('li', {}, h('button', { type: 'button', cls: 'mh-row', data: { go } }, h('span', { cls: 't' }, ico(m.kind)), h('span', { cls: 'm' }, h('b', { text: m.name }), h('small', { text: sub })), f ? h('span', { cls: 'f ' + fcls, text: f }) : null));

  function card(id) {
    if (id === 'humans') {
      return h('div', { cls: 'mh-card' }, h('div', { cls: 'mh-card-h' }, h('span', { cls: 'mh-disc' }, ico('phone')), h('div', {}, h('h3', { text: 'Your devices' }), h('span', { cls: 'mh-pill', text: 'Screens' }))),
        h('p', { cls: 'mh-lead', text: 'Screens you use. They open your Wizard but don’t run it.' }),
        h('ul', { cls: 'mh-rows' }, humans().map(p => h('li', {}, h('div', { cls: 'mh-row' }, h('span', { cls: 't' }, ico(p.kind)), h('span', { cls: 'm' }, h('b', { text: p.name }), h('small', { text: p.online ? 'Online' : p.lastSeen ? `Offline · seen ${agoL((Date.now() - Date.parse(p.lastSeen)) / 1000)} ago` : 'Offline' })), h('span', { cls: 'mh-dot' + (p.online ? '' : ' off'), 'aria-hidden': 'true' }))))));
    }
    const g = managedOf(S.ws);
    if (g && (id === 'people' || id.startsWith('person:'))) {
      const { names, count, rest } = peopleOf(g), who = id === 'people' ? null : names[+id.slice(7)];
      if (who) return h('div', { cls: 'mh-card' }, h('div', { cls: 'mh-card-h' }, h('span', { cls: 'mh-disc' }, h('b', { cls: 'mh-initial', text: who.trim()[0].toUpperCase() })), h('div', {}, h('h3', { text: who }), h('span', { cls: 'mh-pill', text: 'Uses ' + g.name }))),
        facts([['Devices', SOON, 'soon']]), h('p', { cls: 'mh-note' }, ico('lock'), `Their devices aren’t readable from here yet.`));
      return h('div', { cls: 'mh-card' }, h('div', { cls: 'mh-card-h' }, h('span', { cls: 'mh-disc' }, ico('person')), h('div', {}, h('h3', { text: `${count} ${count === 1 ? 'person' : 'people'}` }), h('span', { cls: 'mh-pill', text: 'Use ' + g.name }))),
        names.length ? h('ul', { cls: 'mh-rows' }, names.map((n, i) => h('li', {}, h('button', { type: 'button', cls: 'mh-row', data: { go: `person:${i}` } }, h('span', { cls: 't' }, h('b', { cls: 'mh-initial', text: n.trim()[0].toUpperCase() })), h('span', { cls: 'm' }, h('b', { text: n }), h('small', { text: 'Devices: coming soon' })))))) : null,
        rest > 0 ? h('p', { cls: 'mh-lead', text: names.length ? `${rest} more not named yet.` : 'Names not added yet.' }) : null);
    }
    if (id === 'storage') {
      const st = storage(); if (!st) return h('div', { cls: 'mh-card' }, h('p', { cls: 'mh-lead', text: 'Backup status unavailable right now.' }));
      const when = st.age == null ? 'No finished backup yet' : `Last good copy ${agoL(st.age)} ago`;
      return h('div', { cls: 'mh-card' }, head(st, 'Storage'),
        st.state === 'ok' ? fitBox('ok', 'Holds your backups') : fitBox(st.state === 'no' ? 'no' : 'tight', st.say || when),
        h('p', { cls: 'mh-note' }, ico('lock'), 'Encrypted. Runs nothing.'),
        facts([['Last good copy', st.age == null ? 'None yet' : `${agoL(st.age)} ago`, st.age == null ? 'bad' : ''], ['Schedule', st.enabled ? `${st.every || 'Daily'}${st.at ? ' at ' + st.at : ''}` : 'Paused'], st.failed ? ['Last run', 'Did not finish', 'warn'] : null]),
        h('div', { cls: 'mh-actions' }, btn('Back up now', null, 'Back up now'), btn('Restore', 'restore', 'Restore')));
    }
    if (id === MAIN) {
      const m = machine(MAIN), st = storage(), sbs = usedAs('standby').map(standbyOf);
      const to = [];
      if (st) to.push(rowBtn(st, 'Storage', st.age == null ? 'none yet' : agoL(st.age), st.state === 'ok' ? 'ok' : st.state === 'no' ? 'no' : 'tight', 'storage'));
      for (const s of sbs) to.push(rowBtn(s, 'Standby', s.fit === 'ok' ? 'ready' : 'not ready', s.fit === 'ok' ? 'ok' : 'tight', s.id));
      return h('div', { cls: 'mh-card' }, head(m, 'Main', true), h('p', { cls: 'mh-lead', text: 'Your Wizard runs here.' }),
        usage([['CPU', 'cpu', m.cpu, m.cores ? `${m.cores} cores` : ''], ['Memory', 'mem', m.mem, m.ramGB ? `${m.ramUsedGB ?? '?'} / ${m.ramGB} GB` : ''], ['Disk', 'disk', m.disk, m.diskGB ? `${gbFmt(m.diskGB - (m.freeGB || 0))} / ${gbFmt(m.diskGB)}` : '']]),
        m.status !== 'online' ? fitBox('tight', 'Readings unavailable right now') : null,
        h('p', { cls: 'mh-sec-h', text: 'Backups go to' }), to.length ? h('ul', { cls: 'mh-rows' }, to) : fitBox('tight', 'No backups yet', 'lock'));
    }
    if (usedAs('standby').includes(id)) {
      const s = standbyOf(id), need = S.backup?.standby?.minimum;
      return h('div', { cls: 'mh-card' }, head(s, 'Standby'),
        s.fit === 'ok' ? fitBox('ok', 'Ready to take over') : fitBox('tight', 'Not ready to take over'),
        facts([['Reachable', s.reach ? 'Yes' : s.status === 'unreachable' ? 'No · can’t sign in' : 'Unknown', s.reach ? '' : 'warn'],
          s.warn ? ['Space', s.warn.fits === false ? 'Too small' : 'Fits', s.warn.fits === false ? 'warn' : ''] : null,
          s.warn?.total_gb ? ['Disk', `${gbFmt(s.warn.free_gb)} free of ${gbFmt(s.warn.total_gb)}`] : null,
          need ? ['Needs', `${need.cores} cores · ${need.ram_gb} GB · ${gbFmt(need.free_gb)} free`] : null,
          ['Backups here', 'Not set up yet', 'warn']]),
        s.warn?.say ? h('p', { cls: 'mh-note', text: s.warn.say }) : null,
        h('div', { cls: 'mh-actions' }, btn('Make this my Main', 'swap', 'Make this my Main', s.fit === 'ok' ? 'primary' : ''), btn('Restore here', 'restore', 'Restore here')));
    }
    return h('div', { cls: 'mh-card' });
  }
  function managedCard(g, inPanel) {
    return h('div', { cls: 'mh-card' + (inPanel ? '' : ' is-inline') }, h('div', { cls: 'mh-card-h' }, h('span', { cls: 'mh-disc main' }, ico('server')), h('div', {}, h('h3', { text: g.name }), h('span', { cls: 'mh-pill accent', text: 'Main you manage' }))),
      h('p', { cls: 'mh-lead', text: 'A Wizard you look after.' }),
      facts([g.org ? ['For', g.org] : null, g.where ? ['Address', g.where] : null, g.peer ? [g.peerName || g.peer, g.peerOnline == null ? 'Not on your tailnet' : g.peerOnline ? 'Online on your tailnet' : 'Offline', g.peerOnline ? '' : 'warn'] : null,
        ['Machines and resources', SOON, 'soon'], ['Backups', SOON, 'soon'], ['Status', SOON, 'soon']]),
      h('p', { cls: 'mh-note' }, ico('lock'), `One way: you manage ${g.name}. It can’t reach your network.`));
  }

  /* ---------- selection: side panel on wide, sheet on narrow ---------- */
  function select(id) {
    S.sel = id;
    for (const el of [...rowSt.children, ...rowMn.children, ...rowHp.children]) if (el.dataset?.id) el.setAttribute('aria-pressed', String(el.dataset.id === id));
    for (const el of rowMn.querySelectorAll?.('.mh-pnode') || []) el.setAttribute('aria-pressed', String(el.dataset.pid === id));
    const c = card(id);
    if (wide() && id !== 'humans' && S.ws === 'mine') { panel.replaceChildren(c); return; }
    sheetIn.replaceChildren(c);
    if (!sheet.open) { try { sheet.showModal(); } catch (_) { sheet.setAttribute('open', ''); } }
    if (!releaseBack) releaseBack = api.back.push(() => closeSheet());  // phone / browser Back and Esc close it first
    sheet.scrollTop = 0; S.sheet = id;
  }
  function closeSheet() { if (sheet.open) sheet.close(); S.sheet = null; releaseBack?.(); releaseBack = null; if (!wide()) { S.sel = null; for (const el of [...rowSt.children, ...rowMn.children, ...rowHp.children]) el.setAttribute?.('aria-pressed', 'false'); } }
  function setWs(ws) {
    S.ws = ws; S.sel = null; api.storage.set('ws', ws); closeSheet(); drawn = mapSig(); renderTabs(); renderMap();
    map.classList.remove('is-switch'); void map.offsetWidth; map.classList.add('is-switch');
  }

  api.listen(root, 'click', e => {
    if (e.target === sheet) { const r = sheet.getBoundingClientRect(); if (e.clientY < r.top || e.clientY > r.bottom || e.clientX < r.left || e.clientX > r.right) return closeSheet(); }
    let b = e.target; while (b && b !== root && b.tagName !== 'BUTTON') b = b.parentNode;
    if (!b || b === root) return;
    const d = b.dataset || {};
    if (d.ws) return setWs(d.ws);
    if (d.act === 'close') return closeSheet();
    if (d.act === 'humans') return select('humans');
    if (d.act === 'add-managed') return soon('Adding a Main you manage');
    if (d.act === 'add') return soon(d.role === 'helper' ? 'Adding a helper' : 'Adding storage');
    if (d.act === 'soon') return soon(d.what);
    if (d.go) return select(d.go);
    if (d.id && b.classList.contains('mh-node') && !d.id.startsWith('managed-')) return select(d.id);
  });
  api.listen(sheet, 'close', () => { S.sheet = null; releaseBack?.(); releaseBack = null; });

  /* ---------- data ---------- */
  // Repaint the map only when what it draws changed (roles, reachability, sizes, backup age); cards follow every poll.
  let drawn = '';
  const mapSig = () => JSON.stringify([S.ws, managedList().map(m => [m.id, peopleOf(m).names, peopleOf(m).count]), devices().map(d => [d.id, d.status, d.cpus, d.memoryTotalGB, diskGB(d)]), humans().map(p => [p.name, p.online]),
    S.backupErr, S.backup?.backup ? [S.backup.backup.state, S.backup.backup.last?.last_success_at, storage()?.age == null ? null : agoS(storage().age)] : !!S.backup, (S.backup?.standby?.space_warnings || []).map(w => w.fits)]);
  const read = state => {
    if (state) S.res = state;
    const sig = mapSig();
    if (sig !== drawn || !rowMn.firstChild) { drawn = sig; renderTabs(); renderMap(); }
    else if (wide() && S.ws === 'mine' && S.sel) panel.replaceChildren(card(S.sel));
    if (S.sheet && S.sheet !== 'humans' && S.sheet !== 'people' && !S.sheet.startsWith('person:') && sheet.open) sheetIn.replaceChildren(card(S.sheet));
  };
  async function readBackup(force) {
    const now = Date.now(); if (!force && now - S.backupTried < 60000) return; S.backupTried = now;
    const j = await api.data.read.app('backup', 'overview');
    if (j && j.backup && typeof j.backup === 'object') { S.backup = j; S.backupErr = false; } else S.backupErr = true;  // keep the last good answer
    read();
  }
  api.data.read.resources.watch(state => { read(state); readBackup(); });

  /* ---------- mount at Home; keep it there across Home repaints ---------- */
  const mount = () => { if (api.slot.mount('home-main', root)) { api.data.read.resources.refresh(); api.frame(drawLines); } };
  api.on('home', mount);
  api.on('route', () => { mount(); readBackup(); });
  let ro = null;
  if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(() => api.frame(() => { drawLines(); if (wide() && S.ws === 'mine' && !panel.firstChild) renderMap(); })); ro.observe(map); }
  for (const row of [rowSt, rowMn, rowHp]) api.listen(row, 'scroll', () => api.frame(drawLines), { passive: true });
  read(api.data.read.resources.snapshot());
  mount(); readBackup(true);
  return () => { ro?.disconnect(); if (sheet.open) sheet.close(); };
}
