/* Miguel's Home = his network map, read-only and on real data. One map, the same on every workspace, everything inline
 * (no cards, no sheets): simple at rest, tap a thing to see more of it in place, tap again to fold it.
 *   - top: the workspace switcher (this Wizard by its name, then the Wizards he manages), then one AI fuel tag for the
 *     default model's service (all its subscriptions combined). Tap it: every account with its nickname, what is left,
 *     Sign out per account, add credit where that is how the service is paid, and one "Sign in to another account".
 *   - Storage above (how much is stored; tap for where, how often and what is kept)
 *   - machines in one row with Main in the middle; helpers alternate right, left, right… biggest nearest to Main.
 *     Tap a helper: what it can become (storage, standby) and whether it qualifies, or Reconnect when Wizard lost it.
 *     One "Show details" under the row folds Memory / Disk / CPU for all machines, smoothly.
 *   - inside Main: a working bubble and a ready bubble; one tap opens your chats
 *   - people below, wired to Main; tap a person for their devices
 * Calm by design: the last good readings paint at once (kept on this device), entry motion plays once, and later
 * readings change only what changed; wires are redrawn only when they move.
 * Data: the shell's Devices feed (api.data.read.resources), the Backup app's read API (api.data.read.app), the shell's
 * session counts (api.data.read.sessions) and the default model (api.models.default). Roles, names and managed
 * Wizards come from the owner's devices registry (~/.wizard-os/devices.json), never from this file. Nothing here
 * writes: actions open the service's own app or ask the agent in a new chat (api.nav.ask). */
const SVG = 'http://www.w3.org/2000/svg';
const PLUS = [['path', { d: 'M12 6v12M6 12h12' }]];
const BELL = [['path', { d: 'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z' }], ['path', { d: 'M10 20a2 2 0 0 0 4 0' }]];
const APP_OF = { chatgpt: 'wizard-chatgpt', claude: 'wizard-claude', tinfoil: 'wizard-tinfoil' };
const BUILT_IN = [['claude', 'Claude'], ['chatgpt', 'ChatGPT'], ['tinfoil', 'Tinfoil']];
const TOP_UP = { tinfoil: 'https://dash.tinfoil.sh/?tab=billing' };

export default function setup(api) {
  const S = { ws: api.storage.get('ws') || 'mine', res: {}, backup: api.storage.get('backup') || null, backupTried: 0,
    open: new Set(api.storage.get('devs') === 'off' ? [] : ['devs']), bars: api.storage.get('details') !== 'off', unread: 0, nick: api.storage.get('nick') || {}, def: api.storage.get('def') || '' };
  let fresh = true;  // entry motion only on the first paint and on a workspace switch, never on a later reading

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
  const bell = () => { const s = sv('svg', { class: 'mh-i', viewBox: '0 0 24 24', 'aria-hidden': 'true' }); for (const [t, a] of BELL) sv(t, a, s); return s; };
  const nw = cls => fresh ? cls + ' mh-new' : cls;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const gbFmt = v => v == null ? '?' : v >= 1000 ? `${(v / 1000).toFixed(1).replace(/\.0$/, '')} TB` : v >= 100 ? `${Math.round(v)} GB` : `${v.toFixed(1).replace(/\.0$/, '')} GB`;
  const agoS = sec => sec < 3600 ? `${Math.max(1, Math.round(sec / 60))}m` : sec < 86400 ? `${Math.round(sec / 3600)}h` : `${Math.round(sec / 86400)}d`;
  const pretty = n => String(n || '').replace(/([a-z])([A-Z])/g, '$1 $2');  // MyServer → My Server
  const initial = n => (String(n || '?').trim()[0] || '?').toUpperCase();
  const level = v => v <= 10 ? 'no' : v <= 25 ? 'tight' : 'ok';

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
    return { id, name: pretty(d.name), status: d.status, error: d.error || '', cores: d.cpus || null, ramGB: d.memoryTotalGB || null,
      mem: d.memory, cpu: d.cpu, diskGB: dg, freeGB: fg, diskUsed: dg != null && fg != null ? dg - fg : null };
  }
  // Rough power, for size and order: cores, then memory, then disk.
  const power = m => (m.cores || m.ramGB) ? .45 * clamp((m.cores || 4) / 16, 0, 1.4) + .35 * clamp((m.ramGB || 4) / 64, 0, 1.4) + .2 * clamp((m.diskGB || 100) / 4000, 0, 1.4) : -1;
  const sizeOf = m => power(m) < 0 ? 50 : Math.round(clamp(46 + 56 * power(m), 46, 100));
  const qualOf = id => (S.backup?.standby?.machines || []).find(x => x.id === id) || null;
  const qualifies = id => /^(ok|yes|ready|fits)$/i.test(qualOf(id)?.verdict || '');
  // Wizard reaches the machine's network but can't log in = Disconnected; not on the network at all = Offline.
  const offText = m => m.status === 'unreachable' || /denied|refused|timed out|auth/i.test(m.error) ? 'Disconnected' : 'Offline';
  function storage() {
    const b = S.backup?.backup;
    if (!b || !b.configured || !b.target) return null;
    const t = b.target, last = b.last || {}, okAt = last.ok ? (last.finished_at || last.last_success_at) : last.last_success_at;
    const every = b.every === 'hourly' ? 3600 : 86400, age = okAt ? Math.max(0, Date.now() / 1000 - okAt) : null;
    const used = +last.repository_bytes > 0 ? last.repository_bytes / 1e9 : null, r = b.retention || {};
    const span = [+r.daily > 0 && `any of the last ${r.daily} days`, +r.weekly > 0 && `one a week for ${r.weekly} weeks`, +r.monthly > 0 && `one a month for ${r.monthly} months`].filter(Boolean);
    const cf = (S.backup?.connector || []).find(c => c && /cloudflare/i.test(c.id || c.name || '') && c.connected);
    return { id: 'storage', where: t.kind === 'r2' ? 'Cloudflare R2' : t.kind === 's3' ? 'S3 storage' : 'Backup storage', bucket: t.bucket || '',
      used, snaps: +last.snapshots || null, every: b.every === 'hourly' ? 'every hour' : b.at ? `daily at ${b.at}` : 'daily', age,
      keep: span.length ? 'Older backups thin out: daily for a week, weekly for a month, monthly for 6 months' : '', cf: !!cf,
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
    return [...names.map((n, i) => ({ id: 'p' + i, name: n, devices: null })), ...(rest ? [{ id: 'rest', name: `${rest} more`, devices: null, count: rest }] : [])];
  }
  // What a helper can become, and whether it qualifies. Storage keeps copies of the backup (room for two, plus margin);
  // standby is the Backup app's own verdict (big enough to take over from Main at once).
  // Each action says why not, one short line per reason, so the owner knows what to fix.
  const reason = c => c.what === 'system' ? `runs ${String(c.say || '').split(':')[0]}; Wizard needs Linux or a Mac`
    : String(c.say || '').replace(/^(\d+) (cores|GB memory|GB free) \(needs (\d+)\)$/, (_, h, k, n) => `has ${h} ${k === 'cores' ? 'cores' : k === 'GB memory' ? 'GB memory' : 'GB free'}, needs ${n}`);
  function actions(m) {
    if (m.status !== 'online') return [{ id: 'reconnect', label: 'Reconnect', ok: true, note: m.error ? 'Wizard can’t log in' : 'Not on the network',
      words: `Reconnect ${m.name} to this Wizard so it shows as a helper again.`, why: m.error || `${m.name} is ${offText(m).toLowerCase()}.` },
      { id: 'storage', label: 'Use for storage', ok: false, note: 'Not eligible', no: ['reconnect it first'] },
      { id: 'standby', label: 'Make standby', ok: false, note: 'Not eligible', no: ['reconnect it first'] }];
    const repo = S.backup?.backup?.last?.repository_bytes ? S.backup.backup.last.repository_bytes / 1e9 : 25;
    const need = Math.max(50, Math.ceil(2 * repo + 20)), free = m.freeGB == null ? null : Math.round(m.freeGB);
    const q = qualOf(m.id), ready = !!q && /^(ok|yes|ready|fits)$/i.test(q.verdict || '');
    const stNo = free == null ? ['its disk isn’t reported yet'] : free >= need ? [] : [`has ${free} GB free, needs ${need}`];
    const sbNo = !q || q.verdict === 'unknown' ? ['Wizard is still checking it'] : ready ? [] : (q.checks || []).filter(c => c && c.ok === false).map(reason);
    return [
      { id: 'storage', label: 'Use for storage', ok: !stNo.length, note: stNo.length ? 'Not eligible' : `${free} GB free`, no: stNo,
        words: `Make ${m.name} a storage device for my backups.`, why: `${m.name}: ${free} GB free; backup copies take ${gbFmt(repo)}.` },
      { id: 'standby', label: qualifies(m.id) ? 'Standby device' : 'Make standby', ok: ready, note: ready ? 'Can take over' : 'Not eligible', no: ready ? [] : sbNo.length ? sbNo : [q.say || 'not suitable'],
        words: `Make ${m.name} my standby device.`, why: (q?.checks || []).map(c => c.say).join('; ') }];
  }
  // AI: every account. Level = the tightest weekly allowance left; prepaid credit = balance of top-up.
  const kindOf = p => String(p.provider || p.id || '').split(':')[0];
  function subs() {
    const out = [];
    for (const p of S.res.ai?.providers || []) {
      const kind = kindOf(p), ls = Array.isArray(p.limits) ? p.limits : [], wk = ls.filter(l => /week/i.test(l.label));
      const pick = (wk.length ? wk : ls).reduce((a, l) => !a || l.remainingPercent < a.remainingPercent ? l : a, null);
      let left = pick ? pick.remainingPercent : null, money = '';
      const paid = p.paid, ex = paid?.exponent ?? 2;
      if (left == null && paid?.type === 'credits' && paid.limitMinor > 0 && paid.balanceMinor != null) {
        left = 100 * paid.balanceMinor / paid.limitMinor; money = `$${(paid.balanceMinor / 10 ** ex).toFixed(2)}`;
      }
      const signedOut = p.status === 'unavailable' || p.status === 'signed_out' || p.status === 'auth' || (left == null && !money);
      const who = String(p.name || '').split('@')[0];
      out.push({ id: p.id, kind, group: p.providerName || kind, nick: S.nick[p.id] || '', auto: who && who !== p.providerName ? who : '',
        email: p.email || '', left: left == null ? null : Math.round(left), money, out: signedOut, resets: pick?.resetsAt || null });
    }
    return out;
  }
  // Services you can sign in to: the three every Wizard ships with, plus any other AI connector the feed reports.
  const signable = () => { const list = BUILT_IN.map(([k, n]) => ({ kind: k, name: n, app: APP_OF[k] }));
    for (const s of subs()) if (!list.some(x => x.kind === s.kind) && /^[a-z0-9-]+$/.test(s.kind)) list.push({ kind: s.kind, name: s.group, app: APP_OF[s.kind] || `wizard-${s.kind}` });
    return list; };
  const appOf = kind => (signable().find(x => x.kind === kind) || {}).app || null;
  // The gauge: the default model's service, all its accounts together (average left).
  const defKind = () => { const d = api.models?.default?.(); const p = String(d?.provider || '').toLowerCase();
    const k = /claude|anthropic/.test(p) ? 'claude' : /openai|codex|chatgpt/.test(p) ? 'chatgpt' : /tinfoil/.test(p) ? 'tinfoil' : '';
    if (k && k !== S.def) { S.def = k; api.storage.set('def', k); } return S.def; };
  function gauge() {
    const all = subs().filter(s => s.left != null && !s.out), want = defKind();
    const pool = all.filter(s => !want || s.kind === want), use = pool.length ? pool : all;
    if (!use.length) return null;
    return { left: Math.round(use.reduce((n, s) => n + s.left, 0) / use.length), name: use[0].group, n: use.length };
  }

  /* ---------- skeleton ---------- */
  const root = h('section', { cls: 'mh-root', 'aria-label': 'Your network', data: { mhRoot: '' } });
  const wsBar = h('div', { cls: 'mh-ws', role: 'tablist', 'aria-label': 'Network' });
  const aiRow = h('div', { cls: 'mh-ai', hidden: true });
  const aiList = h('div', { cls: 'mh-ai-list', hidden: true, 'aria-label': 'AI accounts' });
  const lines = sv('svg', { class: 'mh-lines', 'aria-hidden': 'true' });
  const row = cls => h('div', { cls: 'mh-row ' + cls });
  const rowSt = row('is-storage'), rowMn = row('is-machines'), rowAct = row('is-act'), rowMore = row('is-more'), rowPp = row('is-people'), rowDv = row('is-devices'), rowChev = row('is-more is-devchev');
  const map = h('div', { cls: 'mh-map' + (S.bars ? ' is-details' : '') }, lines, rowSt, rowMn, rowAct, rowMore, rowPp, rowDv, rowChev);
  root.append(h('header', { cls: 'mh-top' }, wsBar), h('div', { cls: 'mh-body' }, aiRow, aiList, map));

  /* ---------- top ---------- */
  function renderTabs() {
    const tab = (id, name) => h('button', { type: 'button', role: 'tab', data: { ws: id }, 'aria-selected': String(S.ws === id) }, name);
    const add = h('button', { type: 'button', cls: 'mh-ws-add', 'aria-label': 'Add a Wizard you manage', data: { act: 'add-managed' } });
    const s = sv('svg', { class: 'mh-i', viewBox: '0 0 24 24', 'aria-hidden': 'true' }, add); for (const [t, a] of PLUS) sv(t, a, s);
    wsBar.replaceChildren(tab('mine', thisName()), ...managedList().map(g => tab(g.id, g.name)), add);
  }
  // A fuel tag: "AI", then E, ten cells that fill, F. No percentage at rest.
  function gaugeEl(g) {
    const on = Math.round(g.left / 10);
    return h('button', { type: 'button', cls: nw('mh-gauge'), data: { toggle: 'ai', s: level(g.left) }, 'aria-expanded': String(S.open.has('ai')),
      'aria-label': `AI: ${g.name}, ${g.left}% left${g.n > 1 ? ` across ${g.n} accounts` : ''}. Show accounts` },
      h('b', { cls: 'mh-g-label', text: 'AI' }), h('span', { cls: 'mh-g-ef', text: 'E' }),
      h('span', { cls: 'mh-g-cells', 'aria-hidden': 'true' }, Array.from({ length: 10 }, (_, i) => h('i', { cls: i < on ? 'on' : '', style: { '--i': String(i) } }))),
      h('span', { cls: 'mh-g-ef', text: 'F' }));
  }
  function renderAI() {
    const g = S.ws === 'mine' ? gauge() : null;
    aiRow.hidden = !g;
    aiRow.replaceChildren(...(g ? [gaugeEl(g)] : []));
    if (!g) S.open.delete('ai');
  }
  // Every account, grouped by service (the gauge's own first): nickname, what is left, Sign out; one Sign in at the end.
  function renderAIList() {
    const show = S.ws === 'mine' && S.open.has('ai');
    aiList.hidden = !show;
    if (!show) return aiList.replaceChildren();
    const want = defKind(), groups = [];
    for (const s of subs()) { let g = groups.find(x => x.kind === s.kind); if (!g) groups.push(g = { kind: s.kind, name: s.group, rows: [] }); g.rows.push(s); }
    groups.sort((a, b) => (b.kind === want) - (a.kind === want));
    const btn = (text, app, cls = '') => app ? h('button', { type: 'button', cls: 'mh-ai-btn ' + cls, data: { resSignin: app } }, text) : null;
    aiList.replaceChildren(...groups.map(g => h('div', { cls: nw('mh-ai-group') },
      h('div', { cls: 'mh-ai-head' }, h('b', { text: g.name }), g.kind === want ? h('span', { cls: 'mh-ai-def', text: 'Default' }) : null),
      g.rows.map(r => {
        const reset = r.resets && Date.parse(r.resets) > Date.now() ? ` · resets in ${agoS((Date.parse(r.resets) - Date.now()) / 1000)}` : '';
        return h('div', { cls: 'mh-ai-row', data: { s: r.out ? 'out' : level(r.left ?? 0) } },
          h('input', { cls: 'mh-nick', type: 'text', value: r.nick || r.auto, placeholder: 'Nickname', maxlength: '24',
            'aria-label': `Nickname for ${g.name}${r.email ? ' ' + r.email : ''}`, data: { nick: r.id, auto: r.auto } }),
          h('span', { cls: 'mh-ai-use' }, h('span', { cls: 'mh-meter' }, h('i', { style: { '--f': (r.out ? 0 : r.left ?? 0) + '%' } })),
            h('span', { cls: 'mh-ai-txt', text: r.out ? 'Signed out' : r.money ? `${r.money} credit left` : `${r.left}% left${reset}` })),
          h('span', { cls: 'mh-ai-acts' },
            TOP_UP[r.kind] && !r.out ? h('a', { cls: 'mh-ai-btn is-link', href: TOP_UP[r.kind], target: '_blank', rel: 'noopener noreferrer' }, 'Add credit ↗') : null,
            r.out ? btn('Sign in', appOf(r.kind), 'is-in') : btn('Sign out', appOf(r.kind), 'is-out')));
      }))),
      h('div', { cls: 'mh-ai-foot' },
        h('button', { type: 'button', cls: 'mh-ai-btn is-add', data: { toggle: 'signin' }, 'aria-expanded': String(S.open.has('signin')) }, '+ Sign in to another account'),
        S.open.has('signin') ? h('div', { cls: 'mh-ai-pick' }, signable().map(p => btn(p.name, p.app))) : null));
  }

  /* ---------- the map ---------- */
  // Bars are always there for online machines and fold open or shut with one class (smooth, no rebuild).
  function bars(m, maxOf) {
    if (m.status !== 'online') return null;
    const bar = (k, cap, used, text) => cap ? h('span', { cls: 'mh-bar', title: `${k}: ${text}` },
      h('i', { style: { '--w': (100 * clamp(cap / maxOf[k], .3, 1)).toFixed(0) + '%', '--f': (100 * clamp(used / cap, 0, 1)).toFixed(0) + '%' } }), h('small', { text: k === 'CPU' ? `${cap} cores` : gbFmt(cap) })) : h('span', { cls: 'mh-bar is-none' });
    return h('span', { cls: 'mh-bars' }, h('span', { cls: 'mh-bars-in' },
      bar('Memory', m.ramGB, m.ramGB * (m.mem || 0) / 100, `${Math.round(m.mem || 0)}% of ${gbFmt(m.ramGB)} used`),
      bar('Disk', m.diskGB, m.diskUsed || 0, `${gbFmt(m.diskUsed)} of ${gbFmt(m.diskGB)} used`),
      bar('CPU', m.cores, m.cores * (m.cpu || 0) / 100, `${Math.round(m.cpu || 0)}% of ${m.cores} cores busy`)));
  }
  const chev = (open, extra = {}) => h('span', { cls: 'mh-chev-btn', 'aria-hidden': 'true', ...extra }, h('i', { cls: 'mh-chev' + (open ? ' is-up' : '') }));
  const label = (name, role, cls = '') => h('span', { cls: 'mh-label ' + cls }, h('span', { cls: 'mh-name', text: name }), role ? h('span', { cls: 'mh-role', text: role }) : null);
  function machineNode(m, role, maxOf, extra = {}) {
    const s = extra.size || sizeOf(m), off = m.status && m.status !== 'online' && role !== 'main';
    const disc = h('span', { cls: 'mh-disc' + (off ? ' is-off' : '') });
    let tap;
    if (role === 'main' && extra.sessions) {
      // One tap for both: a working bubble (pulses while something runs) and a ready bubble, no words.
      // A dot per chat: amber ones pulse while they work, green ones are ready; a bell with the unread count. No numbers.
      const x = extra.sessions, cap = 12, dots = (n, cls) => Array.from({ length: Math.min(n, cap) }, () => h('i', { cls }));
      disc.append(h('span', { cls: 'mh-sess', 'aria-hidden': 'true' },
        h('span', { cls: 'mh-dots' }, dots(x.working, 'work'), dots(Math.min(x.ready, cap - Math.min(x.working, cap)), 'ready')),
        S.unread ? h('span', { cls: 'mh-bell' }, bell(), h('b', { text: String(Math.min(S.unread, 99)) })) : null));
      tap = h('button', { type: 'button', cls: 'mh-tap', data: { open: 'ready' }, 'aria-label': `${m.name}: ${x.working} working, ${x.ready} ready${S.unread ? `, ${S.unread} unread` : ''}. Open your chats` }, disc);
    } else if (role !== 'main' && !extra.managed) {
      tap = h('button', { type: 'button', cls: 'mh-tap', data: { machine: m.id }, 'aria-expanded': String(S.open.has('m:' + m.id)), 'aria-label': `${m.name}, ${extra.roleText}. Show what it can do` }, disc);
    }
    return h('div', { cls: nw(`mh-node is-${role}`) + (S.open.has('m:' + m.id) ? ' is-open' : ''), data: { id: m.id, role }, style: { '--s': String(s) } },
      h('span', { cls: 'mh-hold' }, tap || disc), label(m.name, extra.roleText, extra.warn ? 'warn' : ''),
      maxOf ? bars(m, maxOf) : null);
  }
  function actPanel(m) {
    return h('div', { cls: nw('mh-act'), data: { of: m.id } },
      h('span', { cls: 'mh-act-head' }, h('b', { text: m.name }), h('span', { text: m.status === 'online' ? (qualifies(m.id) ? 'Standby device' : 'Helper') : offText(m) })),
      h('span', { cls: 'mh-act-btns' }, actions(m).map(a => h('button', { type: 'button', cls: 'mh-act-btn' + (a.ok ? '' : ' is-no'), disabled: !a.ok, data: { ask: `${m.id}:${a.id}` } },
        h('b', { text: a.label }), h('small', { text: a.note })))),
      ...actions(m).filter(a => !a.ok && a.no?.length).map(a => h('span', { cls: 'mh-act-why' },
        h('b', { text: a.id === 'standby' ? 'Can’t be a standby:' : 'Can’t be storage:' }), a.no.map(t => h('span', { text: t })))));
  }
  function storageNode(st) {
    const open = S.open.has('storage');
    return h('div', { cls: nw('mh-node is-storage'), data: { id: 'storage', role: 'storage', fit: st.state }, style: { '--s': '50' } },
      h('button', { type: 'button', cls: 'mh-tap', data: { toggle: 'storage' }, 'aria-expanded': String(open), 'aria-label': `Storage, ${st.used == null ? 'size unknown' : gbFmt(st.used) + ' stored'}. Show where` },
        h('span', { cls: 'mh-hold' }, h('span', { cls: 'mh-disc' })), label('Storage', st.used == null ? st.where : gbFmt(st.used) + ' stored'), chev(open)),
      open ? h('span', { cls: 'mh-more-info' },
        h('span', { text: st.where + (st.bucket ? ` · bucket “${st.bucket}”` : '') }),
        h('span', { text: `Backs up ${st.every}${st.snaps ? ` · ${st.snaps} backups so far` : ''}${st.used != null && st.snaps ? `, ${gbFmt(st.used)} in all` : ''}` }),
        st.keep ? h('span', { text: st.keep }) : null,
        h('span', { cls: 'mh-act-btns' },
          [['now', 'Back up now', '~20 min, apps pause briefly', 'Run a backup of this Wizard now.'], ['schedule', 'Change schedule', 'how often it runs', 'I want to change how often my Wizard backs up to '],
            ['more', 'Add storage', 'a second encrypted copy', 'Add another place to keep encrypted copies of my backups: ']]
            .map(([id, text, note, words]) => h('button', { type: 'button', cls: 'mh-act-btn', data: { stAsk: id, words } }, h('b', { text }), h('small', { text: note }))))) : null);
  }
  const devOpen = p => p.devices ? S.open.has('devs') : S.open.has('p:' + p.id);
  function personNode(p) {
    const open = devOpen(p), n = p.devices ? p.devices.length : null;
    return h('button', { type: 'button', cls: nw('mh-person'), data: { person: p.id }, 'aria-expanded': String(open), 'aria-label': `${p.name}${n != null ? `, ${n} devices` : ''}` },
      h('span', { cls: 'mh-pdisc', text: p.count ? '+' + p.count : initial(p.name) }),
      label(p.name, n ? `${n} device${n === 1 ? '' : 's'}` : ''));
  }
  // Main in the middle; helpers alternate right, left, right… (the most powerful nearest to Main), so the row stays balanced.
  const around = (main, others) => { const L = [], R = []; others.forEach((m, i) => (i % 2 ? L : R).push(m)); return [...L.reverse(), main, ...R]; };
  const plus = (act, label) => { const b = h('button', { type: 'button', cls: 'mh-plus', data: { act }, 'aria-label': label });
    const s = sv('svg', { class: 'mh-i', viewBox: '0 0 24 24', 'aria-hidden': 'true' }, b); for (const [t, a] of PLUS) sv(t, a, s); return b; };
  function renderMap() {
    if (!S.res.devices && S.ws === 'mine') { root.classList.add('is-loading'); setRow(rowSt, []); setRow(rowAct, []); setRow(rowMore, []); setRow(rowPp, []); setRow(rowDv, []); setRow(rowChev, []);
      setRow(rowMn, [h('span', { cls: 'mh-wait', role: 'status', 'aria-label': 'Loading your network' })]); return; }
    root.classList.remove('is-loading');
    if (S.ws !== 'mine' && !managedOf(S.ws) && S.res.devices) S.ws = 'mine';
    const g = managedOf(S.ws);
    root.classList.toggle('is-managed', !!g);
    if (g) {
      // Only what is known about a Wizard he manages: its Main and who uses it. Same design, less data.
      setRow(rowSt, []); setRow(rowMore, []); setRow(rowAct, []);
      setRow(rowMn, [machineNode({ id: 'managed-' + g.id, name: g.name }, 'main', null, { size: 72, roleText: g.org || 'Main', managed: true }), plus('add-device', `Add a device to ${g.name}`)]);
    } else {
      const st = storage();
      setRow(rowSt, st ? [storageNode(st)] : []);
      const main = machine(MAIN), others = devices().filter(d => d.id !== MAIN).map(d => machine(d.id)).sort((a, b) => power(b) - power(a));
      const all = [main, ...others].filter(m => m.status === 'online');
      const maxOf = { Memory: Math.max(1, ...all.map(m => m.ramGB || 0)), Disk: Math.max(1, ...all.map(m => m.diskGB || 0)), CPU: Math.max(1, ...all.map(m => m.cores || 0)) };
      const node = m => m.id === MAIN ? machineNode(main, 'main', maxOf, { roleText: 'Main', sessions: sessions() })
        : machineNode(m, qualifies(m.id) ? 'standby' : 'helper', maxOf, { roleText: qualifies(m.id) ? 'Standby device' : m.status === 'online' ? 'Helper' : offText(m), warn: m.status !== 'online' });
      // The bar names sit left of the row; an invisible twin on the right keeps Main exactly in the middle.
      const legend = twin => h('div', { cls: 'mh-legend' + (twin ? ' is-twin' : ''), 'aria-hidden': 'true' }, h('span', { cls: 'mh-bars-in' }, h('span', { text: 'RAM' }), h('span', { text: 'Disk' }), h('span', { text: 'CPU' })));
      setRow(rowMn, [legend(false), ...around(main, others).map(node), legend(true), plus('add-device', 'Add a device to this network')]);
      const open = others.find(m => S.open.has('m:' + m.id));
      setRow(rowAct, open ? [actPanel(open)] : []);
      setRow(rowMore, all.length ? [h('button', { type: 'button', cls: 'mh-details', data: { toggle: 'bars' }, 'aria-expanded': String(S.bars), 'aria-label': 'Show or hide machine details' },
        h('i', { cls: 'mh-chev' + (S.bars ? ' is-up' : ''), 'aria-hidden': 'true' }))] : []);
    }
    const ps = people();
    setRow(rowPp, [...ps.map(personNode), plus('add-person', 'Give someone access')]);
    const devs = ps.filter(devOpen).flatMap(p => p.devices ? p.devices.map(d => h('span', { cls: nw('mh-dev'), data: { of: p.id } },
      h('i', { cls: 'mh-dot' + (d.online ? '' : ' off') }), d.name)) : [h('span', { cls: nw('mh-dev is-none'), data: { of: p.id }, text: `${p.name}’s devices aren’t visible yet` })]);
    setRow(rowDv, devs);
    // The same chevron as everywhere else, so it is plain the devices fold away.
    const hasDevs = ps.some(p => p.devices && p.devices.length);
    setRow(rowChev, hasDevs ? [h('button', { type: 'button', cls: 'mh-details is-bare', data: { toggle: 'devs' }, 'aria-expanded': String(S.open.has('devs')), 'aria-label': 'Show or hide devices' },
      h('i', { cls: 'mh-chev' + (S.open.has('devs') ? ' is-up' : ''), 'aria-hidden': 'true' }))] : []);
    api.frame(drawLines);
  }
  function setRow(r, items) { r.replaceChildren(...items); r.hidden = !items.length; }

  /* ---------- wires: drawn from the real positions, a light running along each; untouched while nothing moved ---------- */
  let wired = '';
  function drawLines() {
    if (!root.isConnected || typeof map.getBoundingClientRect !== 'function') return;
    const M = map.getBoundingClientRect(); if (!M.width) return;
    const box = el => { const r = el.getBoundingClientRect(); return { l: r.left - M.left, r: r.right - M.left, t: r.top - M.top, b: r.bottom - M.top, cx: (r.left + r.right) / 2 - M.left, cy: (r.top + r.bottom) / 2 - M.top }; };
    const discOf = n => { let x = n?.firstElementChild; while (x && !x.classList.contains('mh-disc') && !x.classList.contains('mh-pdisc')) x = x.firstElementChild; return x || n; };
    const f = v => v.toFixed(1);
    const curveV = (x1, y1, x2, y2) => { const k = (y2 - y1) * .5; return `M${f(x1)} ${f(y1)} C${f(x1)} ${f(y1 + k)} ${f(x2)} ${f(y2 - k)} ${f(x2)} ${f(y2)}`; };
    const mainEl = [...rowMn.children].find(n => n.dataset?.role === 'main'); if (!mainEl) return;
    const md = box(discOf(mainEl)), mb = box(mainEl), specs = [];  // mb: Main with its label (and bars, when shown)
    // Main → storage, above. Fast while a backup uploads; otherwise it carries the last good copy's age.
    const stEl = rowSt.firstElementChild;
    if (stEl) {
      const sd = box(stEl), st = storage();  // from the bottom of its label (and its details, when open)
      const col = st?.state === 'ok' ? 'var(--mh-accent)' : st?.state === 'no' ? 'var(--mh-bad)' : 'var(--mh-warn)';
      specs.push([curveV(md.cx, md.t - 4, sd.cx, sd.b + 4), col, backupRunning() ? 'backing up now' : st?.age == null ? 'no backup yet' : 'backed up ' + agoS(st.age) + ' ago', backupRunning() ? 3 : 1]);
    }
    // Machines: a chain outward from Main on each side, in row order.
    const ms = [...rowMn.children].filter(n => n.dataset?.role);
    for (let i = 1; i < ms.length; i++) {
      const a = box(discOf(ms[i - 1])), b = box(discOf(ms[i])), off = discOf(ms[i - 1]).classList.contains('is-off') || discOf(ms[i]).classList.contains('is-off');
      if (b.l - 3 > a.r + 3) specs.push([`M${f(a.r + 3)} ${f(a.cy)} L${f(b.l - 3)} ${f(b.cy)}`, off ? 'var(--mh-wire-off)' : 'var(--mh-accent)', '', 1]);
    }
    // People → the bottom of Main, from below (faster while sessions work; it runs behind Show details); devices → their person.
    const busy = S.ws === 'mine' && sessions().working > 0;
    for (const p of rowPp.children) { if (!p.dataset.person) continue; const pd = box(discOf(p)); specs.push([curveV(pd.cx, pd.t - 4, md.cx, mb.b + 2), 'var(--mh-accent)', '', busy ? 2 : 1]); }
    for (const d of rowDv.children) {
      const p = [...rowPp.children].find(x => x.dataset.person === d.dataset.of); if (!p) continue;
      const pb = box(p), db = box(d);
      specs.push([curveV(db.cx, db.t - 2, pb.cx, pb.b + 2), 'var(--mh-wire-off)', '', 1]);
    }
    map.style.setProperty('--cx', md.cx + 'px'); map.style.setProperty('--cy', md.cy + 'px');
    // The helper's panel sits right under the helper it belongs to (kept inside the map).
    const ap = rowAct.firstElementChild;
    if (ap) { const n = ms.find(x => x.dataset.id === ap.dataset.of); if (n) { ap.style.transform = ''; const nb = box(n), pb = box(ap), dx = clamp(nb.cx - pb.cx, -pb.l + 4, M.width - pb.r - 4); ap.style.transform = `translateX(${dx.toFixed(0)}px)`; const ab = box(ap); specs.push([curveV(ab.cx, ab.t - 2, nb.cx, nb.b + 2), 'var(--mh-wire-off)', '', 1]); } }
    const key = JSON.stringify(specs); if (key === wired && lines.firstChild) return; wired = key;
    lines.replaceChildren();
    const defs = sv('defs', {}, lines); let gi = 0;
    for (const [d, col, text, speed] of specs) {
      const base = sv('path', { d, class: 'base' }, lines); base.style.stroke = col;
      const L = base.getTotalLength(); if (!L) continue;
      const i = gi++, a = base.getPointAtLength(0), z = base.getPointAtLength(L);
      const g = sv('linearGradient', { id: 'mhg' + i, gradientUnits: 'userSpaceOnUse', x1: a.x, y1: a.y, x2: z.x, y2: z.y }, defs);
      const s1 = sv('stop', { offset: '0' }, g), s2 = sv('stop', { offset: '1' }, g);
      s1.style.stopColor = col; s1.style.stopOpacity = '.15'; s2.style.stopColor = col; s2.style.stopOpacity = '1';
      const seg = Math.min(46, L * .4), c = sv('path', { d, class: 'comet', stroke: `url(#mhg${i})`, 'stroke-dasharray': `${f(seg)} ${f(L + seg)}` }, lines);
      c.style.setProperty('--from', f(seg)); c.style.setProperty('--to', f(-L)); c.style.setProperty('--dur', ((1.6 + L / 120) / speed).toFixed(2) + 's');
      if (text) {
        const pt = base.getPointAtLength(L * .5), grp = sv('g', {}, lines), txt = sv('text', { x: pt.x, y: pt.y + 4, 'text-anchor': 'middle', class: 'mh-age' }, grp);
        txt.textContent = text; const bb = txt.getBBox();
        grp.insertBefore(sv('rect', { x: bb.x - 7, y: bb.y - 4, width: bb.width + 14, height: bb.height + 8, rx: (bb.height + 8) / 2, class: 'mh-age-bg' }), txt);
      }
    }
  }

  /* ---------- taps: everything expands in place ---------- */
  const flip = k => { if (S.open.has(k)) S.open.delete(k); else S.open.add(k); };
  api.listen(root, 'click', e => {
    let b = e.target; while (b && b !== root && !(b.dataset && (b.dataset.ws || b.dataset.act || b.dataset.open || b.dataset.person || b.dataset.toggle || b.dataset.machine || b.dataset.ask || b.dataset.stAsk))) b = b.parentNode;
    if (!b || b === root) return;  // Sign in / Sign out carry the shell's own data-res-signin, which opens that app
    const d = b.dataset;
    if (d.open) return api.data.read.sessions?.open(d.open);
    if (d.ws) { if (S.ws === d.ws) return; S.ws = d.ws; api.storage.set('ws', d.ws); fresh = true; paint(true); return; }
    if (d.act) {
      const g = managedOf(S.ws), where = g ? `${g.name}'s Wizard` : 'my network';
      const ask = { 'add-managed': ['Add a Wizard I manage', 'Add a Wizard I manage to my map: '], 'add-device': ['Add a device', `Add a device to ${where} as a helper: `],
        'add-person': ['Give someone access', `Give someone access to ${where}: `] }[d.act];
      if (ask && !api.nav?.ask?.(d.act + (g ? '-' + g.id : ''), { title: ask[0], message: where }, ask[1])) api.toast('Open Chats, then try again');
      return;
    }
    if (d.person) { const p = people().find(x => x.id === d.person); if (p?.devices) { flip('devs'); api.storage.set('devs', S.open.has('devs') ? 'on' : 'off'); } else flip('p:' + d.person); paint(); return; }
    if (d.toggle === 'devs') { flip('devs'); api.storage.set('devs', S.open.has('devs') ? 'on' : 'off'); paint(); return; }
    if (d.stAsk) { const st = storage(); if (!api.nav?.ask?.('storage-' + d.stAsk, { title: 'Storage', message: st ? [st.where + ' · ' + st.bucket, st.every, st.keep].join('\n') : '' }, d.words)) api.toast('Open Chats, then try again'); return; }
    if (d.machine) { const k = 'm:' + d.machine, was = S.open.has(k); for (const x of [...S.open]) if (x.startsWith('m:')) S.open.delete(x); if (!was) S.open.add(k); fresh = !was; paint(); return; }
    if (d.ask) {
      const [id, what] = d.ask.split(':'), m = machine(id), a = actions(m).find(x => x.id === what);
      if (!a || !a.ok || !a.words) return;
      const sent = api.nav?.ask?.(`${id}-${what}`, { title: `${m.name} · ${a.label}`, message: a.why || a.note }, a.words);
      if (!sent) api.toast('Open Chats, then try again');  // the request waits as a draft for him to send
      return;
    }
    if (d.toggle === 'ai') { flip('ai'); paint(); return; }
    if (d.toggle === 'signin') { flip('signin'); renderAIList(); drawn.list = ''; return; }
    if (d.toggle === 'storage') { flip('storage'); paint(); return; }
    if (d.toggle === 'bars') {
      // Fold the bars open or shut with one class: the CSS eases the height, nothing is rebuilt.
      S.bars = !S.bars; api.storage.set('details', S.bars ? 'on' : 'off');
      map.classList.toggle('is-details', S.bars); b.setAttribute('aria-expanded', String(S.bars));
      b.firstElementChild?.classList.toggle('is-up', S.bars);
    }
  });
  api.listen(root, 'input', e => {
    const id = e.target?.dataset?.nick; if (!id) return;
    const v = String(e.target.value || '').trim().slice(0, 24);
    if (v && v !== e.target.dataset.auto) S.nick[id] = v; else delete S.nick[id];
    api.storage.set('nick', S.nick);
  });

  /* ---------- data ---------- */
  // Repaint only the part whose drawing changed; a nickname being typed is never rebuilt under the finger.
  const drawn = { top: '', ai: '', list: '', map: '' };
  const mapSig = () => { const st = storage();
    return JSON.stringify([S.ws, [...S.open].filter(k => k !== 'ai' && k !== 'signin'), reg().this || null, managedList(),
      devices().map(d => [d.id, d.name, d.status, d.error, d.cpus, d.memoryTotalGB, diskGB(d), Math.round((d.memory || 0) / 5), Math.round((d.cpu || 0) / 5), Math.round((freeGB(d) || 0) / 5)]),
      myDevices(), sessions(), S.unread, backupRunning(), st && { ...st, age: st.age == null ? null : agoS(st.age), used: st.used == null ? null : gbFmt(st.used) },
      (S.backup?.standby?.machines || []).map(x => [x.id, x.verdict, (x.checks || []).map(c => c.ok)])]); };
  function paint(force) {
    const top = JSON.stringify([thisName(), managedList().map(g => [g.id, g.name]), S.ws]);
    if (force || top !== drawn.top) { drawn.top = top; renderTabs(); }
    const gs = JSON.stringify([S.ws, gauge(), S.open.has('ai')]);
    if (force || gs !== drawn.ai) { drawn.ai = gs; renderAI(); }
    const ls = JSON.stringify([S.ws, S.open.has('ai'), S.open.has('signin'), subs().map(s => [s.id, s.left, s.money, s.out, s.resets && agoS((Date.parse(s.resets) - Date.now()) / 1000)])]);
    if ((force || ls !== drawn.list) && !aiList.contains?.(document.activeElement)) { drawn.list = ls; renderAIList(); }
    const ms = mapSig();
    if (force || ms !== drawn.map || !rowMn.firstChild) { drawn.map = ms; renderMap(); }
    api.frame(drawLines);
    fresh = false;
  }
  // The last good readings, kept on this device so the next visit paints once, complete, with nothing popping in.
  const keep = () => { if (S.res.devices) api.storage.set('res', { devices: S.res.devices, ai: S.res.ai || null }); };
  async function readBackup(force) {
    const now = Date.now(); if (!force && now - S.backupTried < 60000) return; S.backupTried = now;
    const j = await api.data.read.app('backup', 'overview');
    if (j && j.backup && typeof j.backup === 'object') {  // otherwise keep the last good answer
      S.backup = { backup: j.backup, standby: j.standby || null, connector: j.connector || null, active: j.active || null };
      api.storage.set('backup', S.backup);
    }
    paint();
  }
  const merge = state => { const got = Object.fromEntries(Object.entries(state || {}).filter(([, v]) => v != null)); S.res = { ...S.res, ...got }; return got; };
  api.inbox?.watch?.(items => { const n = (items || []).filter(i => !i.read && !i.archived).length; if (n !== S.unread) { S.unread = n; paint(); } });
  api.data.read.resources.watch(state => { const got = merge(state); if (got.devices || got.ai) keep(); paint(); readBackup(); });

  /* ---------- mount at Home; keep it there across Home repaints ---------- */
  const mount = () => { if (api.slot.mount('home-main', root)) { api.data.read.resources.refresh(); api.frame(drawLines); } };
  api.on('home', () => { mount(); paint(); });
  api.on('route', () => { mount(); readBackup(); });
  let ro = null;
  if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(() => api.frame(drawLines)); ro.observe(map); ro.observe(rowMn); }
  S.res = api.storage.get('res') || {}; merge(api.data.read.resources.snapshot());
  paint(true); mount(); readBackup(true);
  return () => { ro?.disconnect(); };
}
