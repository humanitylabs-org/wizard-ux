/* Wizard App Manager views, merged natively into Wizard UX: My Apps (the launcher), App Store (same sheet), Resources
 * (a Settings group). Ported from Oscar's humanitylabs-org/wizard-app-manager wizard-views/wizard-apps.js (10 Oct 2026,
 * 379a805…109c6bd, for Miguel); the shells call these render functions directly instead of loading overlay.js.
 * Changes from the prototype are marked "WUX:".
 */
(() => {
'use strict';
// Wizard App Manager views for Wizard UX: My Apps, App Store, Resources. Vanilla ES module, no build step.
// Markup reuses Wizard UX classes (.lgroup .lgrid .lapp .lrow .st-group .st-row); pieces it adds are .wam-*.
//
//   renderMyApps(el, ctx)    installed apps as tiles: Agents / Apps / System, interface paired with what it uses
//   renderStore(el, ctx)     the App Index in the same style; chip row (tags + sort) goes into ctx.chipsEl
//   renderResources(el, ctx) a Settings group: Storage, Processor, Memory, Start/Stop/Restart all
//   renderCard(el, app, ctx) one app: summary, status, only the buttons that apply
//
// ctx (all optional): api ('/api', Runtipi), wizard ('/wizard/v1'), index ('/wizard/v1/index', or
// 'https://apps.aiwizards.com/v1'), chipsEl, extraTiles (html strings shown first under Apps), shell (true: Open
// buttons carry data-app and bubble to the shell's own launcher), onApp(app, from), onGetApps(), onBack().

const STORE = 'wizardapps';
const BUSY = new Set(['installing', 'updating', 'starting', 'stopping', 'restarting', 'uninstalling', 'resetting']);
const PALETTE = [
  ['#6b46ff', '#c04dff'],
  ['#3fe0ff', '#3f6bff'],
  ['#ff5ccf', '#5c3bff'],
  ['#4ff0b0', '#2f8cff'],
  ['#ffbe55', '#ff6b86'],
  ['#ff8a5c', '#ff5ccf'],
];
const GROUPS = ['Agents', 'Apps', 'System'];
const STATUS = { running: 'Running', stopped: 'Stopped', missing: 'Not running' };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const conf = (ctx = {}) => ({ api: '/api', wizard: '/wizard/v1', index: '/wizard/v1/index', ...ctx });
const hue = (id) => {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
};
const noop = () => undefined;
// WUX: a staging preview (and any qa-origin) refuses writes. Install/Start/Stop then show a calm read-only state
// instead of an error: the preview is for judging the screens; the box does the real lifecycle.
const READ_ONLY_NOTE = 'Preview: read-only. Install, Start and Stop run on your box, not in this preview.';
const isReadOnly = () => !!window.__wamReadOnly || /\.staging\.wizard001\.com$/.test(location.hostname);
class ReadOnly extends Error {}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(url, opts = {}) {
  const r = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...opts });
  const text = await r.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { message: text.slice(0, 120) };
  }
  if (r.status === 403 && /refuses writes|read.only/i.test(body.error || body.message || '')) throw new ReadOnly(READ_ONLY_NOTE); // WUX
  if (!r.ok) throw Object.assign(new Error(body.message || body.error || `HTTP ${r.status}`), { code: body.error || '', status: r.status });
  return body;
}
// Same-origin owner session: CSRF is session-bound; the privileged manager bearer stays on the Service.
// One session request at a time, renewed a minute before it lapses and after a Service restart.
let ownerSession = null;
let ownerSessionLoad = null;
function session(force = false) {
  if (!force && ownerSession && Date.now() < ownerSession.until) return Promise.resolve(ownerSession);
  if (!ownerSessionLoad) {
    ownerSessionLoad = req('/wizard/v1/app-lifecycle/session')
      .then((s) => (ownerSession = { csrf: s.csrf, until: Date.now() + Math.max(0, Number(s.expires_in || 0) - 60) * 1000 }))
      .finally(() => { ownerSessionLoad = null; });
  }
  return ownerSessionLoad;
}
/** A lifecycle write. The key names the operation, so a retry (or a lost response) never runs it twice. */
async function post(url, data, method, key) {
  const send = (s) => req(url, { method, headers: { 'Content-Type': 'application/json', 'X-Wizard-CSRF': s.csrf, 'Idempotency-Key': key }, body: JSON.stringify(data || {}) });
  try {
    return await send(await session());
  } catch (e) {
    if (e.code !== 'owner_session_required') throw e;
    return send(await session(true)); // expired or restarted Service: same key, once
  }
}
// Operation keys outlive the card: Back and reopen keep an uncertain operation's identity until it settles.
const operations = new Map();
const opKey = (id, k) => {
  if (!operations.has(`${id}:${k}`)) operations.set(`${id}:${k}`, crypto.randomUUID().replace(/-/g, ''));
  return operations.get(`${id}:${k}`);
};
const uncertain = (e) => !e.status || e.status >= 500 || e.code === 'operation_unconfirmed' || e.code === 'app_manager_unavailable';
/** Launcher + agent pick up the change; a failed read here never turns a done operation into an error. */
async function refreshLauncher() {
  try {
    if (window.WizCore?.apps?.refresh) await window.WizCore.apps.refresh();
    window.dispatchEvent(new CustomEvent('wizard:apps-changed'));
  } catch { /* the launcher's own focus refresh catches up */ }
}

// ---- data --------------------------------------------------------------------------------------------------------
const cache = { apps: null, at: 0, index: null, indexAt: 0 };

async function indexMeta(c) {
  if (cache.index && Date.now() - cache.indexAt < 300e3) return cache.index;
  const d = await req(`${c.index}/search?limit=100&sort=name`);
  cache.index = new Map((d.apps || []).map((a) => [a.id, a]));
  cache.indexAt = Date.now();
  return cache.index;
}

function model(x, meta, idx, c) {
  const info = x.info || {};
  const m = meta.get(info.id) || {};
  const i = idx.get(info.id) || {};
  const cats = info.categories || [];
  const type = m.type || i.type || (cats.includes('agent') ? 'agent' : info.no_gui ? 'service' : 'view');
  const latest = Number(x.metadata?.latestVersion || 0);
  const version = Number(x.app?.version || 0);
  return {
    id: info.id,
    urn: info.urn || `${info.id}:${STORE}`,
    name: m.name || info.name || info.id,
    summary: m.summary || i.summary || info.short_desc || '',
    type,
    category: m.category || i.category || cats[0] || 'app',
    uses: m.uses || i.uses || [],
    status: x.app?.status || 'missing',
    update: latest > version && latest !== Number(x.app?.ignoredVersion || 0),
    screen: type !== 'service' && !info.no_gui && m.view !== null,
    open: m.view?.open || '',
    logo: `${c.api}/marketplace/apps/${encodeURIComponent(info.urn || `${info.id}:${STORE}`)}/image`,
    installed: true,
  };
}

/** Installed apps merged with Wizard metadata (apps.json via the front) and the index. Cached 10 s. */
async function loadInstalled(ctx, fresh = false) {
  const c = conf(ctx);
  if (!fresh && cache.apps && Date.now() - cache.at < 10e3) return cache.apps;
  const [inst, meta, idx] = await Promise.all([
    req(`${c.api}/apps/installed`),
    req(`${c.wizard}/wizard-apps`).catch(() => ({ apps: [] })),
    indexMeta(c).catch(() => new Map()),
  ]);
  const m = new Map((meta.apps || []).map((a) => [a.id, a]));
  // WUX: one tile per app id. A box that once had an older store keeps a second copy (e.g. defleur-video:wizard,
  // stopped, beside defleur-video:wizardapps): show the wizardapps one, else the running one.
  const rank = (x) => (String(x.info?.urn || '').endsWith(`:${STORE}`) ? 2 : 0) + (x.app?.status === 'running' ? 1 : 0);
  const best = new Map();
  for (const x of inst.installed || []) if (x.info?.id && (!best.has(x.info.id) || rank(x) > rank(best.get(x.info.id)))) best.set(x.info.id, x);
  cache.apps = [...best.values()].map((x) => model(x, m, idx, c));
  cache.at = Date.now();
  return cache.apps;
}

function fromIndex(a, c) {
  return {
    id: a.id,
    urn: `${a.id}:${STORE}`,
    name: a.name || a.id,
    summary: a.summary || '',
    type: a.type,
    category: a.category || 'app',
    uses: a.uses || [],
    repo: a.repo,
    installs: Number(a.installs || 0),
    screen: a.type !== 'service',
    logo: `${c.api}/marketplace/apps/${encodeURIComponent(`${a.id}:${STORE}`)}/image`,
    installed: false,
  };
}

// ---- pieces ------------------------------------------------------------------------------------------------------
const groupOf = (a) => (a.type === 'agent' || a.category === 'agent' ? 'Agents' : a.category === 'system' ? 'System' : 'Apps');
const isInterface = (a) => a.category === 'interface' || (a.type === 'view' && a.uses.length > 0);

/** Each agent/app followed by the interfaces that open it: [[app, ui, ...], ...]. */
function units(list) {
  const byId = new Map(list.map((a) => [a.id, a]));
  const pairs = new Map();
  const paired = new Set();
  for (const a of list) {
    if (!isInterface(a)) continue;
    const t = a.uses.find((u) => byId.has(u) && !isInterface(byId.get(u)));
    if (!t) continue;
    if (!pairs.has(t)) pairs.set(t, []);
    pairs.get(t).push(a);
    paired.add(a.id);
  }
  return list.filter((a) => !paired.has(a.id)).map((a) => [a, ...(pairs.get(a.id) || [])]);
}

const count = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));
const glyph = (a) =>
  esc(
    String(a.name || a.id)
      .trim()
      .charAt(0)
      .toUpperCase(),
  );
const icon = (a) => `<img src="${esc(a.logo)}" alt="" loading="lazy" data-glyph="${glyph(a)}">`;
const gstyle = (a) => {
  const [g1, g2] = hue(a.id);
  return `--g1:${g1};--g2:${g2}`;
};

function tile(a) {
  const dot = a.installed ? `<i class="wam-dot ${esc(a.status)}"></i>` : '';
  const up = a.update ? '<i class="wam-up">↑</i>' : '';
  const ok = !a.installed && a.have ? '<i class="wam-ok">✓</i>' : '';
  const n = !a.installed && a.installs > 0 ? `<small class="wam-n">↓ ${count(a.installs)}</small>` : '';
  return `<button class="lapp${a.screen ? '' : ' headless'}" data-wam-id="${esc(a.id)}" title="${esc(a.summary)}"><span class="ic" style="${gstyle(a)}">${icon(a)}${dot}${up}${ok}</span><span class="nm">${esc(a.name)}</span>${n}</button>`;
}

function grid(list, extra = {}) {
  const by = Object.fromEntries(GROUPS.map((g) => [g, []]));
  for (const u of units(list)) by[groupOf(u[0])].push(u);
  return GROUPS.map((g) => {
    const cells = by[g].map((u) => (u.length > 1 ? `<div class="wam-pair n${Math.min(u.length, 4)}">${u.map(tile).join('')}</div>` : tile(u[0])));
    const pre = extra[`pre${g}`] || [];
    const post = extra[`post${g}`] || [];
    if (!cells.length && !pre.length && !post.length) return '';
    // WUX: the count is every tile in the group (the shell's own apps included), not only App Manager apps.
    return `<div class="lgroup"><h4>${g} <span>${by[g].reduce((n, u) => n + u.length, 0) + pre.length || ''}</span></h4><div class="lgrid">${[...pre, ...cells, ...post].join('')}</div></div>`;
  }).join('');
}

function row(a) {
  const tag = a.have ? '<span class="kind wam-have">Installed</span>' : a.installs > 0 ? `<span class="kind">↓ ${count(a.installs)}</span>` : '';
  return `<button class="lrow" data-wam-id="${esc(a.id)}"><span class="ic" style="${gstyle(a)}">${icon(a)}</span><span class="nm">${esc(a.name)}<small>${esc(a.summary)}</small></span>${tag}</button>`;
}

// Broken logos fall back to the tile's gradient glyph (inline onerror is blocked by the shell's CSP).
function bindImages(el) {
  if (el.dataset.wamImg) return;
  el.dataset.wamImg = '1';
  el.addEventListener(
    'error',
    (e) => {
      const img = e.target;
      if (img.tagName === 'IMG' && img.dataset.glyph !== undefined) img.replaceWith(document.createTextNode(img.dataset.glyph));
    },
    true,
  );
}

function bindClicks(el, handler) {
  el._wam = handler;
  if (el.dataset.wamClick) return;
  el.dataset.wamClick = '1';
  el.addEventListener('click', (e) => el._wam?.(e));
}

const note = (t) => `<p class="st-note wam-note">${esc(t)}</p>`;

// ---- My Apps -----------------------------------------------------------------------------------------------------
async function renderMyApps(el, ctx = {}) {
  el._wamOwner = null; // a card's background poll stops painting here
  el.classList.add('wam');
  bindImages(el);
  const getApps = '<button class="lapp" data-wam-get><span class="ic wam-get">+</span><span class="nm">Get apps</span></button>';
  const paint = (apps) => {
    el.innerHTML = grid(apps, { preApps: ctx.extraTiles || [], postApps: [getApps] });
  };
  bindClicks(el, (e) => {
    if (e.target.closest('[data-wam-get]')) {
      e.stopPropagation();
      return ctx.onGetApps ? ctx.onGetApps() : renderStore(el, ctx);
    }
    const t = e.target.closest('[data-wam-id]');
    if (!t) return;
    e.stopPropagation();
    const a = (cache.apps || []).find((x) => x.id === t.dataset.wamId);
    if (a) ctx.onApp ? ctx.onApp(a, 'apps') : renderCard(el, a, { ...ctx, onBack: () => renderMyApps(el, ctx) });
  });
  if (cache.apps) paint(cache.apps);
  try {
    paint(await loadInstalled(ctx));
  } catch {
    if (!cache.apps)
      el.innerHTML = `<div class="lgroup"><h4>Apps</h4><div class="lgrid">${(ctx.extraTiles || []).join('')}${getApps}</div></div>${note('Can’t reach the App Manager')}`;
  }
}

// ---- App card ----------------------------------------------------------------------------------------------------
function renderCard(el, app, ctx = {}) {
  const c = conf(ctx);
  el.classList.add('wam');
  bindImages(el);
  let a = app;
  let busy = '';
  let msg = '';
  let ro = false;
  // This card owns the element until something else renders into it; stale polls stop painting then.
  const owner = Symbol('card');
  el._wamOwner = owner;
  const mine = () => el._wamOwner === owner && el.isConnected;
  const paint = () => {
    const st = a.installed ? STATUS[a.status] || `${a.status.charAt(0).toUpperCase()}${a.status.slice(1)}…` : a.have ? 'Installed' : '';
    const btn = (k, label, cls = '') =>
      `<button class="wam-btn ${cls}" data-wam-do="${k}"${busy ? ' disabled' : ''}>${busy === k ? '…' : label}</button>`;
    const acts = [];
    if (a.installed) {
      if (a.screen && a.open && a.status === 'running')
        acts.push(`<button class="wam-btn primary" data-wam-do="open"${c.shell ? ` data-app="${esc(a.id)}"` : ''}>Open</button>`);
      if (a.update) acts.push(btn('update', 'Update', 'primary'));
      if (a.status === 'running') acts.push(btn('stop', 'Stop'));
      else if (!BUSY.has(a.status)) acts.push(btn('start', 'Start'));
    } else if (!a.have) acts.push(btn('install', busy === '' && msg ? 'Try again' : 'Install', 'primary'));
    el.innerHTML = `<div class="wam-card">
      <button class="wam-back" data-wam-back>‹ ${ctx.from === 'store' ? 'App Store' : 'My apps'}</button>
      <div class="wam-panel">
        <div class="st-row static"><span class="wam-ic" style="${gstyle(a)}">${icon(a)}</span><span class="st-tx"><b>${esc(a.name)}</b><small>${esc(a.summary)}</small></span></div>
        ${st ? `<div class="wam-meta"><i class="wam-dot ${esc(a.installed ? a.status : 'running')}"></i>${esc(st)}${!a.installed && a.installs > 0 ? ` · ${count(a.installs)} installs` : ''}</div>` : ''}
        ${acts.length ? `<div class="wam-acts">${acts.join('')}</div>` : ''}
        ${a.screen ? '' : note('No screen: ask your agent to use it')}
        ${msg ? (ro ? `<p class="st-note wam-note wam-ro">${esc(msg)}</p>` : note(msg)) : ''}
      </div>
    </div>`;
  };
  /** Poll until the app leaves its busy state. 'done' | 'gone' (missing after an install: it failed) | 'pending'. */
  const settle = async (k) => {
    let missing = 0;
    for (let i = 0; i < 90; i++) {
      await sleep(2000);
      let list;
      try { list = await loadInstalled(ctx, true); } catch { continue; }
      const now = list.find((x) => x.id === a.id);
      if (now) { a = now; missing = 0; } else missing++;
      if (mine()) paint();
      if (now && !BUSY.has(now.status)) return 'done';
      if (!now && k === 'install' && missing >= 3) return 'gone';
      if (!now && k === 'uninstall') return 'done';
    }
    return 'pending';
  };
  const show = () => { if (mine()) paint(); };
  const run = async (k) => {
    if (isReadOnly()) { msg = READ_ONLY_NOTE; ro = true; return paint(); } // WUX
    busy = k;
    msg = '';
    paint();
    const key = opKey(a.id, k);
    try {
      if (k === 'install') await install(a, c, key);
      else if (k === 'update') await post(`${c.api}/app-lifecycle/${encodeURIComponent(a.urn)}/update`, { performBackup: true }, 'PATCH', key);
      else if (k === 'uninstall') await post(`${c.api}/app-lifecycle/${encodeURIComponent(a.urn)}/uninstall`, { removeBackups: false }, 'DELETE', key);
      else await post(`${c.api}/app-lifecycle/${encodeURIComponent(a.urn)}/${k}`, {}, 'POST', key);
    } catch (e) {
      busy = '';
      if (e instanceof ReadOnly) { operations.delete(`${a.id}:${k}`); msg = READ_ONLY_NOTE; ro = true; return show(); } // WUX
      // Lost response: the operation may have run. Keep its key so Try again replays it instead of repeating it.
      if (!uncertain(e)) operations.delete(`${a.id}:${k}`);
      msg = uncertain(e) ? `Not sure the ${k} went through. Tap ${k === 'install' ? 'Try again' : 'it'} again to check.`
        : k === 'install' ? `Couldn’t install: ${e.message}. Ask your agent to install ${a.name}.` : `Couldn’t ${k}: ${e.message}`;
      return show();
    }
    operations.delete(`${a.id}:${k}`);
    busy = '';
    cache.apps = null;
    show();
    const end = await settle(k);
    await refreshLauncher();
    if (end === 'gone') {
      a = { ...a, installed: false, have: false, status: 'missing' };
      msg = `${a.name} didn’t install. Try again, or ask your agent to install it.`;
    } else if (end === 'pending') msg = `${a.name} is still ${a.status}. It keeps going in the background.`;
    show();
  };
  bindClicks(el, (e) => {
    if (e.target.closest('[data-wam-back]')) {
      e.stopPropagation();
      return ctx.onBack?.();
    }
    const b = e.target.closest('[data-wam-do]');
    if (!b) return;
    if (b.dataset.wamDo === 'open') {
      if (c.shell) return; // the shell's own launcher opens it (data-app)
      e.stopPropagation();
      return window.open(a.open, '_blank', 'noopener');
    }
    e.stopPropagation();
    run(b.dataset.wamDo);
  });
  paint();
}

/** Runtipi install (uses first, like `wam install`), then count it in the index. */
async function install(a, c, key) {
  const have = new Set((await loadInstalled(c, true)).map((x) => x.id));
  // The bridge takes only the app's own form fields; exposure and host ports are never the browser's to choose.
  const form = {};
  for (const dep of a.uses || []) {
    if (have.has(dep) || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(dep)) continue;
    await post(`${c.api}/app-lifecycle/${encodeURIComponent(`${dep}:${STORE}`)}/install`, form, 'POST', `${key}_${dep}`.slice(0, 128));
  }
  await post(`${c.api}/app-lifecycle/${encodeURIComponent(a.urn)}/install`, form, 'POST', key);
  a.installed = true;
  a.status = 'installing';
  // Installation accounting belongs to the manager; browser writes never reach the public index.
}

// ---- App Store ---------------------------------------------------------------------------------------------------
const SORTS = [
  ['popular', 'Popular'],
  ['new', 'New'],
  ['name', 'A–Z'],
];

function renderStore(el, ctx = {}) {
  const c = conf(ctx);
  el._wamOwner = null;
  el.classList.add('wam');
  bindImages(el);
  let chips = ctx.chipsEl;
  if (!chips) {
    chips = document.createElement('div');
    el.before(chips);
  }
  chips.classList.add('wam', 'wam-chips');
  const s = { q: '', tag: '', sort: 'popular', items: [], next: null, tags: [], seq: 0 };

  const paintChips = () => {
    const chip = (id, label) => `<button class="wam-chip${s.tag === id ? ' on' : ''}" data-wam-tag="${esc(id)}">${esc(label)}</button>`;
    const sorts = SORTS.map(([k, l]) => `<button class="${s.sort === k ? 'on' : ''}" data-wam-sort="${k}">${l}</button>`).join('');
    chips.innerHTML = `<div class="wam-tags">${chip('', 'All')}${s.tags.map((t) => chip(t, t.charAt(0).toUpperCase() + t.slice(1))).join('')}</div><span class="wam-sort">${sorts}</span>`;
  };
  const paint = () => {
    const have = new Set((cache.apps || []).map((a) => a.id));
    for (const a of s.items) a.have = have.has(a.id);
    const more = s.next != null ? '<button class="wam-more" data-wam-more>More</button>' : '';
    const back = ctx.onBack ? '<button class="wam-back" data-wam-back>‹ My apps</button>' : '';
    const list = s.items.length
      ? s.q
        ? `<div class="lgroup">${s.items.map(row).join('')}</div>`
        : grid(s.items)
      : note(s.q ? 'Nothing found' : 'Loading…');
    el.innerHTML = `${back}${list}${more}`;
  };
  const load = async (reset) => {
    const seq = ++s.seq;
    const p = new URLSearchParams({ q: s.q, tag: s.tag, sort: s.sort, limit: '48', offset: reset ? '0' : String(s.next || 0) });
    try {
      const d = await req(`${c.index}/search?${p}`);
      if (seq !== s.seq) return;
      const got = (d.apps || []).map((a) => fromIndex(a, c));
      s.items = reset ? got : [...s.items, ...got];
      s.next = d.next_offset ?? null;
      paint();
      if (!s.items.length) el.innerHTML = note(s.q ? 'Nothing found' : 'No apps here yet');
    } catch {
      if (seq === s.seq) el.innerHTML = note('Can’t reach the App Store');
    }
  };

  chips.onclick = (e) => {
    const t = e.target.closest('[data-wam-tag]');
    const so = e.target.closest('[data-wam-sort]');
    if (t) s.tag = t.dataset.wamTag;
    else if (so) s.sort = so.dataset.wamSort;
    else return;
    e.stopPropagation();
    paintChips();
    load(true);
  };
  bindClicks(el, (e) => {
    if (e.target.closest('[data-wam-back]')) {
      e.stopPropagation();
      return ctx.onBack();
    }
    if (e.target.closest('[data-wam-more]')) {
      e.stopPropagation();
      return load(false);
    }
    const t = e.target.closest('[data-wam-id]');
    if (!t) return;
    e.stopPropagation();
    const a = s.items.find((x) => x.id === t.dataset.wamId);
    const mine = (cache.apps || []).find((x) => x.id === a?.id);
    if (a) ctx.onApp ? ctx.onApp(mine || a, 'store') : renderCard(el, mine || a, { ...ctx, from: 'store', onBack: () => { el._wamOwner = null; paint(); } });
  });

  paintChips();
  paint();
  req(`${c.index}/tags`)
    .then((d) => {
      s.tags = (d.tags || [])
        .slice()
        .sort((x, y) => y.count - x.count)
        .slice(0, 8)
        .map((t) => t.id);
      paintChips();
    })
    .catch(noop);
  loadInstalled(ctx).then(paint).catch(noop);
  load(true);

  let timer = 0;
  return {
    chips,
    setQuery(q) {
      clearTimeout(timer);
      timer = setTimeout(() => {
        s.q = String(q || '').trim();
        load(true);
      }, 180);
    },
    repaint: paint,
  };
}

// ---- Resources ---------------------------------------------------------------------------------------------------
async function renderResources(el, ctx = {}) {
  const c = conf(ctx);
  el.classList.add('wam');
  let armed = '';
  const meter = (pct) => {
    const p = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
    return `<span class="wam-meter${p >= 85 ? ' hot' : ''}"><em>${p}%</em><span class="bar"><i style="width:${p}%"></i></span></span>`;
  };
  const r = (ic, title, sub, pct) =>
    `<div class="st-row static"><span class="st-ic">${ic}</span><span class="st-tx"><b>${title}</b><small>${esc(sub)}</small></span>${meter(pct)}</div>`;
  // WUX: batch Start/Stop/Restart all need an owner-authorized batch route the Service doesn't expose yet.
  const acts = () => (!ctx.batch ? '' :
    `<div class="wam-acts wam-all">${[
      ['start-all', 'Start all'],
      ['stop-all', 'Stop all'],
      ['restart-all', 'Restart all'],
    ]
      .map(([k, l]) => `<button class="wam-btn" data-wam-all="${k}">${armed === k ? 'Tap again' : l}</button>`)
      .join('')}</div>`);
  const paint = (d) => {
    const memUsed = (Number(d.memoryTotal) * Number(d.percentUsedMemory)) / 100;
    el.innerHTML = `<div class="st-group"><h4>Resources</h4>
      ${r('◫', 'Storage', `${d.diskUsed} of ${d.diskSize} GB used`, d.percentUsed)}
      ${r('◔', 'Processor', 'Uninstall apps to reduce load', d.cpuLoad)}
      ${r('▦', 'Memory', `${memUsed.toFixed(memUsed < 10 ? 1 : 0)} of ${d.memoryTotal} GB used`, d.percentUsedMemory)}
      ${acts()}<p class="st-note wam-note" data-wam-msg></p></div>`;
  };
  bindClicks(el, async (e) => {
    const b = e.target.closest('[data-wam-all]');
    if (!b) return;
    e.stopPropagation();
    const k = b.dataset.wamAll;
    if (k === 'stop-all' && armed !== k) {
      armed = k;
      b.textContent = 'Tap again';
      setTimeout(() => {
        armed = '';
        if (b.isConnected) b.textContent = 'Stop all';
      }, 3000);
      return;
    }
    armed = '';
    const m = el.querySelector('[data-wam-msg]');
    if (isReadOnly()) { if (m) { m.textContent = READ_ONLY_NOTE; m.classList.add('wam-ro'); } return; } // WUX
    b.disabled = true;
    b.textContent = '…';
    try {
      await post(`${c.api}/app-lifecycle/${k}`, {}, 'POST', opKey('all', k));
      operations.delete(`all:${k}`);
      if (m) m.textContent = k === 'stop-all' ? 'Stopping every app' : k === 'start-all' ? 'Starting every app' : 'Restarting every app';
    } catch (err) {
      if (m && err instanceof ReadOnly) { m.textContent = READ_ONLY_NOTE; m.classList.add('wam-ro'); } // WUX
      else if (m) m.textContent = `Couldn’t do that: ${err.message}`;
    }
    b.disabled = false;
    b.textContent = { 'start-all': 'Start all', 'stop-all': 'Stop all', 'restart-all': 'Restart all' }[k];
  });
  if (el._wamLoad) paint(el._wamLoad);
  try {
    el._wamLoad = await req(`${c.api}/system/load`);
    paint(el._wamLoad);
  } catch {
    if (!el._wamLoad) el.innerHTML = `<div class="st-group"><h4>Resources</h4>${note('Can’t reach the App Manager')}</div>`;
  }
}

// WUX: one global for both shells (classic scripts, no module loader in the shell).
window.WosApps = { renderMyApps, renderStore, renderResources, renderCard, loadInstalled, isReadOnly, READ_ONLY_NOTE, get cached() { return cache.apps; } };
})();
