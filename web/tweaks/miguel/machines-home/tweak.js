/* Miguel's Home = his network map, read-only and on real data. One map, the same on every workspace, everything inline
 * (no cards, no sheets): tap a thing to expand it in place, tap again to fold it.
 *   - top: the workspace switcher (this Wizard by its name, then the Wizards he manages), then one battery per AI
 *     subscription (tap: what is left and a nickname field, focused at once)
 *   - Storage above; machines in one row, Main first and the rest by rough power; people below, talking up to Main
 *   - under each machine: Memory, Disk and CPU bars (width = capacity, fill = use); tap a machine to fold them
 *   - inside Main: Working and Ready, which open the same lists the Home cards did
 *   - wires everywhere, a light travelling along each; the backup wire carries the last good copy's age
 * Data: the shell's Devices feed (api.data.read.resources), the Backup app's read API (api.data.read.app) and the
 * shell's session counts (api.data.read.sessions). Roles, names and managed Wizards come from the owner's devices
 * registry (~/.wizard-os/devices.json), never from this file. Nothing here writes, except nicknames on this device. */
const SVG = 'http://www.w3.org/2000/svg';
const PLUS = [['path', { d: 'M12 6v12M6 12h12' }]];

export default function setup(api) {
  const S = { ws: api.storage.get('ws') || 'mine', res: {}, backup: null, backupErr: false, backupTried: 0,
    fuel: null, open: new Set(), bars: api.storage.get('bars') !== 'off', nick: api.storage.get('nick') || {} };

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
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const gbFmt = v => v == null ? '?' : v >= 1000 ? `${(v / 1000).toFixed(1).replace(/\.0$/, '')} TB` : `${Math.round(v)} GB`;
  const agoS = sec => sec < 3600 ? `${Math.max(1, Math.round(sec / 60))}m` : sec < 86400 ? `${Math.round(sec / 3600)}h` : `${Math.round(sec / 86400)}d`;
  const pretty = n => String(n || '').replace(/([a-z])([A-Z])/g, '$1 $2');  // MyServer → My Server
  const initial = n => (String(n || '?').trim()[0] || '?').toUpperCase();

  /* ---------- data ---------- */
  const MAIN = 'this';
  const reg = () => S.res.devices || {};
  const devices = () => Array.isArray(reg().devices) ? reg().devices : [];
  const peers = () => reg().network?.available && Array.isArray(reg().network.peers) ? reg().network.peers : [];
  const devOf = id => devices().find(d => d.id === id) || null;
  const managedList = () => Array.isArray(reg().managed) ? reg().managed : [];
  const managedOf = id => managedList().find(m => m.id === id) || null;
  const diskGB = d => (d?.disks || []).reduce((n, x) => n + (+x.sizeGB || 0), 0) || null;
  const freeGB = d => (d?.disks || []).reduce((n, x) => n + (+x.freeGB || 0), 0) || null;
  const thisName = () => reg().this?.wizard || 'This Wizard';
  const ownerName = () => reg().this?.owner || 'You';
  function machine(id) {
    const d = devOf(id);
    if (!d) return { id, name: id === MAIN ? pretty(reg().this?.name) || 'Main' : id, status: 'unknown' };
    const dg = diskGB(d), fg = freeGB(d);
    return { id, name: pretty(d.name), status: d.status, cores: d.cpus || null, ramGB: d.memoryTotalGB || null,
      mem: d.memory, cpu: d.cpu, diskGB: dg, diskUsed: dg != null && fg != null ? dg - fg : null };
  }
  // Rough power, for size and order: cores, then memory, then disk.
  const power = m => (m.cores || m.ramGB) ? .45 * clamp((m.cores || 4) / 16, 0, 1.4) + .35 * clamp((m.ramGB || 4) / 64, 0, 1.4) + .2 * clamp((m.diskGB || 100) / 4000, 0, 1.4) : -1;
  const sizeOf = m => power(m) < 0 ? 50 : Math.round(clamp(46 + 56 * power(m), 46, 100));
  const qualOf = id => (S.backup?.standby?.machines || []).find(x => x.id === id) || null;
  const qualifies = id => /^(ok|yes|ready|fits)$/i.test(qualOf(id)?.verdict || '');
  function storage() {
    const b = S.backup?.backup;
    if (!b || !b.configured || !b.target) return null;
    const t = b.target, last = b.last || {}, okAt = last.ok ? (last.finished_at || last.last_success_at) : last.last_success_at;
    const every = b.every === 'hourly' ? 3600 : 86400, age = okAt ? Math.max(0, Date.now() / 1000 - okAt) : null;
    return { id: 'storage', name: t.kind === 'r2' ? 'Cloudflare R2' : t.kind === 's3' ? 'S3 storage' : 'Backup storage', age,
      state: !okAt ? 'no' : b.state === 'failing' || age > 2 * every ? 'tight' : 'ok' };
  }
  const backupRunning = () => Array.isArray(S.backup?.active) && S.backup.active.length > 0;
  const sessions = () => api.data.read.sessions?.counts() || { working: 0, ready: 0 };
  const myDevices = () => peers().filter(p => p.group === 'human').map(p => ({ name: p.name === 'localhost' && /ios/i.test(p.os || '') ? 'iPhone' : p.name, online: !!p.online }));
  function people() {
    if (S.ws === 'mine') return [{ id: 'me', name: ownerName(), devices: myDevices() }];
    const g = managedOf(S.ws); if (!g) return [];
    const names = (Array.isArray(g.people) ? g.people : []).filter(n => typeof n === 'string' && n);
    const rest = Math.max(0, (Number.isInteger(g.peopleCount) ? g.peopleCount : 0) - names.length);
    return [...names.map((n, i) => ({ id: 'p' + i, name: n, devices: null })), ...(rest ? [{ id: 'rest', name: `${rest} people`, devices: null, count: rest }] : [])];
  }
  // AI: one battery per subscription. Level = the tightest weekly allowance left; prepaid credit = balance of top-up.
  function fuel() {
    const out = [];
    for (const p of S.res.ai?.providers || []) {
      const ls = Array.isArray(p.limits) ? p.limits : [], wk = ls.filter(l => /week/i.test(l.label));
      const pick = (wk.length ? wk : ls).reduce((a, l) => !a || l.remainingPercent < a.remainingPercent ? l : a, null);
      let left = pick ? pick.remainingPercent : null, what = pick ? `of ${pick.label.replace(/ · /g, ' ').toLowerCase()} left` : '', resets = pick?.resetsAt || null;
      const paid = p.paid;
      if (left == null && paid?.type === 'credits' && paid.limitMinor > 0 && paid.balanceMinor != null) {
        left = 100 * paid.balanceMinor / paid.limitMinor; what = `left · $${(paid.balanceMinor / 10 ** (paid.exponent ?? 2)).toFixed(2)} credit`;
      }
      if (left == null) continue;
      const who = String(p.name || '').split('@')[0];
      out.push({ id: p.id, group: p.providerName, nick: S.nick[p.id] || (who && who !== p.providerName ? who : ''), left: Math.round(left), what, resets });
    }
    return out;
  }

  /* ---------- skeleton ---------- */
  const root = h('section', { cls: 'mh-root', 'aria-label': 'Your network', data: { mhRoot: '' } });
  const wsBar = h('div', { cls: 'mh-ws', role: 'tablist', 'aria-label': 'Network' });
  const fuelRow = h('div', { cls: 'mh-fuel', hidden: true, 'aria-label': 'AI subscriptions' });
  const fuelInfo = h('div', { cls: 'mh-finfo', hidden: true });
  const lines = sv('svg', { class: 'mh-lines', 'aria-hidden': 'true' });
  const row = cls => h('div', { cls: 'mh-row ' + cls });
  const rowSt = row('is-storage'), rowMn = row('is-machines'), rowPp = row('is-people'), rowDv = row('is-devices');
  const map = h('div', { cls: 'mh-map' }, lines, rowSt, rowMn, rowPp, rowDv);
  root.append(h('header', { cls: 'mh-top' }, wsBar), h('div', { cls: 'mh-body' }, fuelRow, fuelInfo, map));

  /* ---------- top ---------- */
  function renderTabs() {
    const tab = (id, name) => h('button', { type: 'button', role: 'tab', data: { ws: id }, 'aria-selected': String(S.ws === id) }, name);
    const add = h('button', { type: 'button', cls: 'mh-ws-add', 'aria-label': 'Add a Wizard you manage', data: { act: 'add-managed' } });
    const s = sv('svg', { class: 'mh-i', viewBox: '0 0 24 24', 'aria-hidden': 'true' }, add); for (const [t, a] of PLUS) sv(t, a, s);
    wsBar.replaceChildren(tab('mine', thisName()), ...managedList().map(g => tab(g.id, g.name)), add);
  }
  function renderFuel() {
    const rows = S.ws === 'mine' ? fuel() : [];
    fuelRow.hidden = !rows.length;
    const groups = [];
    for (const r of rows) { let g = groups.find(x => x.name === r.group); if (!g) groups.push(g = { name: r.group, rows: [] }); g.rows.push(r); }
    fuelRow.replaceChildren(...groups.map(g => h('div', { cls: 'mh-fgroup' }, h('span', { cls: 'mh-fname', text: g.name }), h('div', { cls: 'mh-fcells' },
      g.rows.map(r => h('button', { type: 'button', cls: 'mh-batt', data: { fuel: r.id, s: r.left <= 10 ? 'no' : r.left <= 25 ? 'tight' : 'ok' }, 'aria-pressed': String(S.fuel === r.id),
        'aria-label': `${g.name}${r.nick ? ' ' + r.nick : ''}: ${r.left}% ${r.what}` },
        h('span', { cls: 'mh-batt-g', style: { '--f': r.left + '%' } }, h('i')), h('small', { text: r.nick || (g.rows.length > 1 ? 'Account' : '') })))))));
    if (S.fuel && !rows.some(r => r.id === S.fuel)) S.fuel = null;
  }
  function renderFuelInfo(focus) {
    const r = S.fuel && fuel().find(x => x.id === S.fuel);
    fuelInfo.hidden = !r;
    if (!r) return fuelInfo.replaceChildren();
    const reset = r.resets && Date.parse(r.resets) > Date.now() ? ` · resets in ${agoS((Date.parse(r.resets) - Date.now()) / 1000)}` : '';
    const input = h('input', { cls: 'mh-nick', type: 'text', value: r.nick, placeholder: 'Nickname', maxlength: '24', 'aria-label': `Nickname for this ${r.group} subscription`, data: { nick: r.id } });
    fuelInfo.replaceChildren(h('b', { text: r.group }), input, h('span', { text: `${r.left}% ${r.what}${reset}` }));
    if (focus) api.frame(() => { input.focus?.(); input.select?.(); });
  }

  /* ---------- the map ---------- */
  function bars(m, maxOf) {
    if (!S.bars || m.status !== 'online') return null;
    const bar = (k, cap, used, text) => cap ? h('span', { cls: 'mh-bar', title: `${k}: ${text}` },
      h('i', { style: { '--w': (100 * clamp(cap / maxOf[k], .3, 1)).toFixed(0) + '%', '--f': (100 * clamp(used / cap, 0, 1)).toFixed(0) + '%' } }), h('small', { text: k === 'CPU' ? `${cap} cores` : gbFmt(cap) })) : h('span', { cls: 'mh-bar is-none' });
    return h('span', { cls: 'mh-bars' },
      bar('Memory', m.ramGB, m.ramGB * (m.mem || 0) / 100, `${Math.round(m.mem || 0)}% of ${gbFmt(m.ramGB)} used`),
      bar('Disk', m.diskGB, m.diskUsed || 0, `${gbFmt(m.diskUsed)} of ${gbFmt(m.diskGB)} used`),
      bar('CPU', m.cores, m.cores * (m.cpu || 0) / 100, `${Math.round(m.cpu || 0)}% of ${m.cores} cores busy`));
  }
  function machineNode(m, role, maxOf, extra = {}) {
    const s = extra.size || sizeOf(m), off = m.status && m.status !== 'online' && role !== 'main';
    const disc = h('span', { cls: 'mh-disc' + (off ? ' is-off' : '') });
    if (role === 'main' && extra.sessions) {
      const x = extra.sessions;
      disc.append(h('span', { cls: 'mh-sess' },
        h('button', { type: 'button', cls: 'mh-s work' + (x.working ? ' on' : ''), data: { open: 'working' }, 'aria-label': `Working ${x.working}` }, h('b', { text: String(x.working) }), 'working'),
        h('button', { type: 'button', cls: 'mh-s ready' + (x.ready ? ' on' : ''), data: { open: 'ready' }, 'aria-label': `Ready ${x.ready}` }, h('b', { text: String(x.ready) }), 'ready')));
    }
    return h('div', { cls: `mh-node is-${role}`, data: { id: m.id, role }, style: { '--s': String(s) } },
      h('span', { cls: 'mh-hold' }, h('span', { cls: 'mh-tap', role: 'button', tabindex: '0', data: { toggle: 'bars' }, 'aria-label': `${m.name}, ${extra.roleText}. Show or hide usage` }, disc)),
      h('span', { cls: 'mh-name', text: m.name }), h('span', { cls: 'mh-role' + (extra.warn ? ' warn' : ''), text: extra.roleText }),
      maxOf ? bars(m, maxOf) : null);
  }
  function personNode(p) {
    const open = S.open.has(p.id), n = p.devices ? p.devices.length : null;
    return h('button', { type: 'button', cls: 'mh-person', data: { person: p.id }, 'aria-expanded': String(open), 'aria-label': `${p.name}${n != null ? `, ${n} devices` : ''}` },
      h('span', { cls: 'mh-pdisc', text: p.count ? '+' + p.count : initial(p.name) }), h('span', { cls: 'mh-name', text: p.name }),
      n ? h('span', { cls: 'mh-role', text: `${n} device${n === 1 ? '' : 's'}` }) : null);
  }
  function renderMap() {
    if (S.ws !== 'mine' && !managedOf(S.ws) && S.res.devices) S.ws = 'mine';
    const g = managedOf(S.ws);
    root.classList.toggle('is-managed', !!g);
    if (g) {
      // Only what is known about a Wizard he manages: its Main and who uses it. Same design, less data.
      setRow(rowSt, []); setRow(rowMn, [machineNode({ id: 'managed-' + g.id, name: g.name }, 'main', null, { size: 72, roleText: 'Main' })]);
    } else {
      const st = storage();
      setRow(rowSt, st ? [h('div', { cls: 'mh-node is-storage', data: { id: 'storage', role: 'storage', fit: st.state }, style: { '--s': '54' } },
        h('span', { cls: 'mh-hold' }, h('span', { cls: 'mh-disc' })), h('span', { cls: 'mh-name', text: st.name }), h('span', { cls: 'mh-role', text: 'Storage' }))] : []);
      const main = machine(MAIN), others = devices().filter(d => d.id !== MAIN).map(d => machine(d.id)).sort((a, b) => power(b) - power(a));
      const all = [main, ...others].filter(m => m.status === 'online');
      const maxOf = { Memory: Math.max(1, ...all.map(m => m.ramGB || 0)), Disk: Math.max(1, ...all.map(m => m.diskGB || 0)), CPU: Math.max(1, ...all.map(m => m.cores || 0)) };
      setRow(rowMn, [
        h('div', { cls: 'mh-legend', hidden: !S.bars, 'aria-hidden': 'true' }, h('span', { text: 'Memory' }), h('span', { text: 'Disk' }), h('span', { text: 'CPU' })),
        machineNode(main, 'main', maxOf, { roleText: 'Main', sessions: sessions() }),
        ...others.map(m => machineNode(m, qualifies(m.id) ? 'standby' : 'helper', maxOf,
          { roleText: qualifies(m.id) ? 'Standby device' : m.status === 'online' ? 'Helper' : 'Helper · offline', warn: m.status !== 'online' }))]);
    }
    const ps = people();
    setRow(rowPp, ps.map(personNode));
    const devs = ps.filter(p => S.open.has(p.id)).flatMap(p => p.devices ? p.devices.map(d => h('span', { cls: 'mh-dev', data: { of: p.id } },
      h('i', { cls: 'mh-dot' + (d.online ? '' : ' off') }), d.name)) : [h('span', { cls: 'mh-dev is-none', data: { of: p.id }, text: `${p.name}’s devices aren’t visible yet` })]);
    setRow(rowDv, devs);
    api.frame(drawLines);
  }
  function setRow(r, items) { r.replaceChildren(...items); r.hidden = !items.length; }

  /* ---------- wires: drawn from the real positions, a light running along each ---------- */
  function drawLines() {
    if (!root.isConnected || typeof map.getBoundingClientRect !== 'function') return;
    lines.replaceChildren();
    const M = map.getBoundingClientRect(); if (!M.width) return;
    const box = el => { const r = el.getBoundingClientRect(); return { l: r.left - M.left, r: r.right - M.left, t: r.top - M.top, b: r.bottom - M.top, cx: (r.left + r.right) / 2 - M.left, cy: (r.top + r.bottom) / 2 - M.top }; };
    const discOf = n => { let x = n?.firstElementChild; while (x && !x.classList.contains('mh-disc')) x = x.firstElementChild; return x || n; };
    const defs = sv('defs', {}, lines); let gi = 0;
    const f = v => v.toFixed(1);
    const wire = (d, col = 'var(--mh-accent)', label = '', speed = 1) => {
      const base = sv('path', { d, class: 'base' }, lines); base.style.stroke = col;
      const L = base.getTotalLength(); if (!L) return;
      const i = gi++, a = base.getPointAtLength(0), z = base.getPointAtLength(L);
      const g = sv('linearGradient', { id: 'mhg' + i, gradientUnits: 'userSpaceOnUse', x1: a.x, y1: a.y, x2: z.x, y2: z.y }, defs);
      const s1 = sv('stop', { offset: '0' }, g), s2 = sv('stop', { offset: '1' }, g);
      s1.style.stopColor = col; s1.style.stopOpacity = '.15'; s2.style.stopColor = col; s2.style.stopOpacity = '1';
      const seg = Math.min(46, L * .4), c = sv('path', { d, class: 'comet', stroke: `url(#mhg${i})`, 'stroke-dasharray': `${f(seg)} ${f(L + seg)}` }, lines);
      c.style.setProperty('--from', f(seg)); c.style.setProperty('--to', f(-L)); c.style.setProperty('--dur', ((1.6 + L / 120) / speed).toFixed(2) + 's');
      if (label) {
        const pt = base.getPointAtLength(L * .5), grp = sv('g', {}, lines), txt = sv('text', { x: pt.x, y: pt.y + 4, 'text-anchor': 'middle', class: 'mh-age' }, grp);
        txt.textContent = label; const bb = txt.getBBox();
        grp.insertBefore(sv('rect', { x: bb.x - 7, y: bb.y - 4, width: bb.width + 14, height: bb.height + 8, rx: (bb.height + 8) / 2, class: 'mh-age-bg' }), txt);
      }
    };
    const curveV = (x1, y1, x2, y2) => { const k = (y2 - y1) * .5; return `M${f(x1)} ${f(y1)} C${f(x1)} ${f(y1 + k)} ${f(x2)} ${f(y2 - k)} ${f(x2)} ${f(y2)}`; };
    const mainEl = [...rowMn.children].find(n => n.dataset?.role === 'main'); if (!mainEl) return;
    const md = box(discOf(mainEl)), mn = box(mainEl);
    map.style.setProperty('--cx', md.cx + 'px'); map.style.setProperty('--cy', md.cy + 'px');
    // Main → storage, above. Fast while a backup uploads; otherwise it carries the last good copy's age.
    const stEl = rowSt.firstElementChild;
    if (stEl) {
      const sd = box(discOf(stEl)), st = storage();
      const col = st?.state === 'ok' ? 'var(--mh-accent)' : st?.state === 'no' ? 'var(--mh-bad)' : 'var(--mh-warn)';
      wire(curveV(md.cx, md.t - 4, sd.cx, sd.b + 4), col, backupRunning() ? 'backing up' : st?.age == null ? 'none yet' : agoS(st.age) + ' ago', backupRunning() ? 3 : 1);
    }
    // Machines: a chain from Main through each machine, in row order.
    const ms = [...rowMn.children].filter(n => n.dataset?.role);
    for (let i = 1; i < ms.length; i++) {
      const a = box(discOf(ms[i - 1])), b = box(discOf(ms[i]));
      if (b.l - 3 > a.r + 3) wire(`M${f(a.r + 3)} ${f(a.cy)} L${f(b.l - 3)} ${f(b.cy)}`, discOf(ms[i]).classList.contains('is-off') ? 'var(--ink-3)' : 'var(--mh-accent)');
    }
    // People → Main, from below (faster while sessions work); devices → their person.
    const busy = S.ws === 'mine' && sessions().working > 0;
    for (const p of rowPp.children) {
      const pd = box(p.firstElementChild);
      wire(curveV(pd.cx, pd.t - 4, md.cx, mn.b + 2), 'var(--mh-accent)', '', busy ? 2 : 1);
    }
    for (const d of rowDv.children) {
      const p = [...rowPp.children].find(x => x.dataset.person === d.dataset.of); if (!p) continue;
      const pb = box(p), db = box(d);
      wire(curveV(db.cx, db.t - 2, pb.cx, pb.b + 2), 'var(--ink-3)');
    }
  }

  /* ---------- taps: everything expands in place ---------- */
  api.listen(root, 'click', e => {
    let b = e.target; while (b && b !== root && !(b.dataset && (b.dataset.ws || b.dataset.act || b.dataset.fuel || b.dataset.open || b.dataset.person || b.dataset.toggle))) b = b.parentNode;
    if (!b || b === root) return;
    const d = b.dataset;
    if (d.open) return api.data.read.sessions?.open(d.open);
    if (d.ws) { S.ws = d.ws; S.fuel = null; api.storage.set('ws', d.ws); paint(true); map.classList.remove('is-switch'); void map.offsetWidth; map.classList.add('is-switch'); return; }
    if (d.act === 'add-managed') return api.toast('Adding a Wizard you manage: coming soon');
    if (d.fuel) { S.fuel = S.fuel === d.fuel ? null : d.fuel; renderFuel(); renderFuelInfo(true); return; }
    if (d.person) { S.open.has(d.person) ? S.open.delete(d.person) : S.open.add(d.person); renderMap(); return; }
    if (d.toggle === 'bars') { S.bars = !S.bars; api.storage.set('bars', S.bars ? 'on' : 'off'); renderMap(); }
  });
  api.listen(root, 'keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target?.dataset?.toggle) { e.preventDefault?.(); e.target.click?.(); } });
  api.listen(root, 'input', e => {
    const id = e.target?.dataset?.nick; if (!id) return;
    const v = String(e.target.value || '').trim().slice(0, 24);
    if (v) S.nick[id] = v; else delete S.nick[id];
    api.storage.set('nick', S.nick); renderFuel();
  });

  /* ---------- data ---------- */
  // Repaint only when what the map draws changed; the nickname field is never rebuilt while typing.
  let drawn = '';
  const sig = () => JSON.stringify([S.ws, reg().this, managedList(), devices().map(d => [d.id, d.status, d.cpus, d.memoryTotalGB, diskGB(d), Math.round((d.memory || 0) / 5), Math.round((d.cpu || 0) / 5), Math.round((d.disks?.[0]?.pct || 0) / 5)]),
    myDevices(), sessions(), backupRunning(), storage()?.state, storage()?.age == null ? null : agoS(storage().age), (S.backup?.standby?.machines || []).map(x => [x.id, x.verdict]), fuel()]);
  function paint(force) {
    const s = sig(); if (!force && s === drawn && rowMn.firstChild) return;
    drawn = s; renderTabs(); renderFuel(); renderMap();
    if (!fuelInfo.contains?.(document.activeElement)) renderFuelInfo(false);
  }
  async function readBackup(force) {
    const now = Date.now(); if (!force && now - S.backupTried < 60000) return; S.backupTried = now;
    const j = await api.data.read.app('backup', 'overview');
    if (j && j.backup && typeof j.backup === 'object') { S.backup = j; S.backupErr = false; } else S.backupErr = true;  // keep the last good answer
    paint();
  }
  api.data.read.resources.watch(state => { if (state) S.res = state; paint(); readBackup(); });

  /* ---------- mount at Home; keep it there across Home repaints ---------- */
  const mount = () => { if (api.slot.mount('home-main', root)) { api.data.read.resources.refresh(); api.frame(drawLines); } };
  api.on('home', () => { mount(); paint(); });
  api.on('route', () => { mount(); readBackup(); });
  let ro = null;
  if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(() => api.frame(drawLines)); ro.observe(map); }
  S.res = api.data.read.resources.snapshot() || {};
  paint(true); mount(); readBackup(true);
  return () => { ro?.disconnect(); };
}
