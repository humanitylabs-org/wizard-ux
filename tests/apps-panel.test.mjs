// wizard-ux issue 1955: the phone Apps tile's Favorites panel, the nine bubbles and the Recent step-through
// (web/app-appspanel.js, on for everyone) run in node:vm against a fake page. Without the four-section bar (the desktop)
// nothing opens, nothing steps and nothing is saved; on the phone the panel lists Favorites then Recent (four, not Favorites, × each),
// search puts the best match first, the × and Favorites are saved to ui-preferences, opening an app puts it back on
// Recent, the nine fill from recent then favorites (newest first), and a bar swipe steps one app and stops at the ends.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../web/app-appspanel.js', import.meta.url), 'utf8');
const kindsSrc = readFileSync(new URL('../web/core/app-kinds.js', import.meta.url), 'utf8');

function el() {
  const kids = {};
  const e = { listeners: {}, hidden: false, dataset: {}, style: { setProperty() {} }, innerHTML: '', value: '', scrollTop: 0, attrs: {},
    classList: { set: new Set(), add(...c) { c.forEach(x => this.set.add(x)); }, remove(...c) { c.forEach(x => this.set.delete(x)); }, toggle(c, on) { if (on ?? !this.set.has(c)) this.set.add(c); else this.set.delete(c); }, contains(c) { return this.set.has(c); } },
    addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }, setAttribute(k, v) { this.attrs[k] = v; }, append() {}, blur() {},
    querySelector(s) { return (kids[s] ||= el()); }, querySelectorAll: () => [], getBoundingClientRect: () => ({ left: 0, top: 0, right: 400, bottom: 800, width: 400, height: 800 }) };
  return e;
}

function harness({ sections = true, current = 'apps', front = 'notes', recent = ['notes', 'music', 'calendar', 'podcasts', 'maps', 'messenger'], favs = null, hidden = null, extra = [] } = {}) {
  const local = new Map(), store = new Map([['recent', recent]]), puts = [], opened = [], toasts = [];
  if (favs) local.set('wos.apps.favorites.v1', JSON.stringify(favs));
  if (hidden) local.set('wos.apps.recentHidden.v1', JSON.stringify(hidden));
  const ids = ['notes', 'music', 'calendar', 'podcasts', 'maps', 'messenger', 'files', 'books', 'zen-long-name'];
  const APP = Object.fromEntries(ids.map(id => [id, { id, name: id[0].toUpperCase() + id.slice(1), desc: id === 'books' ? 'a calendar of reads' : '', url: `/${id}/`, kind: 'wizard' }]));
  APP.wizard = { id: 'wizard', name: 'Chats', kind: 'chats' }; APP['app-store'] = { id: 'app-store', name: 'App Store', url: '/s/', kind: 'wizard' }; APP.agents = { id: 'agents', name: 'Agents', kind: 'wizard' };
  APP.android = { id: 'android', name: 'Android thing', kind: 'native' };
  for (const a of extra) APP[a.id] = a;
  const root = { getAttribute: () => null }; // no tweak attribute: the panel needs no switch (wizard/apps-panel went)
  const desks = [{ id: 'home', home: true, wins: [] }, { id: 'da', wins: ['w1'], focus: 'w1' }];
  const appVars = { desks, W: { w1: { id: 'w1', app: 'frame', appId: front } }, idx: 1, sheet: null };
  const device = el(), dock = el(), made = [];
  const ctx = {
    window: { WizCore: { appParts: {}, isMaintenanceApp: () => false,
      phoneSections: { on: () => sections, current: () => current, sections: () => ({ apps: 'da' }), slotId: () => 'messenger' } } },
    document: { documentElement: root, createElement: () => { const e = el(); made.push(e); return e; }, elementFromPoint: () => null },
    localStorage: { getItem: k => local.has(k) ? local.get(k) : null, setItem: (k, v) => local.set(k, String(v)) },
    MutationObserver: class { observe() {} }, addEventListener() {}, requestAnimationFrame: f => f(), setTimeout, clearTimeout, Date, Math, JSON, Object, Set, console,
  };
  ctx.window.window = ctx.window; vm.createContext(ctx);
  vm.runInContext(kindsSrc, ctx); vm.runInContext(src, ctx);
  const api = ctx.window.WizCore.appParts.appspanel({
    $: s => s === '#dock' ? dock : null, APP, APPS: Object.values(APP), appVars, CHATS_APP: { id: 'wizard' }, device, esc: s => String(s),
    ico: (t, c, a) => `<${t} class="${c}">${a.id}</${t}>`, LIVE: { putPrefs: p => puts.push(JSON.parse(JSON.stringify(p))) }, norm: s => String(s).toLowerCase(),
    openApp: a => { opened.push(a.id); appVars.W.w1.appId = a.id; }, openStoreKind: k => opened.push('store:' + k), phoneBack: { watch() {} },
    store: { get: (k, d) => store.has(k) ? JSON.parse(JSON.stringify(store.get(k))) : d, set: (k, v) => store.set(k, v) },
    tapOpen: a => { opened.push('tap:' + a.id); store.set('recent', [a.id, ...(store.get('recent') || []).filter(x => x !== a.id)]); ctx.window.WizCore.appsPanelOpened(a.id); }, toast: (i, t) => toasts.push(t), vib() {},
  });
  const A = ctx.window.WizCore.appsPanel, clone = v => JSON.parse(JSON.stringify(v));
  const panel = made.find(e => e.id === 'appsPanel');
  // A tap in the panel: a button carrying these data-* keys.
  const click = data => panel.listeners.click.forEach(f => f({ target: { closest: () => ({ dataset: data }) } }));
  // The panel's rows top to bottom as the part painted them: headers, rows (x: with the Recent ×), the empty line.
  const rows = () => [...panel.querySelector('[data-apbody]').innerHTML.matchAll(/class="ap-ht">([^<]*)|<div class="ap-row[^"]*" data-aprow="([^"]+)">(.*?)<\/div>|class="ap-empty">([^<]*)/gs)]
    .map(m => m[1] ? 'h:' + m[1] : m[2] ? (m[3].includes('data-apx') ? 'x:' : '') + m[2] : 'empty:' + m[4]);
  const q = v => { panel.querySelector('[data-apq]').value = v; panel.querySelector('[data-apq]').listeners.input?.forEach(f => f()); };
  return { api, A: { ...A, favorites: () => clone(A.favorites()), recent: () => clone(A.recent()), nine: () => clone(A.nine()), stepList: () => clone(A.stepList()) },
    click, rows, q, puts, opened, toasts, local, store, appVars, ctx, panel };
}

test('no switch: up on the phone bar for everyone; without the four-section bar nothing opens, steps or is saved', () => {
  assert.equal(harness().api.appsPanelOn(), true, 'no tweak attribute is needed');
  for (const h of [harness({ sections: false })]) {
    assert.equal(h.api.appsPanelOn(), false);
    assert.equal(h.api.appsPanelOpen(), false, 'no panel: app-sections.js opens the Apps sheet');
    assert.equal(h.api.appsStepping(), false, 'the bar swipe stays the section swipe');
    assert.equal(h.api.appsPanelToggled(), false);
    h.ctx.window.WizCore.appsPanelOpened('notes');
    assert.deepEqual(h.puts, []); assert.deepEqual(h.opened, []);
  }
});

test('Favorites then Recent: four recent apps that are not Favorites, newest first; × takes one off on every device', () => {
  const h = harness({ favs: ['calendar', 'gone-app', 'music'] });
  assert.deepEqual(h.A.favorites(), ['calendar', 'music'], 'in the owner\'s order; an app not installed here is skipped');
  assert.deepEqual(h.A.recent(), ['notes', 'podcasts', 'maps', 'messenger']);
  assert.equal(h.api.appsPanelOpen(), true); assert.equal(h.A.isOpen(), true);
  assert.deepEqual(h.rows(), ['h:Favorites', 'calendar', 'music', 'h:Recent', 'x:notes', 'x:podcasts', 'x:maps', 'x:messenger']);
  // The × on Notes: off Recent (the next one moves up) and off this device's list, saved for the other devices.
  h.click({ apx: 'notes' });
  assert.deepEqual(h.rows().slice(3), ['h:Recent', 'x:podcasts', 'x:maps', 'x:messenger']);
  assert.deepEqual(h.puts.at(-1), { appRecentHidden: ['notes'] }); assert.ok(!h.store.get('recent').includes('notes'));
  // Edit, minus on Calendar; Add favorites, star Notes: the order is kept and saved each time.
  h.click({ apedit: '' }); h.click({ apminus: 'calendar' }); assert.deepEqual(h.puts.at(-1), { appFavorites: ['gone-app', 'music'] });
  h.click({ apadd: '' }); h.click({ apstar: 'notes' }); h.click({ apdone: '' }); h.click({ apdone: '' });
  assert.deepEqual(h.A.favorites(), ['music', 'notes']);
  // Search: matching apps, the best (a name that starts with it) first, a description match last.
  h.q('cal'); assert.deepEqual(h.rows(), ['calendar', 'books']);
  h.q('');
  // A new owner: the empty line, then Recent.
  const n = harness(); n.api.appsPanelOpen();
  assert.deepEqual(n.rows(), ['h:Favorites', 'empty:Star apps to keep them here', 'h:Recent', 'x:notes', 'x:music', 'x:calendar', 'x:podcasts']);
  // Picking an app closes the panel and opens it (back on Recent everywhere).
  n.click({ apopen: 'files' }); assert.equal(n.A.isOpen(), false); assert.deepEqual(n.opened, ['tap:files']);
});

test('the × and Favorites are box preferences; opening an app again puts it back on Recent', () => {
  const h = harness({ hidden: ['podcasts'] });
  assert.deepEqual(h.A.recent(), ['notes', 'music', 'calendar', 'maps'], 'a removal from another device hides it here');
  h.ctx.window.WizCore.appsPanelOpened('podcasts');
  assert.deepEqual(h.puts.at(-1), { appRecentHidden: [] }, 'opened again: back on Recent on the box');
  assert.deepEqual(h.A.recent(), ['notes', 'music', 'calendar', 'podcasts']);
  h.ctx.window.WizCore.appsPanelOpened('notes');
  assert.equal(h.puts.length, 1, 'opening an app that was never removed saves nothing');
});

test('the nine: recent first, then favorites, then the rest A-Z; never Agents, Android-only apps or duplicates', () => {
  const h = harness({ recent: ['music', 'notes'], favs: ['calendar', 'music', 'books'] });
  assert.deepEqual(h.A.nine(), ['music', 'notes', 'calendar', 'books', 'app-store', 'wizard', 'files', 'maps', 'messenger']);
  assert.ok(!h.A.nine().some(id => ['agents', 'android'].includes(id)));
});

test('Apps in front: a bar swipe steps one recent app (left = older), the tile follows, and it stops at the ends', () => {
  const h = harness({ front: 'notes' });
  assert.equal(h.api.appsStepping(), true);
  assert.deepEqual(h.A.stepList(), ['notes', 'music', 'calendar', 'podcasts', 'maps'], 'Chats and the Messenger slot are their own sections');
  assert.equal(h.api.appsStep(1), true); assert.deepEqual(h.opened, ['music']); assert.match(h.toasts.at(-1), /Music · 2 of 5/);
  assert.equal(h.api.appsStep(1), true); assert.equal(h.opened.at(-1), 'calendar');
  assert.equal(h.api.appsStep(-1), true); assert.equal(h.opened.at(-1), 'music', 'right goes back toward the newest');
  assert.equal(h.api.appsStep(-1), true); assert.equal(h.opened.at(-1), 'notes');
  assert.equal(h.api.appsStep(-1), false, 'at the newest it stays (no wrap)'); assert.equal(h.opened.length, 4);
  for (let k = 0; k < 4; k++) h.api.appsStep(1);
  assert.equal(h.opened.at(-1), 'maps'); assert.equal(h.api.appsStep(1), false, 'at the oldest it stays');
  assert.deepEqual(h.store.get('recent'), ['notes', 'music', 'calendar', 'podcasts', 'maps', 'messenger'], 'stepping never reorders Recent');
});

test('Home, Chats or Messenger in front, or the panel up: the bar swipe is not taken', () => {
  for (const current of ['home', 'chats', 'slot']) assert.equal(harness({ current }).api.appsStepping(), false, current);
  const h = harness(); h.api.appsPanelOpen(); assert.equal(h.api.appsStepping(), false, 'panel up');
  assert.equal(h.api.appsPanelToggled(), true, 'the Apps tile again closes the panel'); assert.equal(h.A.isOpen(), false);
  assert.equal(h.api.appsStepping(), true);
});

// wizard-ux issue 1989: other agents' chats star, stay starred after a reload (box prefs), land on Recent and open;
// connectors (wizard.md `type: external`) and screenless agent apps are not listed anywhere in the panel.
const PHIL = { id: 'agent:philosopher', kind: 'chats', agent: 'philosopher', name: 'Philosopher Agent', desc: 'Chats with Philosopher Agent' };
const CLAUDE = { id: 'wizard-claude', name: 'Claude', desc: 'Your Claude subscription', url: '/wizard-claude/', kind: 'wizard', type: 'external', category: 'app' };
const BRIGHT = { id: 'wizard-brightdata', name: 'Bright Data', desc: 'Web data for your agent and apps.', url: '/brightdata/', kind: 'wizard', type: 'external', category: 'app' };

test('an agent\'s chats star, survive a reload from the box, land on Recent after opening, and open its chats', () => {
  const h = harness({ extra: [PHIL] });
  h.api.appsPanelOpen(); h.click({ apadd: '' });
  assert.ok(h.rows().includes('agent:philosopher'), 'listed in Add favorites');
  h.click({ apstar: 'agent:philosopher' });
  assert.deepEqual(h.A.favorites(), ['agent:philosopher'], 'the star sticks');
  // ui-preferences takes app ids without a colon: the box gets agent.philosopher.
  assert.deepEqual(h.puts.at(-1), { appFavorites: ['agent.philosopher'] });
  // A reload, or another device, reading the box's list: still a Favorite.
  const r = harness({ extra: [PHIL], favs: h.puts.at(-1).appFavorites });
  assert.deepEqual(r.A.favorites(), ['agent:philosopher']);
  r.api.appsPanelOpen(); assert.deepEqual(r.rows().slice(0, 2), ['h:Favorites', 'agent:philosopher']);
  // Reorder by drag keeps it, and the minus takes it off again.
  r.click({ apedit: '' }); r.click({ apminus: 'agent:philosopher' }); assert.deepEqual(r.puts.at(-1), { appFavorites: [] });
  // Opened from All apps: the panel closes, the tile opens (openApp → the agent's chats), and it is on Recent.
  const o = harness({ extra: [PHIL] }); o.api.appsPanelOpen(); o.click({ apall: '' });
  o.click({ apopen: 'agent:philosopher' });
  assert.equal(o.A.isOpen(), false); assert.deepEqual(o.opened, ['tap:agent:philosopher']);
  assert.equal(o.A.recent()[0], 'agent:philosopher');
  // Taken off Recent: stored for the box the same way, and back on Recent once opened again.
  o.click({ apx: 'agent:philosopher' }); assert.deepEqual(o.puts.at(-1), { appRecentHidden: ['agent.philosopher'] });
  assert.ok(!o.A.recent().includes('agent:philosopher'));
  o.ctx.window.WizCore.appsPanelOpened('agent:philosopher'); assert.deepEqual(o.puts.at(-1), { appRecentHidden: [] });
});

test('connectors are absent from search, All apps, Add favorites, Favorites, Recent and the nine; apps and agents stay', () => {
  const h = harness({ extra: [PHIL, CLAUDE, BRIGHT], recent: ['wizard-claude', 'notes'], favs: ['wizard-claude', 'music'] });
  h.api.appsPanelOpen();
  assert.deepEqual(h.A.favorites(), ['music']); assert.ok(!h.A.recent().includes('wizard-claude'));
  assert.ok(!h.A.nine().includes('wizard-claude'));
  h.q('claude'); assert.deepEqual(h.rows(), [], 'search finds no connector');
  h.q('bright'); assert.deepEqual(h.rows(), []);
  h.q('philo'); assert.deepEqual(h.rows(), ['agent:philosopher'], 'an agent is found');
  h.q('');
  h.click({ apall: '' });
  const all = h.rows();
  assert.ok(!all.includes('wizard-claude') && !all.includes('wizard-brightdata'), 'All apps has no connector');
  assert.ok(all.includes('notes') && all.includes('agent:philosopher'), 'a view app and an agent are listed');
  h.click({ apback: '' }); h.click({ apadd: '' });
  const add = h.rows();
  assert.ok(!add.includes('wizard-claude') && add.includes('notes') && add.includes('agent:philosopher'), 'Add favorites the same');
});

// wizard-ux issue 2001: long-pressing a row (Favorites, Recent, All apps, a search result) offers Add to Home Screen for
// every app the home-screen sheet can pin, next to Add to / Remove from Favorites; choosing it opens that sheet for the
// app (WizHomeScreenApps.offer). An app it can't pin (an agent's chats) shows only the Favorites item.
function withMenu(h) {
  const menus = [], offered = [];
  let t = 0; h.ctx.Date = { now: () => (t += 1000) }; // each long-press is its own finger
  h.ctx.window.WosContextMenu = { open: o => menus.push(o) };
  h.ctx.window.WizHomeScreenApps = { canOffer: a => !!a && a.kind === 'wizard' && !!a.url, offer: a => { offered.push(a.id); return true; } };
  const press = id => {
    const btn = { dataset: { apopen: id }, getBoundingClientRect: () => ({ left: 10, top: 100, right: 300, bottom: 144 }) };
    const before = menus.length;
    h.panel.listeners.contextmenu.forEach(f => f({ target: { closest: () => btn }, preventDefault() {} }));
    assert.equal(menus.length, before + 1, `a menu opens on ${id}`);
    return menus.at(-1);
  };
  return { press, offered, labels: m => Array.from(m.items, i => i.label), pick: (m, label) => m.items.find(i => i.label === label).action() };
}

test('long-press a row: Add to Home Screen beside Favorites in every list; choosing it opens the home-screen sheet', () => {
  const h = harness({ favs: ['calendar'], extra: [PHIL] }), m = withMenu(h);
  h.api.appsPanelOpen();
  const lists = [['Favorites', 'calendar', 'Remove from Favorites'], ['Recent', 'notes', 'Add to Favorites']];
  for (const [list, id, fav] of lists) {
    assert.ok(h.rows().some(r => r.replace(/^x:/, '') === id), `${id} is on ${list}`);
    const menu = m.press(id);
    assert.deepEqual(m.labels(menu), [fav, 'Add to Home Screen'], `${list}: ${m.labels(menu)}`);
    m.pick(menu, 'Add to Home Screen'); assert.equal(m.offered.at(-1), id, 'the home-screen sheet opens for that app');
  }
  h.click({ apall: '' }); assert.ok(h.rows().includes('files'), 'Files is in All apps');
  let menu = m.press('files'); assert.deepEqual(m.labels(menu), ['Add to Favorites', 'Add to Home Screen']);
  m.pick(menu, 'Add to Home Screen'); assert.equal(m.offered.at(-1), 'files');
  h.click({ apback: '' }); h.q('book'); assert.deepEqual(h.rows(), ['books'], 'a search result');
  menu = m.press('books'); assert.deepEqual(m.labels(menu), ['Add to Favorites', 'Add to Home Screen']);
  m.pick(menu, 'Add to Home Screen'); assert.equal(m.offered.at(-1), 'books');
  // An app the sheet can't pin: only Favorites, which still works.
  h.q('philo'); assert.deepEqual(h.rows(), ['agent:philosopher']);
  menu = m.press('agent:philosopher'); assert.deepEqual(m.labels(menu), ['Add to Favorites'], 'no Add to Home Screen for an agent\'s chats');
  m.pick(menu, 'Add to Favorites'); assert.deepEqual(h.A.favorites(), ['calendar', 'agent:philosopher']);
  assert.deepEqual(m.offered, ['calendar', 'notes', 'files', 'books']);
  // No home-screen module on this page (an old shell part): the Favorites menu still opens.
  delete h.ctx.window.WizHomeScreenApps; assert.deepEqual(m.labels(m.press('files')), ['Add to Favorites']);
});
