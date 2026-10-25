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
    for (const asset of ['core/settings.js', 'core/settings.css', 'core/skin-frame.js', 'core/skin-frame.css', 'core/skins.js', 'core/skins.css', 'core/scenery.js', 'core/cancelled.js']) assert.equal(assets.filter(x => x === asset).length, 1, file + ': ' + asset);
    assert.ok(assets.indexOf('core/skin-frame.js') < assets.indexOf('core/skins.js'));
    assert.ok(assets.indexOf('core/scenery.js') < assets.indexOf('core/skins.js'));
    assert.ok(assets.indexOf('core/settings.js') < assets.indexOf(file === 'index.html' ? 'app.js' : 'desktop/desktop.js'));
    // data.js and summaries.js are owner-generated runtime payloads, not committed modules.
    for (const asset of assets.filter(a => !['data.js', 'summaries.js'].includes(a))) assert.ok(fs.existsSync(new URL('../web/' + asset.replace(/^\/wizard-os-home\//, ''), import.meta.url)), file + ': missing ' + asset);
  }
});

test('new entrypoint-exclusive features fail the parity guard (all current module/style differences explicitly audited)', () => {
  const phone = new Set(assetList(read('web/index.html'))), desktop = new Set(assetList(read('web/desktop.html')));
  assert.deepEqual([...phone].filter(x => desktop.has(x)).sort(), inventory.sharedAssets, 'Update the full shared-asset inventory when registering a new module.');
  const modules = fs.readdirSync(new URL('../web/core/', import.meta.url)).filter(x => x.endsWith('.js')).map(x => 'core/' + x).sort();
  assert.deepEqual(modules, Object.keys(inventory.coreModules).sort());
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
  const settings = read('web/core/settings.js');
  assert.doesNotMatch(settings, /data-layoutpick|data-layout-row/);
  assert.match(settings, /data-skinfamily=/);
  assert.match(settings, /<h4>Colours<\/h4>/);
  assert.match(settings, /data-newskin/);
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
    view.focus('future-qa'); // ungrouped registrations remain reachable on About & updates
    assert.equal(view.page, 'about');
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
  sandbox.navigator.userAgent = 'Android'; for (const { root, view } of roots) { view.focus('assistant'); assert.equal(view.page, 'phone'); assert.match(root.innerHTML, /data-st="everywhere"[^>]*disabled/); }
});
test('editing a recording/in-flight message cannot delete its custody; text edits reach shell adapter unchanged', () => {
  const { sandbox } = harness(), edits = [], notices = [];
  for (const item of [{id:'a',audio:{}}, {id:'b',audioFile:{}}, {id:'c',state:'sending'}, {id:'d',agent:'private',text:'fixture'}]) {
    sandbox.WosSettings.unsentAction({ outbox: { get: () => item }, editUnsent: it => edits.push(it), toast: (...args) => notices.push(args) }, item.id, 'app', 'edit');
  }
  assert.equal(edits.length,1); assert.equal(edits[0].agent,'private'); assert.equal(notices.length,3);
});

test('desktop Cancel retains a long take including its final chunk, never a short take or next recording', async () => {
  let now = 0, rec, stopped = 0; const saved = [], stops = [];
  class Recorder {
    static isTypeSupported() { return true; }
    constructor(_stream, opts) { this.mimeType = opts.mimeType; rec = this; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; stops.push(() => { this.ondataavailable?.({ data: new Blob(['final']) }); this.onstop?.(); }); }
  }
  const sandbox = { Blob, crypto: globalThis.crypto, performance: { now: () => now }, navigator: { userAgent: 'Desktop', mediaDevices: { enumerateDevices: async () => [], getUserMedia: async () => ({ getTracks: () => [{ stop: () => stopped++ }] }) } }, requestAnimationFrame: () => 1, cancelAnimationFrame() {}, MediaRecorder: Recorder,
    AudioContext: class { createMediaStreamSource() { return { connect() {} }; } createAnalyser() { return {}; } close() {} },
    WosCancelled: { keepWeb: (blob, ms, _retained, _text, source) => saved.push({ blob, ms, source }) } };
  sandbox.window = sandbox; vm.runInNewContext(read('web/core/voice.js'), sandbox);
  const v = sandbox.WizCore.voice(); await v.start(); rec.ondataavailable({ data: new Blob(['earlier']) }); now = 20000; v.cancel();
  assert.equal(v.state, 'idle'); await v.start(); stops.shift()();
  assert.equal(saved.length, 1); assert.equal(await saved[0].blob.text(), 'earlierfinal'); assert.equal(saved[0].source, 'desktop');
  now += 1000; v.cancel(); stops.shift()(); assert.equal(saved.length, 1); assert.equal(stopped, 2);
});

test('desktop Cancel under 20 s deletes the take from custody instead of holding it for recovery', async () => {
  let now = 0, rec; const held = [], removed = [];
  class Recorder { static isTypeSupported() { return true; } constructor(_s, o) { this.mimeType = o.mimeType; rec = this; } start() { this.state = 'recording'; } stop() { this.state = 'inactive'; this.onstop?.(); } }
  const sandbox = { Blob, crypto: globalThis.crypto, performance: { now: () => now }, navigator: { userAgent: 'Desktop', mediaDevices: { enumerateDevices: async () => [], getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } }, requestAnimationFrame: () => 1, cancelAnimationFrame() {}, MediaRecorder: Recorder,
    AudioContext: class { createMediaStreamSource() { return { connect() {} }; } createAnalyser() { return {}; } close() {} },
    WosCancelled: { KEEP_FROM_MS: 20000, keepWeb: () => held.push('kept') },
    WosOutbox: { capture: () => Promise.resolve(), get: () => null, transition: (id, st) => held.push(st), remove: id => { removed.push(id); return Promise.resolve(true); } } };
  sandbox.window = sandbox; vm.runInNewContext(read('web/core/voice.js'), sandbox);
  const v = sandbox.WizCore.voice(); await v.start(); rec.ondataavailable({ data: new Blob(['quick']) }); now = 19000;
  assert.equal(v.cancel(), false); await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(held, []); assert.equal(removed.length, 1);
});


test('shared recovery controls preserve quarantine, uncertain steering, audio and frozen model routes', () => {
  const { sandbox } = harness(); const calls = [], notices = [];
  for (const item of [{ id:'uncertain', state:'unconfirmed' }, { id:'quarantined', state:'failed' }, { id:'sealed', body:{} }]) {
    const outbox = { get: () => item, quarantined: id => id === 'quarantined', retry: () => calls.push('retry') };
    sandbox.WosSettings.unsentAction({ outbox, editUnsent: () => calls.push('edit'), toast: (...args) => notices.push(args) }, item.id, 'app', 'edit');
    if (!item.body) sandbox.WosSettings.unsentAction({ outbox }, item.id, 'app', 'retry');
  }
  assert.deepEqual(calls, []);
  const opts = { chats: { ch: () => { throw Error('must retain before composer'); } }, wid:'x', outbox:{}, toast:()=>{} };
  for (const item of [{audio:{}}, {model:'original',provider:'original-provider'}]) {
    assert.equal(sandbox.WosSettings.moveDraft({...opts,item}), false);
  }
});

test('unsent Edit consumes only after the shared draft store verifies text and attachments', () => {
  const { sandbox } = harness(); const removed = [], notices = []; let saved;
  const state = { draft: '', files: [], draftFor: 'agentnew:private' };
  const chats = { ch: () => state, setDraft: (_wid, text, files) => { saved = { text, files }; } };
  sandbox.WosChat = { drafts: { get: () => saved } };
  const opts = { chats, wid: 'fixture', item: { id: 'fixture', text: 'retained words', files: [{ id: 'f1' }] }, outbox: { remove: id => removed.push(id) }, toast: (...a) => notices.push(a) };
  assert.equal(sandbox.WosSettings.moveDraft(opts), true); assert.deepEqual(removed, ['fixture']);
  sandbox.WosChat.drafts.get = () => ({ text: '', files: [] });
  assert.equal(sandbox.WosSettings.moveDraft(opts), false); assert.deepEqual(removed, ['fixture']); assert.equal(notices.length, 1);
});

// Look's new controls stay in the shared Settings stack; Back never navigates out of Wizard.
test('nested Look / skin tweaks Back returns to Settings before shell root Back, in both mounts', () => {
  const { sandbox, roots } = harness();
  sandbox.WosSkin = { current:'obsidian', list:[], families:[{ id:'mizel', name:'Mizel', tweaks:'miguel', palettes:['obsidian'] }], familyOf:()=>'mizel' };
  sandbox.WosExperience = { state:{owner:'miguel',busy:false,error:'',tweaks:[{id:'miguel/hidden-pin',name:'Hide pin buttons',description:'No pin button on chats',on:true}],active:['miguel/hidden-pin']} };
  for (const { root, view } of roots) {
    view.focus('look'); assert.equal(view.page,'appearance'); assert.match(root.innerHTML,/Mizel also changes how things work/); assert.match(root.innerHTML,/1 of 1 changes on/);
    assert.doesNotMatch(root.innerHTML,/Back to my setup|Try Miguel|Your tweaks|stop following/);
    assert.equal(view.back(), true); assert.equal(view.page,''); assert.equal(view.back(), false); assert.match(root.innerHTML,/Settings categories/);
  }
});
