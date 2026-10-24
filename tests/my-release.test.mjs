// My release (wizard-os#186) as a general feature: it switches on by DATA (the box serves ../my-release.json or the
// App Manager returns `release`), never by an owner's name or flag. A stock box looks exactly as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const read = p => readFileSync(join(root, p), 'utf8');
const src = read('web/core/os-updates.js');
const tick = () => new Promise(r => setTimeout(r, 0));
const ST = (o = {}) => ({ mode: 'ask', chosen: true, channel: 'stable', installed: '0.3.32', latest: '0.3.33', stable: '0.3.33', update_available: false, unpinned: false, checked: true, installing: false, interrupted: false, ...o });
const RELEASE = (o = {}) => ({ name: "James's release", base: { ref: 'abc1234', label: 'Latest abc1234' }, build: 'b1', changes: [
  { sha: 'aaa1111', title: 'feat: Home shows the weather (wizard-os#12)', status: 'Mine', date: '2026-10-20' },
  { sha: 'bbb2222', title: 'Bigger send button', status: 'Proposed feature', date: '2026-10-21' },
  { sha: 'ccc3333', title: 'fix: tour stops on Settings', status: 'Proposed fix', date: '2026-10-22' },
  { sha: 'ddd4444', title: 'Quieter toasts', label: 'Quieter notices', status: 'Merged', date: '2026-10-23' },
], ...o });

function boot({ status = ST(), release = null, wos = {} } = {}) {
  const calls = [];
  let rel = release;
  const fetch = async (url, opts = {}) => {
    calls.push(url);
    if (opts.method === 'POST') return { ok: true, json: async () => ({ started: true }) };
    if (String(url).endsWith('/my-release.json')) return rel ? { ok: true, json: async () => rel } : { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, json: async () => status };
  };
  const window = { innerHeight: 874, localStorage: { getItem: () => null, setItem() {} }, __wos: { idx: 1, sheet: null, desks: [{ wins: [] }], toast() {}, ...wos } };
  const document = { body: { appendChild() {} }, hidden: false, currentScript: { src: 'https://box/wizard-os-home/core/os-updates.js' }, createElement: () => ({ setAttribute() {}, addEventListener() {}, dataset: {}, style: {} }), querySelector: () => null, addEventListener() {} };
  new Function('window', 'document', 'fetch', 'location', 'setInterval', 'clearInterval', src)(window, document, fetch, { href: 'https://box/wizard-os-home/', reload() {} }, () => 0, () => {});
  return { U: window.WosUpdates, window, calls, setRelease: v => { rel = v; } };
}
const settle = async () => { for (let i = 0; i < 5; i++) await tick(); };
const tap = (U, what, extra = {}) => U.act({ closest: s => s === '[data-osu]' ? { dataset: { osu: what, ...extra } } : null }, { toast() {}, haptic() {} }, { detail: 1 });

test('(a) a box without my-release.json shows no release UI', async () => {
  const b = boot(); await settle();
  assert.equal(b.U.release, false);
  assert.equal(b.U.title(), 'About & updates');
  const h = b.U.html();
  assert.match(h, /Wizard OS 0\.3\.32/);
  assert.doesNotMatch(h, /My release|Your changes|Propose|rl-chip|data-osu-release/);
  assert.equal(b.U.card(), null, 'up to date: no card');
});

test('(b) with my-release.json: the release name, its base, Your changes with chips and Propose on Mine only', async () => {
  const b = boot({ release: RELEASE() }); await settle();
  assert.equal(b.U.release, true);
  assert.equal(b.U.title(), 'My release');
  let h = b.U.html();
  assert.match(h, /<b class="rl-name" data-osu-title>James&#39;s release<\/b>/);
  assert.match(h, /Built on Latest abc1234/);
  assert.match(h, /Your changes<\/span><span class="st-val">4</);
  assert.doesNotMatch(h, /data-osu="ch-stable"/, 'a release builds on Latest; no channel picker');
  tap(b.U, 'mine'); h = b.U.html();
  assert.match(h, /<b>Home shows the weather<\/b>/, 'conventional prefix and issue ref dropped');
  assert.match(h, /<b>Quieter notices<\/b>/, 'own label wins');
  for (const [k, t] of [['mine', 'Mine'], ['feature', 'Proposed feature'], ['fix', 'Proposed fix'], ['merged', 'Merged']]) assert.match(h, new RegExp(`rl-chip rl-${k}">${t}<`));
  assert.equal((h.match(/data-osu="propose"/g) || []).length, 1, 'Propose only on the Mine change');
  assert.match(h, /data-osu="propose" data-sha="aaa1111"/);
});

test('Propose opens a context chat keyed release-change:<sha> through the shell hook', async () => {
  const opened = [];
  const b = boot({ release: RELEASE(), wos: { openContextDraft: (k, item) => { opened.push([k, item]); return { kind: 'unsent-draft' }; } } }); await settle();
  tap(b.U, 'propose', { sha: 'aaa1111' });
  assert.equal(opened.length, 1);
  assert.equal(opened[0][0], 'release-change:aaa1111');
  assert.match(opened[0][1].title, /Home shows the weather/);
  tap(b.U, 'propose', { sha: 'bbb2222' });
  assert.equal(opened.length, 1, 'already proposed changes do nothing');
  for (const f of ['web/app.js', 'web/desktop/desktop.js']) {
    const s = read(f);
    assert.match(s, /function openContextDraft\(key, item\)/, f + ' has one shared hook');
    assert.match(s, /openSettings, (?:closeSettings, )?openContextDraft,/, f + ' exposes it to Settings');
  }
});

test('release card states: Update (behind), Updating, Couldn’t update, Reload on a new build', async () => {
  const R = o => ST({ release: { name: "James's release", base: 'abc1234', behind: 0, new: [], building: false, failed: null, ...o } });
  let b = boot({ status: R({ behind: 2, new: [{ sha: 'x1', title: 'fix: a' }, { sha: 'x2', title: 'b' }] }) }); await settle();
  assert.deepEqual([b.U.card().state, b.U.card().title, b.U.card().label], ['behind', '2 new changes on Latest', 'Update']);
  assert.equal(b.U.title(), 'My release', 'App Manager `release` alone also makes it a release box');
  b = boot({ status: R({ building: true }) }); await settle();
  assert.deepEqual([b.U.card().state, b.U.card().title, b.U.card().disabled], ['building', 'Updating…', true]);
  b = boot({ status: R({ failed: { code: 'conflict' } }) }); await settle();
  assert.deepEqual([b.U.card().state, b.U.card().title, b.U.card().line, b.U.card().label], ['failed', 'Couldn’t update', 'Your change clashes with Latest', 'Try again']);
  b = boot({ release: RELEASE() }); await settle();
  assert.equal(b.U.card(), null);
  b.setRelease(RELEASE({ build: 'b2' })); await b.U.poll();
  assert.deepEqual([b.U.card().state, b.U.card().title, b.U.card().action], ['reload', 'New build ready', 'reload']);
  assert.equal(b.U.popKey(b.U.card()), 'reload:b2');
});

test('a stock box asks for my-release.json once, then never polls it again', async () => {
  const b = boot(); await settle();
  const n = b.calls.filter(u => u.endsWith('/my-release.json')).length;
  assert.equal(n, 1);
  await b.U.poll(); await b.U.poll();
  assert.equal(b.calls.filter(u => u.endsWith('/my-release.json')).length, 1);
});

test('Settings: My release leads and folds About in only when the box has a release', () => {
  const s = read('web/core/settings.js');
  assert.match(s, /\{ id: 'release', title: 'My release', available: release \}/);
  assert.match(s, /\{ id: 'about', title: 'About & updates', available: \(\) => !release\(\) \}/);
  assert.match(s, /const release = \(\) => !!window\.WosUpdates\?\.release;/);
  assert.match(s, /return p === 'about' && release\(\) \? 'release' : p;/);
});

/* ---- (c) owner layer: loads only when the box provides one; ?mine=off disables it ---- */
const layerSrc = read('web/core/owner-layer.js');
async function bootLayer({ file = null, search = '', cache = null } = {}) {
  const store = new Map(cache ? [['wos.ownerLayer.v1', JSON.stringify(cache)]] : []);
  const links = [], imports = [], builtins = [], fetched = [];
  const root = { dataset: {} };
  const head = { appendChild: l => links.push(l) };
  const document = { documentElement: root, head, currentScript: { src: 'https://box/wizard-os-home/core/owner-layer.js' },
    createElement: () => ({ dataset: {}, remove() { links.splice(links.indexOf(this), 1); } }), querySelector: () => null, addEventListener() {} };
  const window = { WosSkinHost: { builtin: (n, f, o) => builtins.push([n, o]) } };
  const fetch = async url => { fetched.push(url); return file ? { ok: true, json: async () => file } : { ok: false, status: 404, json: async () => ({}) }; };
  const localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
  const code = layerSrc.replace('import(JS)', '__import(JS)');
  const __import = async u => { imports.push(u); return { default: () => {} }; };
  new Function('window', 'document', 'fetch', 'location', 'localStorage', 'URLSearchParams', 'console', '__import', code)(window, document, fetch, { href: 'https://box/wizard-os-home/', search }, localStorage, URLSearchParams, console, __import);
  await window.WosOwnerLayer.ready; await tick(); await tick();
  return { L: window.WosOwnerLayer, root, links, imports, builtins, fetched, store };
}

test('(c) no my-release.json, or one without `layer`: no html[data-mine], nothing else requested', async () => {
  for (const file of [null, RELEASE()]) {
    const b = await bootLayer({ file });
    assert.equal(b.root.dataset.mine, undefined);
    assert.equal(b.L.on(), false);
    assert.deepEqual(b.links, []); assert.deepEqual(b.imports, []);
    assert.deepEqual(b.fetched, ['https://box/wizard-os-home/my-release.json']);
  }
});

test('(c) a release with a layer: data-mine set, layer.css linked, layer.js run as a WosSkinHost builtin', async () => {
  const b = await bootLayer({ file: RELEASE({ layer: { css: true, js: true } }) });
  assert.equal(b.root.dataset.mine, '');
  assert.equal(b.links.length, 1); assert.equal(b.links[0].href, 'https://box/wizard-os-home/my-release/layer.css');
  assert.deepEqual(b.imports, ['https://box/wizard-os-home/my-release/layer.js']);
  assert.equal(b.builtins[0][0], 'owner-layer'); assert.equal(b.builtins[0][1].when, 'always');
});

test('(c) ?mine=off skips the layer for one load; a layer that went away is removed', async () => {
  const off = await bootLayer({ file: RELEASE({ layer: { css: true, js: true } }), search: '?mine=off', cache: { css: true, js: true } });
  assert.equal(off.root.dataset.mine, undefined); assert.deepEqual(off.links, []); assert.deepEqual(off.imports, []);
  assert.deepEqual(off.fetched, [], 'not even asked');
  const gone = await bootLayer({ file: null, cache: { css: true, js: false } });
  assert.equal(gone.root.dataset.mine, undefined, 'cached layer removed once the box says there is none');
  assert.equal(gone.links.length, 0);
  assert.equal(gone.store.has('wos.ownerLayer.v1'), false);
});

test('(c) both shells load the owner layer first in <head>; skin packages stack after it', () => {
  for (const f of ['web/index.html', 'web/desktop.html']) {
    const h = read(f);
    assert.ok(h.indexOf('core/owner-layer.js') > 0 && h.indexOf('core/owner-layer.js') < h.indexOf('core/shell.js'), f);
  }
  assert.match(read('web/core/skin-host.js'), /link\[data-owner-layer\]/);
});

test('(d) no file this feature touches names an owner', () => {
  const owner = new RegExp(['mig', 'uel'].join(''), 'i');
  const files = ['web/core/os-updates.js', 'web/core/owner-layer.js', 'web/core/settings.css', 'docs/COMPONENTS.md'];
  for (const f of files) assert.doesNotMatch(read(f), owner, f);
  // Settings and the shells' new hook carry no owner names either.
  for (const f of ['web/core/settings.js']) assert.doesNotMatch(read(f).split('\n').filter(l => /release|openContextDraft/i.test(l)).join('\n'), owner, f);
  // Nothing under web/ ships an owner's personal layer.
  const walk = d => readdirSync(join(root, d)).flatMap(n => statSync(join(root, d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]);
  assert.deepEqual(walk('web').filter(p => /(^|\/)(mine|my-release)(\/|\.json$)/.test(p)), []);
});
