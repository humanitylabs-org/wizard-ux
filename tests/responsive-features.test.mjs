import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const assetList = html => [...html.matchAll(/<(?:script[^>]*src|link[^>]*href)="([^"]+)"/g)].map(m => m[1]);
const inventory = JSON.parse(read('docs/responsive-feature-inventory.json'));

test('both entrypoints load shared feature surface, skin engine and CSS exactly once and in dependency order', () => {
  for (const file of ['index.html', 'desktop.html']) {
    const assets = assetList(read('web/' + file));
    for (const asset of ['core/settings.js', 'core/settings.css', 'core/skins.js', 'core/skins.css', 'core/scenery.js', 'core/cancelled.js']) assert.equal(assets.filter(x => x === asset).length, 1, file + ': ' + asset);
    assert.ok(assets.indexOf('core/scenery.js') < assets.indexOf('core/skins.js'));
    assert.ok(assets.indexOf('core/settings.js') < assets.indexOf(file === 'index.html' ? 'app.js' : 'desktop/desktop.js'));
    for (const asset of assets) assert.ok(fs.existsSync(new URL('../web/' + asset.replace(/^\/wizard-os-home\//, ''), import.meta.url)), file + ': missing ' + asset);
  }
});

test('new entrypoint-exclusive features fail the parity guard (all current module/style differences explicitly audited)', () => {
  const phone = new Set(assetList(read('web/index.html'))), desktop = new Set(assetList(read('web/desktop.html')));
  const exclusive = [...phone].filter(x => !desktop.has(x)).concat([...desktop].filter(x => !phone.has(x))).sort();
  assert.deepEqual(exclusive, Object.keys(inventory.exceptions).sort(), 'Load new cross-platform features in BOTH shells. Do not add a general-purpose feature to the native/input exception list.');
  for (const [asset, entry] of Object.entries(inventory.exceptions)) {
    assert.ok(entry.reason.length > 10, asset);
    assert.ok(['adapter', 'native', 'preview', 'open-gap'].includes(entry.classification));
    assert.equal(entry.shell, phone.has(asset) ? 'phone' : 'desktop');
  }
});

test('shell adapters cannot retain a second Settings renderer, picker, or hardcoded route list', () => {
  for (const f of ['web/app.js', 'web/desktop/desktop.js']) {
    const s = read(f);
    assert.match(s, /WosSettings\.mount\(/);
    assert.match(s, /WosSettings\.route\(v, openSettings\)/);
    assert.doesNotMatch(s, /function (?:lookGroup|pickSkin)\(/);
    assert.doesNotMatch(s, /data-skinpick|<div class="st-group"/);
  }
  assert.doesNotMatch(read('web/core/polish.css'), /html\[data-shell="desktop"\] \.st-/);
  assert.match(read('web/core/deeplink.js'), /WosSettings\?\.features\.some/);
});

function harness() {
  const sandbox = { console, Map, Set, Date, String, navigator: { userAgent: 'Desktop fixture' }, location: { host: 'fixture.invalid' }, setTimeout: fn => fn(), CSS: { escape: String }, document: { activeElement: null } };
  sandbox.window = sandbox;
  sandbox.WizCore = {}; sandbox.WizBrand = { html: 'W' };
  vm.runInNewContext(read('web/core/settings.js'), sandbox);
  const roots = [];
  for (const shell of ['phone', 'desktop']) {
    const handlers = {}, root = { innerHTML: '', scrollTop: 0, classList: { add() {} }, dataset: {}, contains: () => false, querySelector: () => null, addEventListener: (event, fn) => handlers[event] = fn, removeEventListener() {} };
    const view = sandbox.WosSettings.mount(root, { shell, helpSub: 'Fixture' }); roots.push({ root, view, handlers });
  }
  return { sandbox, roots };
}
test('a synthetic feature registered ONCE renders, routes and executes in BOTH mounted layouts', () => {
  const { sandbox, roots } = harness(), actions = [], opened = [];
  const unregister = sandbox.WosSettings.register({ id: 'future-qa', aliases: ['future-qa-view'], html: () => '<button data-future-qa>Future shared feature</button>', act: ctx => { actions.push(ctx.shell); return true; } });
  for (const { root, view } of roots) {
    assert.match(root.innerHTML, /data-future-qa/);
    assert.equal(sandbox.WosSettings.route('future-qa-view', focus => opened.push(focus)), true);
    assert.equal(view.dispatch({ closest: selector => selector === '[data-settings-feature]' ? { dataset: { settingsFeature: 'future-qa' } } : null }), true);
  }
  assert.deepEqual(actions, ['phone', 'desktop']); assert.deepEqual(opened, ['future-qa', 'future-qa']);
  unregister(); for (const { root, view } of roots) { assert.doesNotMatch(root.innerHTML, /data-future-qa/); view.destroy(); }
});
test('capability gating is bridge/OS based, never layout based', () => {
  const { sandbox, roots } = harness();
  assert.doesNotMatch(roots[0].root.innerHTML, /data-st="everywhere"/);
  sandbox.navigator.userAgent = 'Android'; for (const { root, view } of roots) { view.render(); assert.match(root.innerHTML, /data-st="everywhere"[^>]*disabled/); }
});
test('editing a recording/in-flight message cannot delete its custody; text edits reach shell adapter unchanged', () => {
  const { sandbox } = harness(), edits = [], notices = [];
  for (const item of [{id:'a',audio:{}}, {id:'b',audioFile:{}}, {id:'c',state:'sending'}, {id:'d',agent:'private',text:'fixture'}]) {
    sandbox.WosSettings.unsentAction({ outbox: { get: () => item }, editUnsent: it => edits.push(it), toast: (...args) => notices.push(args) }, item.id, 'app', 'edit');
  }
  assert.equal(edits.length,1); assert.equal(edits[0].agent,'private'); assert.equal(notices.length,3);
});
