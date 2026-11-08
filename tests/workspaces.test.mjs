import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const source = read('web/core/workspaces.js');
const plain = x => JSON.parse(JSON.stringify(x));
class El extends EventTarget {
  constructor(tag) { super(); this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.attrs = {}; this.style = {}; this.textContent = ''; this.namespaceURI = 'http://www.w3.org/2000/svg'; this.className = ''; this.classList = { add: s => { this.className += ' ' + s; }, toggle: (s, on) => { this.className = this.className.split(' ').filter(x => x !== s).concat(on ? [s] : []).join(' '); } }; }
  append(...nodes) { for (const n of nodes) { n.remove(); n.parentNode = this; this.children.push(n); } }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  removeAttribute(k) { delete this.attrs[k]; }
  toggleAttribute(k, on) { if (on) this.setAttribute(k, ''); else this.removeAttribute(k); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(n => n !== this); this.parentNode = null; }
  contains(n) { return n === this || this.children.some(c => c.contains(n)); }
  focus() { this.focused = true; }
  getBoundingClientRect() { return { left: 12, top: 12, bottom: 56, width: 44, height: 44 }; }
  querySelectorAll(s) { const all = this.children.flatMap(n => [n, ...n.querySelectorAll('*')]); return all.filter(n => s === '*' || s === n.tagName.toLowerCase() || (s.startsWith('.') && n.className.split(' ').includes(s.slice(1))) || (s.startsWith('[data-workspace-id=') && n.dataset.workspaceId === s.match(/="([^"]+)"/)[1])); }
  querySelector(s) { return this.querySelectorAll(s)[0] || null; }
}
function boot({ native = false, items = [], devices = { this: { wizard: 'Local Wizard' }, devices: [], managed: [] }, local = [], shell = 'desktop', call, hash = '' } = {}) {
  const win = new EventTarget(), body = new El('body'), html = new El('html'), slot = new El('div'), data = new Map([['wos.workspaces.v1', JSON.stringify(local)]]), stack = [], toasts = [], calls = [], nav = [], replaced = [], hooks = {};
  const document = { body, documentElement: html, createElement: tag => new El(tag), createElementNS: (_ns, tag) => new El(tag), querySelector: () => slot, querySelectorAll: () => [], getElementById: () => body };
  const host = { env: { shell }, route: () => ({ view: 'desk', desk: 0 }), on: (k, fn) => { hooks[k] = fn; }, listen: (el, k, fn) => el.addEventListener(k, fn), mount: n => body.append(n), toast: x => toasts.push(x), back: { push(fn) { stack.push(fn); return () => { const at = stack.indexOf(fn); if (at >= 0) stack.splice(at, 1); }; } } };
  let setup;
  win.wizardUX = { native: { workspaces: native } };
  win.WizCore = { bridge: { call: async (method, params) => { calls.push({ method, params }); return call ? call(method, params) : method === 'workspaces.list' ? { active: items[0]?.id, items } : { ok: true }; } } };
  win.WosResources = { state: { devices } };
  win.WosSkinHost = { builtin: (_id, fn) => { setup = fn; } };
  win.WosSettings = { register: f => { assert.equal(typeof f.html, 'function'); win.settings = f; } };
  win.innerWidth = 1280;
  const storage = { getItem: k => data.get(k), setItem: (k, v) => data.set(k, v) };
  const custom = class extends Event { constructor(k, opts) { super(k); this.detail = opts.detail; } };
  vm.runInNewContext(source, { window: win, document, localStorage: storage, location: { origin: 'https://here.test', hostname: 'here.test', pathname: '/wizard-os-home/', search: '', hash, assign: x => nav.push(x) }, history: { state: null, replaceState: (_s, _t, u) => { replaced.push(u); } }, URL, CustomEvent: custom, AbortController, AbortSignal, CSS: { escape: v => v }, crypto: { randomUUID }, fetch: () => { throw new Error('fixture must not fetch'); }, setTimeout: () => { throw new Error('no idle timers'); }, setInterval: () => { throw new Error('no polling'); } });
  return { w: win.WizWorkspaces, start: () => setup(host), win, body, slot, stack, toasts, calls, nav, data, hooks, replaced };
}
const remote = (id = 'other', extra = {}) => ({ id, name: 'Other Wizard', url: 'https://other.test', kind: 'remote', status: 'ready', ...extra });
const managed = (extra = {}) => remote('managed', { kind: 'managed', role: 'technical-admin', org: 'Example group', ...extra });
test('one Wizard: hidden stock control; two: icon only, for desktop and phone', async () => {
  for (const shell of ['desktop', 'phone']) {
    const b = boot({ shell }); const stop = b.start(); await b.w.list();
    const control = (shell === 'desktop' ? b.slot : b.body).querySelector('button');
    assert.equal(control.hidden, true);
    await b.w.add({ name: 'Second', url: 'http://private-box:8923' });
    assert.equal(control.hidden, false); assert.equal(control.textContent, ''); assert.equal(control.querySelectorAll('svg').length, 1);
    assert.match(control.getAttribute('aria-label'), /Local Wizard/); stop();
  }
});
test('native list renders active check, status, role and grouping', async () => {
  const b = boot({ native: true, items: [remote('mac', { name: 'My Mac', kind: 'this-mac' }), managed()] });
  b.start(); await b.w.list(); b.w.openMenu(b.slot.querySelector('button'));
  const panel = b.body.querySelector('.wz-workspaces-panel');
  assert.equal(panel.querySelectorAll('[data-workspace-id="mac"]')[0].getAttribute('aria-checked'), 'true');
  assert.equal(panel.querySelectorAll('h3')[0].textContent, 'My Wizards');
  assert.equal(panel.querySelectorAll('h3')[1].textContent, 'Managed · Example group');
  assert.match(panel.querySelectorAll('small')[1].textContent, /Technical Admin/);
});
test('web fallback merges devices managed before per-device saved entries; no duplicates', async () => {
  const b = boot({ devices: { this: { wizard: 'Local' }, managed: [managed(), managed({ id: 'not-ready', url: '' })] }, local: [remote(), remote('duplicate', { url: 'https://other.test' })] });
  const state = await b.w.list();
  assert.deepEqual(plain(state.items.map(v => v.id)), ['this', 'managed', 'not-ready']);
  assert.equal(state.items.find(v => v.id === 'not-ready').url, '');
  const c = boot({ devices: { managed: [managed()] }, local: [remote('saved', { url: 'https://saved.test' })] });
  assert.deepEqual(plain((await c.w.list()).items.map(v => v.id)), ['this', 'managed', 'saved']);
});
test('group only when both My and Managed exist; organization is display-only', async () => {
  const b = boot(); await b.w.list();
  assert.equal(b.w.groups([managed()])[0].label, '');
  assert.equal(b.w.groups([remote()])[0].label, '');
  assert.deepEqual(plain(b.w.groups([remote(), managed()]).map(v => v.label)), ['My Wizards', 'Managed · Example group']);
});
test('switch synchronously marks retained menu item busy+active and closes before native resolves', async () => {
  let resolve;
  const b = boot({ native: true, items: [remote('one'), remote('two')], call: method => method === 'workspaces.list' ? { active: 'one', items: [remote('one'), remote('two')] } : new Promise(r => { resolve = r; }) });
  b.start(); await b.w.list(); b.w.openMenu(b.slot.querySelector('button'));
  const row = b.body.querySelector('[data-workspace-id="two"]'), p = b.w.switch('two');
  assert.equal(b.body.querySelector('.wz-workspaces-panel'), null);
  assert.equal(row.getAttribute('aria-busy'), 'true'); assert.equal(row.getAttribute('aria-checked'), 'true');
  assert.equal(b.w.snapshot().active, 'two'); assert.equal(b.stack.length, 0);
  assert.equal(b.slot.querySelector('button').getAttribute('aria-busy'), 'true');
  assert.deepEqual(plain(b.calls.at(-1)), { method: 'workspaces.switch', params: { id: 'two' } });
  resolve({ ok: true }); await p;
});
test('failed native switch rolls back and toasts, no navigation', async () => {
  const b = boot({ native: true, items: [remote('one'), remote('two')], call: method => method === 'workspaces.list' ? { active: 'one', items: [remote('one'), remote('two')] } : Promise.reject(new Error('offline')) });
  b.start(); await b.w.list(); await assert.rejects(b.w.switch('two'), /offline/);
  assert.equal(b.w.snapshot().active, 'one'); assert.equal(b.toasts.length, 1); assert.equal(b.nav.length, 0);
});
test('navigation fallback keeps shell path only for an origin, drops current query/thread state', async () => {
  const b = boot({ local: [remote()] }); await b.w.list(); await b.w.switch('other');
  assert.equal(b.nav.length, 1); assert.match(b.nav[0], /^https:\/\/other\.test\/wizard-os-home\/#wzfrom=/);
  assert.equal(b.w.destination('http://private-box:8923'), 'http://private-box:8923/wizard-os-home/');
  assert.equal(b.w.destination('https://other.test/a/'), 'https://other.test/a/');
});
test('add validates http/https, credentials, name, duplicates and storage; rename/remove only forget', async () => {
  const b = boot(); await b.w.list();
  for (const url of ['javascript:alert(1)', 'file:///tmp', 'ftp://box', 'box', 'https://user:pass@box']) await assert.rejects(b.w.add({ name: 'No', url }), /http/);
  await assert.rejects(b.w.add({ url: 'https://other.test', name: ' ' }), /name/);
  await b.w.add({ url: 'http://private-box:8923', name: 'Private computer' });
  const entry = b.w.snapshot().items.at(-1); assert.equal(entry.kind, 'remote');
  await assert.rejects(b.w.add({ url: entry.url, name: 'Duplicate' }), /already/);
  await b.w.rename(entry.id, 'Renamed'); assert.equal(b.w.snapshot().items.at(-1).name, 'Renamed');
  await b.w.remove(entry.id); assert.equal(b.w.snapshot().items.length, 1);
  assert.deepEqual(JSON.parse(b.data.get('wos.workspaces.v1')), []);
  await assert.rejects(b.w.remove('this'), /at least one/);
});
test('native add, rename, remove call bridge; last removal is refused without bridge call', async () => {
  const b = boot({ native: true, items: [remote('one'), remote('two')] }); await b.w.list();
  await b.w.add(); await b.w.rename('two', 'New name'); await b.w.remove('two');
  for (const action of ['add', 'rename', 'remove']) assert.ok(b.calls.some(c => c.method === 'workspaces.' + action));
  const only = boot({ native: true, items: [remote('one')] }); await only.w.list();
  await assert.rejects(only.w.remove('one'), /at least one/); assert.equal(only.calls.length, 1);
});
test('no URL stays greyed and explains why, never switches or navigates', async () => {
  const b = boot({ devices: { managed: [managed({ url: '' })] } }); b.start(); await b.w.list(); b.w.openMenu(b.slot.querySelector('button'));
  const row = b.body.querySelector('[data-workspace-id="managed"]');
  assert.equal(row.getAttribute('aria-disabled'), 'true'); row.dispatchEvent(new Event('click'));
  assert.match(b.body.querySelector('.wz-workspaces-why').textContent, /isn’t running Wizard yet/);
  await assert.rejects(b.w.switch('managed'), /isn’t running/); assert.equal(b.nav.length, 0);
});
test('menu Back registration and teardown stay bounded across 100 opens', async () => {
  const b = boot({ local: [remote()] }); const stop = b.start(); await b.w.list();
  for (let i = 0; i < 100; i++) { b.w.openMenu(b.slot.querySelector('button')); assert.equal(b.stack.length, 1); b.stack.at(-1)(); assert.equal(b.stack.length, 0); }
  stop(); assert.equal(b.body.children.length, 0);
});
test('native event refresh and web storage events use bounded state without timers', async () => {
  const b = boot({ native: true, items: [remote('one')] }); await b.w.list();
  const event = new Event('wizard:workspaces'); event.detail = { active: 'two', items: [remote('one'), remote('two')] }; b.win.dispatchEvent(event);
  assert.equal(b.w.snapshot().active, 'two'); assert.equal(b.w.visible, true);
  const many = boot({ local: Array.from({ length: 1000 }, (_, i) => remote('id-' + i, { url: 'https://box-' + i + '.test' })) });
  await many.w.list(); assert.equal(many.w.snapshot().items.length, 100);
  const off = many.w.subscribe(() => {}); off();
});
test('registry read path preserves validated workspace address, kind and role', async () => {
  const { cleanRegistry } = await import('../tools/system-devices.mjs');
  const result = cleanRegistry({ managed: [managed({ id: 'team', kind: 'company', url: 'http://private-box:8923' }), managed({ id: 'unsafe', url: 'javascript:alert(1)' })] }).managed;
  assert.equal(result[0].url, 'http://private-box:8923/'); assert.equal(result[0].kind, 'company'); assert.equal(result[0].role, 'technical-admin');
  assert.equal(result[1].url, undefined);
});
test('another Wizard of the same owner (kind remote) lists under My Wizards, switchable', async () => {
  const { cleanRegistry } = await import('../tools/system-devices.mjs');
  const reg = cleanRegistry({ managed: [{ id: 'wizard-james', name: 'WizardOS 2', kind: 'remote', url: 'https://wizard-james.example.ts.net:8796/wizard-os-home/', role: 'owner' }] });
  assert.equal(reg.managed[0].kind, 'remote');
  const b = boot({ devices: reg });
  const state = await b.w.list();
  const it = state.items.find(v => v.id === 'wizard-james');
  assert.equal(it.kind, 'remote'); assert.equal(it.name, 'WizardOS 2'); assert.equal(b.w.groups(state.items)[0].label, '');
  await b.w.switch('wizard-james'); assert.equal(b.nav.length, 1); assert.match(b.nav[0], /^https:\/\/wizard-james\.example\.ts\.net:8796\/wizard-os-home\/#wzfrom=/);
});
test('switching carries a safe way back; the target saves it once and strips the hash', async () => {
  const a = boot({ local: [remote()], devices: { this: { wizard: 'WizardOS 1' } } }); await a.w.list(); await a.w.switch('other');
  const hash = new URL(a.nav[0]).hash;
  const carried = JSON.parse(decodeURIComponent(hash.slice('#wzfrom='.length)));
  assert.deepEqual(plain(carried), { name: 'WizardOS 1', url: 'https://here.test/wizard-os-home/' });
  const b = boot({ hash }); // the target Wizard (its own origin is simulated by a different saved list)
  assert.deepEqual(b.replaced, ['/wizard-os-home/']);
  assert.deepEqual(JSON.parse(b.data.get('wos.workspaces.v1')).map(v => v.url), []);  // same origin as itself: never saved
  const c = boot({ hash: '#wzfrom=' + encodeURIComponent(JSON.stringify({ name: 'WizardOS 1', url: 'https://first.test/wizard-os-home/' })) });
  const saved = JSON.parse(c.data.get('wos.workspaces.v1')); assert.equal(saved.length, 1); assert.equal(saved[0].name, 'WizardOS 1'); assert.equal(saved[0].url, 'https://first.test/wizard-os-home/');
  assert.deepEqual(plain((await c.w.list()).items.map(v => v.name)), ['Local Wizard', 'WizardOS 1']);
  const bad = boot({ hash: '#wzfrom=' + encodeURIComponent(JSON.stringify({ name: 'X', url: 'javascript:alert(1)' })) });
  assert.equal(bad.data.get('wos.workspaces.v1'), '[]');
  const junk = boot({ hash: '#wzfrom=%E0%A4%A' }); assert.equal(junk.data.get('wos.workspaces.v1'), '[]');
});
test('both shells load module; bridge.handle preserves native capability; Miguel reuses only core switcher', () => {
  for (const f of ['web/index.html', 'web/desktop.html']) assert.match(read(f), /core\/workspaces.js/);
  assert.match(read('web/core/bridge.js'), /window.wizardUX = \{ \.\.\.window.wizardUX,/);
  const tweak = read('web/tweaks/miguel/machines-home/tweak.js');
  assert.match(tweak, /api.workspaces.switch\(d.ws\)/); assert.match(tweak, /api.workspaces.add\(\)/);
  assert.doesNotMatch(tweak, /wizMenu|wizBtn|wsmBack|renderWiz/);
  assert.match(source, /api\?\.back.push\(close\)/);
});
