// Settings, final pass for Miguel's release (wizard-os#186): no Files shortcut, About folded into My release, Resources
// page = the Home bars, Skins grid with a dashed My skin tile, plain rows; and the Home update pop-up.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const settingsSrc = read('web/core/settings.js');

function harness({ mine = true, unsent = [], recovered = [], release = true } = {}) {
  const dataset = mine ? { mine: '' } : {};
  const s = { console, Map, Set, Date, String, CSS: { escape: String }, setTimeout, requestAnimationFrame: f => f(),
    document: { activeElement: null, documentElement: { dataset } }, navigator: { userAgent: 'Desktop' }, location: { host: 'box.ts.net' },
    localStorage: { getItem: () => null, setItem() {} } };
  s.window = s;
  s.WizCore = { refreshApps: async () => {}, voiceStatus: { card: () => '<div class="vx"></div>', state: { ready: true } } };
  s.WizChatsHost = { defaultId: () => 'wizard-chats', installed: () => [{ id: 'wizard-chats', name: 'Chats' }] };
  s.WosSkin = { current: 'obsidian', list: [{ id: 'obsidian', name: 'Obsidian' }, { id: 'landscapes', name: 'Landscapes' }], set: id => id };
  s.WosMySkin = { state: { empty: true, info: {}, script: null }, on() {}, FILE: 'Skins/My skin.css' };
  s.WosFiles = {};
  s.WosCancelled = { list: () => recovered, html: () => '' };
  if (release) s.WosUpdates = { state: { mode: 'ask' }, mine: { name: "Miguel's release" }, title: () => 'My release', cardHtml: () => '', build: { loaded: 'aaaa111' } };
  const painted = [];
  s.WosResources = { bars: host => { painted.push(host); host.innerHTML = '<section class="rs-barsw"></section>'; }, lowest: () => ({ label: 'Disk', left: 12 }) };
  vm.runInNewContext(settingsSrc, s);
  const hosts = {};
  const root = { innerHTML: '', scrollTop: 0, dataset: {}, classList: { add() {} }, contains: () => false,
    querySelector: sel => { const m = /\[data-settings-feature="([^"]+)"\]/.exec(sel); if (m && root.innerHTML.includes(`data-settings-feature="${m[1]}"`)) return (hosts[m[1]] ||= { querySelector: q => q === '[data-st-resources]' && root.innerHTML.includes('data-st-resources') ? (hosts.res ||= { innerHTML: '' }) : null }); return null; },
    querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} };
  const view = s.WosSettings.mount(root, { shell: 'phone', live: { ok: true }, outbox: { unsent: () => unsent, canRetry: () => false }, toast() {} });
  const act = (attribute, value = '', feature) => view.dispatch({ closest: sel => sel === `[${attribute}]` ? { dataset: { [attribute.replace(/^data-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase())]: value } } : sel === '[data-settings-feature]' && feature ? { dataset: { settingsFeature: feature } } : null }, { detail: 1 });
  return { s, root, view, act, painted, hosts };
}
const pages = html => [...html.matchAll(/data-st-page="([a-z]+)"/g)].map(m => m[1]);

test('mine: no Files shortcut and no About row; stock keeps both', () => {
  const h = harness();
  assert.doesNotMatch(h.root.innerHTML, /data-st-shortcut="files"/);
  assert.ok(!pages(h.root.innerHTML).includes('about'), 'About is folded into My release');
  const stock = harness({ mine: false });
  assert.match(stock.root.innerHTML, /data-st-shortcut="files"/);
  assert.ok(pages(stock.root.innerHTML).includes('about'));
  assert.match(stock.root.innerHTML, /<b>Look<\/b>/); assert.match(stock.root.innerHTML, /<b>AI usage<\/b>/);
});
test('mine: About folds into the bottom of My release as quiet rows (status, version, Gestures & help)', () => {
  const h = harness();
  h.view.focus('release');
  const html = h.root.innerHTML, at = html.indexOf('data-about-folded');
  assert.ok(at > 0, 'folded About on My release');
  assert.match(html, /<b>Connected<\/b><\/span><span class="st-val">box\.ts\.net<\/span>/);
  assert.match(html, /<b>Version<\/b><\/span><span class="st-val">aaaa111<\/span>/);
  assert.match(html, /Gestures &amp; help/);
  assert.ok(html.lastIndexOf('data-settings-feature=') < at, 'About is the last section on the page');
  h.view.focus('about'); assert.equal(h.view.page, 'release', 'old About links land on My release');
  h.view.focus('wizard'); assert.equal(h.view.page, 'release');
  const noRelease = harness({ release: false });
  assert.ok(pages(noRelease.root.innerHTML).includes('about'), 'no release: About stays its own page');
});
test('mine: Resources page renders the shared Home bars into its host; index value is quiet unless low', () => {
  const h = harness();
  assert.match(h.root.innerHTML, /<b>Resources<\/b><\/span><span class="st-val" data-st-subtitle="usage">Disk 88% used<\/span>/);
  h.view.focus('usage');
  assert.match(h.root.innerHTML, /<h3 tabindex="-1">Resources<\/h3>/);
  assert.match(h.root.innerHTML, /data-st-resources/);
  assert.doesNotMatch(h.root.innerHTML, /data-usage-refresh|us-row/, 'the old AI usage card is not repeated');
  assert.ok(h.painted.length >= 1, 'core/resources.js draws the bars (WosResources.bars)');
  h.s.WosResources.lowest = () => ({ label: 'GPT', left: 70 }); h.view.focus();
  assert.match(h.root.innerHTML, /data-st-subtitle="usage"><\/span>/, 'nothing low: no value');
  h.view.focus('resources'); assert.equal(h.view.page, 'usage');
});
test('mine: Skins is one grid ending in a dashed My skin tile that opens Edit / Reset below the grid', () => {
  const h = harness();
  assert.match(h.root.innerHTML, /<b>Skins<\/b>/);
  h.view.focus('look');
  let html = h.root.innerHTML;
  const grid = html.slice(html.indexOf('<div class="skp"'), html.indexOf('</div>', html.indexOf('skp-mini-my')));
  const tiles = [...grid.matchAll(/class="skp-card( skp-my)?"/g)];
  assert.equal(tiles.length, 3); assert.equal(tiles.at(-1)[1], ' skp-my', 'My skin is the last tile');
  assert.match(html, /data-myskin-tile aria-expanded="false" aria-label="My skin">/);
  assert.doesNotMatch(html, /data-myskin="edit"|sk-head|<h4/, 'closed: no controls, no heading');
  h.act('data-myskin-tile', '', 'look');
  html = h.root.innerHTML;
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /data-myskin-panel>.*data-myskin="edit"/s);   // Reset appears only once My skin has changes (main, launch model)
  assert.ok(html.indexOf('data-myskin-panel') > html.indexOf('skp-mini-my'), 'controls sit under the grid');
  const css = read('web/mine/mine.css');
  assert.match(css, /html\[data-mine\] \.st-root \.skp-my \.skp-mini-my \{[^}]*outline: 1\.5px dashed/);
  const stock = harness({ mine: false }); stock.view.focus('look');
  assert.doesNotMatch(stock.root.innerHTML, /skp-my/); assert.match(stock.root.innerHTML, /<b>My skin<\/b>/);
});
test('mine: Unsent & recovered leaves the index when nothing is waiting, returns with a count', () => {
  assert.ok(!pages(harness().root.innerHTML).includes('recovery'));
  const h = harness({ recovered: [{ id: 'r1' }] });
  assert.ok(pages(h.root.innerHTML).includes('recovery'));
  assert.match(h.root.innerHTML, /data-st-subtitle="recovery">1</);
  assert.ok(pages(harness({ mine: false }).root.innerHTML).includes('recovery'), 'stock always lists it');
});
test('mine: chats, voice and recovery pages are plain rows: no headings, help text or ? toggles', () => {
  const ctx = (src, extra = {}) => { const c = { window: {}, document: { documentElement: { dataset: { mine: '' } }, addEventListener() {}, readyState: 'complete' }, ...extra }; c.window = c; c.window.WizCore = {}; return c; };
  const vs = ctx(); vm.runInNewContext(read('web/core/voice-status.js'), { ...vs, fetch: () => new Promise(() => {}) });
  const card = vs.WizCore.voiceStatus.card();
  assert.match(card, /<b>Transcription<\/b><\/span><span class="st-val">Checking…<\/span>/); assert.doesNotMatch(card, /<h4|<small/);
  const h = harness({ unsent: [{ id: 'u1', createdAt: 1, state: 'failed', text: 'hi' }] });
  h.view.focus('unsent');
  assert.doesNotMatch(h.root.innerHTML, /st-info|Unsent &amp; retained|Unsent & retained|<h4/);
  h.view.focus('chats-default');
  assert.match(h.root.innerHTML, /<b>Chats app<\/b><\/span><span class="st-val">Wizard Chats<\/span>/);
  assert.doesNotMatch(h.root.innerHTML, /<h4>Default Chats|st-store-hint|◉|○/);
  for (const f of ['mic', 'sel-menu', 'cancelled', 'workspace-sync', 'own-views']) assert.match(read(`web/core/${f}.js`), /dataset\??\.mine != null|mineOn\(\)/, `${f} has a plain mine variant`);
});
test('resources.js: one group list drives Home and Settings, with room for a third group', () => {
  const src = read('web/core/resources.js');
  assert.match(src, /const GROUPS=\[/);
  assert.match(src, /\{id:'ai',[^}]*title:'AI resources'/); assert.match(src, /\{id:'hw',[^}]*title:'Compute resources'/);
  assert.match(src, /GROUPS\.map\(group\)/, 'homeBarsHtml renders every group from the list');
  assert.match(src, /window\.WosResources=\{bars,barsHtml/, 'exposes bars(host) for Settings');
  const ctx = { window: {}, document: { documentElement: { dataset: { mine: '' } }, addEventListener() {}, querySelectorAll: () => [], createElement: () => ({ set innerHTML(v) { this.firstElementChild = { dataset: { sig: '' } }; } }), hidden: false },
    localStorage: { getItem: () => null, setItem() {} }, queueMicrotask() {}, setTimeout, clearTimeout, fetch: async () => ({ ok: false }), AbortController, requestAnimationFrame: f => f() };
  ctx.window = ctx; ctx.addEventListener = () => {}; ctx.WosUsage = { normalize: j => j };
  vm.runInNewContext(src, ctx);
  const host = { innerHTML: '', isConnected: true, querySelector: () => null, querySelectorAll: () => [] };
  ctx.WosResources.bars(host);
  assert.match(host.innerHTML, /class="rs-bg rs-bg-hw"[^>]*data-rs-group="hw"><p class="rs-gh"><b>Compute resources<\/b>/);
  assert.equal(host.innerHTML, ctx.WosResources.barsHtml(), 'Settings gets exactly the Home markup');
  assert.deepEqual([...ctx.WosResources.groups()], ['ai', 'hw']);
});
