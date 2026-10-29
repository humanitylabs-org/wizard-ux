import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const read = name => readFileSync(new URL('../web/core/' + name + '.js', import.meta.url), 'utf8');
function fixture(mobile = true) {
  const frames = new Map(), events = {}, listeners = {}, wins = {}, desks = [{ id: 'home', home: true, wins: [] }, { id: 'chat', wins: ['chat'], focus: 'chat' }];
  wins.chat = { id: 'chat', app: 'chats' };
  let count = 0;
  const s = { wins, desks, ws: desks, idx: 1, cur: 1, focus: 'chat',
    goDesk(i) { this.idx = i; }, goWs(i) { this.cur = i; },
    focusWin(id) { this.focus = id; (mobile ? desks[this.idx] : desks[this.cur]).focus = id; },
    reorderDesks(ids) { const old = desks.slice(); desks.splice(0, desks.length, old[0], ...ids.map(id => old.find(d => d.id === id))); },
    closeWin(id) { delete wins[id]; const f = frames.get(id); if (f) f.isConnected = false; for (const d of desks) d.wins = d.wins.filter(x => x !== id); },
  };
  function add(spec, opts = {}) {
    const id = 'win-' + (++count), w = wins[id] = { ...spec, id };
    const child = { document: {}, location: new URL(spec.url, 'https://wizard.example'), addEventListener() {}, postMessage(msg) { this.messages.push(msg); }, messages: [] };
    const el = { dataset: { win: id } };
    const f = { tagName: 'IFRAME', src: child.location.href, isConnected: true, contentWindow: child, get contentDocument() { return child.document; }, hasAttribute: () => false, closest: () => el,
      addEventListener(type, fn) { listeners[id + type] = fn; }, removeEventListener(type) { delete listeners[id + type]; } };
    frames.set(id, f);
    if (mobile) { desks.push({ id, wins: [id], focus: id }); s.idx = desks.length - 1; }
    else desks[opts.ws ?? s.cur].wins.push(id);
    if (window.WizAppServices) window.WizAppServices.attach(f, { appId: spec.servicesAs || spec.appId, path: '/sketch/' });
    return w;
  }
  s.openWin = s.newWin = add;
  const location = new URL('https://wizard.example/wizard-os-home/');
  const window = { [mobile ? '__wos' : '__wux']: s, dispatchEvent(e) { for (const fn of events[e.type] || []) fn(e); }, WizCore: { apps: () => ({ APPS: [{ id: 'sketch', kind: 'wizard', url: '/sketch/' }] }) } };
  const document = { hidden: false, readyState: 'loading', addEventListener() {}, querySelector(sel) { const id = sel.match(/data-win="([^"]+)"/)?.[1]; return frames.get(id); } };
  const context = vm.createContext({ window, document, location, URL, console, setInterval() {}, setTimeout, clearTimeout, CustomEvent: class { constructor(type, opts) { this.type = type; this.detail = opts?.detail; } }, addEventListener(type, fn) { (events[type] ||= []).push(fn); } });
  vm.runInContext(read('app-services'), context); vm.runInContext(read('companion-pane'), context);
  const owner = add({ app: 'frame', appId: 'sketch', url: '/sketch/' });
  const ownerFrame = frames.get(owner.id), service = window.WizAppServices.connect(ownerFrame.contentWindow, { back: () => false });
  return { s, frames, owner, ownerFrame, service, pane: window.WizCompanionPane, host: window.WizAppServices, listeners, events, context };
}
for (const mobile of [true, false]) {
  test(`${mobile ? 'phone' : 'desktop'} generic companion uses one layout implementation and stays bound`, () => {
    const f = fixture(mobile), peer = f.service.shell.openCompanion({ path: '?pane=notes', title: 'Notes', share: 0.26, ownerShare: 0.46, data: { item: 'a' } });
    assert.ok(peer.id); assert.equal(f.s.wins[peer.id].servicesAs, 'sketch');
    if (mobile) assert.deepEqual(f.s.desks.slice(1).map(d => d.wins[0]), ['chat', f.owner.id, peer.id]);
    else { assert.equal(f.owner.share, 0.46); assert.equal(f.s.wins[peer.id].share, 0.26); }
    const same = f.service.shell.openCompanion({ path: '?pane=notes', data: { item: 'b' } }); assert.equal(same.id, peer.id);
    const pf = f.frames.get(peer.id), svc = f.host.connect(pf.contentWindow, { back: () => false }); svc.ready();
    assert.equal(pf.contentWindow.messages.at(-1).data.item, 'b');
    assert.equal(svc.shell.postCompanion({ note: 'reply' }), true);
    assert.equal(f.ownerFrame.contentWindow.messages.at(-1).from, 'companion');
    assert.equal(f.ownerFrame.contentWindow.messages.at(-1).data.note, 'reply');
    assert.equal(f.pane.back(peer.id), true); assert.equal(f.s.focus, f.owner.id);
    assert.equal(f.service.shell.closeCompanion(), true); assert.equal(f.s.wins[peer.id], undefined); assert.equal(f.owner.share, undefined);
  });
  test(`${mobile ? 'phone' : 'desktop'} nested Back returns companion to owner without closing shell`, () => {
    const f = fixture(mobile), peer = f.service.shell.openCompanion({ path: '?pane=notes', focus: true });
    let depth = 1;
    const pf = f.frames.get(peer.id); f.host.connect(pf.contentWindow, { back: () => depth > 0 ? (depth--, true) : false });
    assert.equal(f.host.back(pf), 'handled'); assert.equal(depth, 0); assert.equal(f.s.focus, peer.id);
    assert.equal(f.host.back(pf), 'atRoot'); assert.equal(f.pane.back(peer.id), true); assert.equal(f.s.focus, f.owner.id);
    assert.ok(f.s.wins[f.owner.id]); assert.ok(f.s.wins[peer.id]);
  });
}
test('companion targets cannot escape installed app prefix', () => {
  const f = fixture();
  for (const path of ['https://other.example/sketch/', '/secrets/', '/sketch/../admin/', '/sketch/%2e%2e/admin', '/sketch/%252e/admin', '/sketch/%2fadmin', 'javascript:alert(1)', '/sketch-other/', 'https://user:pass@wizard.example/sketch/'])
    assert.throws(() => f.service.shell.openCompanion({ path }), undefined, path);
  assert.equal(f.pane.inspect().length, 0);
});
test('stale, off-path, detached and unregistered senders cannot act', () => {
  for (const change of [f => { f.ownerFrame.contentWindow.document = {}; }, f => { f.ownerFrame.contentWindow.location = new URL('https://wizard.example/foreign/'); }, f => { f.ownerFrame.isConnected = false; }]) {
    const f = fixture(); change(f); assert.throws(() => f.service.shell.openCompanion({ path: '?pane=x' }));
  }
  const f = fixture(); assert.equal(f.host.connect({}), null);
});
test('relay is restricted to the bound pair; nesting, oversize messages and shares rejected', () => {
  const f = fixture(), peer = f.service.shell.openCompanion({ path: '?pane=notes' });
  const other = f.s.openWin({ app: 'frame', appId: 'sketch', url: '/sketch/' });
  const svc = f.host.connect(f.frames.get(other.id).contentWindow, {});
  assert.equal(svc.shell.postCompanion({ stolen: true }), false);
  const ps = f.host.connect(f.frames.get(peer.id).contentWindow, {});
  assert.throws(() => ps.shell.openCompanion({ path: '?pane=nested' }));
  assert.throws(() => f.service.shell.postCompanion('x'.repeat(32769)));
  assert.throws(() => f.service.shell.openCompanion({ path: '?pane=notes', share: NaN }));
});
test('owner unload revokes pair and stale relay, restores previous width', () => {
  const f = fixture(false); f.owner.share = 0.55;
  const peer = f.service.shell.openCompanion({ path: '?pane=notes', ownerShare: 0.46 });
  f.ownerFrame.contentWindow.document = {}; f.host.update.frames();
  assert.equal(f.s.wins[peer.id], undefined); assert.equal(f.owner.share, 0.55);
  assert.throws(() => f.service.shell.postCompanion({ stale: true }));
});
test('both shells load the generic module, legacy adapter only names old app, and root Back calls the shared pair', () => {
  const pane = read('companion-pane'); assert.doesNotMatch(pane, /video-editor|Feedback|WizVideoDesks/);
  for (const [entry, script] of [['index.html', 'app.js'], ['desktop.html', 'desktop/desktop.js']]) {
    const html = readFileSync(new URL('../web/' + entry, import.meta.url), 'utf8');
    assert.match(html, /core\/companion-pane.js/); assert.match(html, /core\/companion-legacy.js/); assert.doesNotMatch(html, /video-desks/);
    assert.match(readFileSync(new URL('../web/' + script, import.meta.url), 'utf8'), /WizCompanionPane\?\.back\(f.id\)/);
  }
});
