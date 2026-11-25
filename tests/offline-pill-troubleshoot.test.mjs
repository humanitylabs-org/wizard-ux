// Issue 1472: during an outage the "Can't reach Wizard" pill must offer the Troubleshooter in one tap.
// The pill's Troubleshoot button ([data-wxtroubleshoot]) is the only visible way to the Troubleshooter while
// Wizard is unreachable. It was lost once (ux#727 + ux#927); this test fails if a pill redesign drops it again.
import { runWithChatsModel } from './fixtures/chats-list-model.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../web/core/status.js', import.meta.url), 'utf8');

function setup({ online = true, calm = false, shellWindows = false, status = null } = {}) {
  const events = {}, timers = new Map(), nodes = new Map();
  let tid = 0, clock = 1e6;
  const element = () => ({ classList: { toggle() {} }, dataset: {}, handlers: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(name, fn) { this.handlers[name] = fn; }, appendChild(el) { nodes.set(el.id, el); } });
  const L = { ok: false, at: 0, error: '', sessions: [], listeners: [], refresh() {}, onChange(fn) { this.listeners.push(fn); }, emit() { this.listeners.forEach(fn => fn()); } };
  const ctx = {
    navigator: { onLine: online },
    document: { hidden: false, body: element(), documentElement: element(), getElementById(id) { return nodes.get(id); }, createElement: element, addEventListener(name, fn) { (events['doc:' + name] ||= []).push(fn); } },
    getComputedStyle: () => ({ getPropertyValue: k => (k === '--wos-calm-offline' && calm ? ' on' : '') }),
    addEventListener(name, fn) { (events[name] ||= []).push(fn); },
    setTimeout(fn) { timers.set(++tid, fn); return tid; }, clearTimeout(id) { timers.delete(id); }, setInterval() {}, clearInterval() {},
    // The Troubleshooter's own status (/troubleshoot/api/status): unreachable unless a test says what it answers.
    fetch: async url => { if (status && String(url).startsWith('/troubleshoot/api/status')) return { ok: true, json: async () => ({ overall: status() }) }; throw new Error('unreachable'); }, console,
    Date: class extends Date { constructor(...a) { super(...(a.length ? a : [clock])); } static now() { return clock; } },
  };
  ctx.window = ctx; ctx.WizLive = L;
  ctx.WizReach = { opened: 0, auto: 0, checked: 0, failure: () => ({ message: 'Can’t reach Wizard.', short: 'Can’t reach Wizard' }), open(o) { this.opened++; if (o?.auto) this.auto++; }, async checks() { this.checked++; return null; } };
  if (shellWindows) ctx.WizOpenApp = () => true;
  runWithChatsModel(source, ctx); ctx.WizCore.status.attach({});
  return {
    ctx, L, nodes,
    banner: () => nodes.get('wxBanners'),
    event(name, e = {}) { (events[name] || []).forEach(fn => fn(e)); },
    advance(ms) { clock += ms; const fns = [...timers.values()]; timers.clear(); for (const fn of fns) fn(); ctx.WizCore.status.refresh(); },
    hide(hidden) { ctx.document.hidden = hidden; (events['doc:visibilitychange'] || []).forEach(fn => fn({})); },
    click(attr) { this.banner().handlers.click({ target: { closest: sel => (sel === attr ? {} : null) } }); },
  };
}

// The auto-open asks /troubleshoot/api/status first (issue 1828): let that answer land.
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); };

function goDown(h, kind) {
  h.L.ok = true; h.L.at = 1; h.L.emit();
  if (kind === 'offline') { h.ctx.navigator.onLine = false; h.event('offline'); }
  else { h.L.ok = false; h.L.error = 'offline'; h.L.errorAt = 2; h.L.emit(); }
}

for (const calm of [false, true]) for (const kind of ['offline', 'reconnecting']) {
  test(`${kind} pill after the grace offers Troubleshoot that opens the Troubleshooter (calm ${calm ? 'on' : 'off'})`, () => {
    const h = setup({ calm });
    goDown(h, kind);
    // A blip shorter than the grace shows nothing at all.
    assert.ok(!h.banner()?.innerHTML?.includes('data-wxtroubleshoot'), 'no pill during the grace');
    h.advance(8100);
    assert.equal(h.ctx.WizCore.status.state.net, kind);
    const html = h.banner().innerHTML;
    assert.match(html, new RegExp(`data-wxnet="${kind}"`));
    assert.match(html, /<button type="button" data-wxtroubleshoot[^>]*>Troubleshoot<\/button>/, 'pill shows a visible Troubleshoot button');
    h.click('[data-wxtroubleshoot]');
    assert.equal(h.ctx.WizReach.opened, 1, 'Troubleshoot opens the real Troubleshooter (WizReach.open)');
    assert.equal(h.nodes.get('wxOffline'), undefined, 'Troubleshoot does not open the checks card');
    assert.equal(h.ctx.WizReach.checked, 0);
  });
}

test('without shell windows the pill never opens anything by itself (never leaves the shell for the bare page)', () => {
  const h = setup();
  goDown(h, 'reconnecting'); h.advance(8100); h.advance(60000);
  assert.equal(h.ctx.WizReach.opened, 0);
  assert.equal(h.nodes.get('wxOffline'), undefined);
  assert.equal(h.ctx.WizCore.status.state.offline, 'pill');
});

// owner-correction: humanitylabs-org/wizard-ux#1472 · 2026-11-15 · "It should pop up."
for (const calm of [false, true]) for (const kind of ['offline', 'reconnecting']) {
  test(`when Wizard can't be reached, the Troubleshooter pops up on its own (${kind}, calm ${calm ? 'on' : 'off'})`, async () => {
    const h = setup({ calm, shellWindows: true });
    goDown(h, kind);
    h.advance(kind === 'offline' ? 1000 : 4000);
    assert.equal(h.ctx.WizReach.opened, 0, 'a blip shorter than the grace opens nothing');
    h.advance(8100); await flush();
    assert.equal(h.ctx.WizReach.opened, 0, 'a blip shorter than the grace opens nothing');
    h.advance(60000); await flush();
    assert.equal(h.ctx.WizReach.auto, 1, 'past the grace the Troubleshooter opens by itself');
    assert.equal(h.nodes.get('wxOffline'), undefined, 'the real Troubleshooter, not the checks card');
    // Closed by the owner, it stays closed for the rest of the outage; the pill's button still reopens it.
    h.advance(60000); await flush(); h.advance(60000); await flush();
    assert.equal(h.ctx.WizReach.opened, 1, 'once per outage');
    h.click('[data-wxtroubleshoot]');
    assert.equal(h.ctx.WizReach.opened, 2); assert.equal(h.ctx.WizReach.auto, 1);
  });
}

test('a short blip that heals inside the grace never opens the Troubleshooter', () => {
  const h = setup({ shellWindows: true });
  goDown(h, 'reconnecting'); h.advance(3000);
  h.L.ok = true; h.L.error = ''; h.L.at = 10; h.L.emit();
  h.advance(10000); h.advance(10000);
  assert.equal(h.ctx.WizReach.opened, 0);
});

test('a flapping Wizard does not bring a closed Troubleshooter back within 10 minutes', async () => {
  const h = setup({ shellWindows: true });
  goDown(h, 'reconnecting'); h.advance(8100); h.advance(60000); await flush();
  assert.equal(h.ctx.WizReach.auto, 1);
  h.L.ok = true; h.L.error = ''; h.L.at = 10; h.L.emit(); h.advance(3000);
  assert.equal(h.ctx.WizCore.status.state.net, 'online');
  h.L.ok = false; h.L.error = 'offline'; h.L.errorAt = 20; h.L.emit(); h.advance(8100); h.advance(60000); await flush(); h.advance(60000); await flush();
  assert.equal(h.ctx.WizReach.auto, 1, 'second outage two minutes later: no second pop-up');
  h.L.ok = true; h.L.error = ''; h.L.at = 30; h.L.emit(); h.advance(3000);
  h.advance(11 * 60e3);
  h.L.ok = false; h.L.error = 'offline'; h.L.errorAt = 40; h.L.emit(); h.advance(8100); h.advance(60000); await flush();
  assert.equal(h.ctx.WizReach.auto, 2, 'a new outage after 10 minutes pops it up again');
});

test('the Troubleshooter waits while a voice note or capture is recording', async () => {
  const h = setup({ shellWindows: true });
  h.ctx.WizAppCapture = { getState: () => ({ recording: true }) };
  goDown(h, 'reconnecting'); h.advance(8100); h.advance(60000); h.advance(5000); await flush();
  assert.equal(h.ctx.WizReach.opened, 0);
  h.ctx.WizAppCapture = null; h.advance(1200); await flush();
  assert.equal(h.ctx.WizReach.auto, 1, 'opens once the recording ends');
});

// Issue 1828: a routine Agent Service deploy restarts it for ~20 s, plus a slow first read (51 s on 25 Nov). The owner
// sees the pill, never the Troubleshooter popping open by itself.
for (const seconds of [25, 51]) for (const answer of ['down', 'ok']) {
  test(`a ${seconds} s Agent Service restart shows the pill but never opens the Troubleshooter (status ${answer})`, async () => {
    const h = setup({ shellWindows: true, status: () => answer });
    goDown(h, 'reconnecting');
    let pill = false;
    for (let t = 0; t < seconds; t++) { h.advance(1000); await flush(); pill ||= h.ctx.WizCore.status.state.offline === 'pill'; }
    h.L.ok = true; h.L.error = ''; h.L.at = 10; h.L.emit(); h.advance(3000); await flush();
    if (answer === 'down') assert.ok(pill, 'the pill with its Troubleshoot button showed during the restart');
    assert.equal(h.ctx.WizReach.auto, 0, 'no auto-open for a planned self-healing restart');
    assert.equal(h.ctx.WizReach.opened, 0);
  });
}

test('while the Troubleshooter says everything is ok, it never opens by itself', async () => {
  const h = setup({ shellWindows: true, status: () => 'ok' });
  goDown(h, 'reconnecting');
  for (let t = 0; t < 30; t++) { h.advance(5000); await flush(); }
  assert.equal(h.ctx.WizReach.auto, 0);
});

test('a real outage the Troubleshooter also sees opens it once, after about a minute', async () => {
  const h = setup({ shellWindows: true, status: () => 'down' });
  goDown(h, 'reconnecting');
  h.advance(55000); await flush();
  assert.equal(h.ctx.WizReach.auto, 0, 'not inside the first minute');
  h.advance(6000); await flush();
  assert.equal(h.ctx.WizReach.auto, 1, 'after a minute of outage');
  h.advance(60000); await flush();
  assert.equal(h.ctx.WizReach.auto, 1, 'once per outage');
});

test('time with the page hidden does not count toward the grace or the auto-open', async () => {
  const h = setup({ shellWindows: true, status: () => 'down' });
  goDown(h, 'reconnecting'); h.advance(1000);
  h.hide(true); h.advance(70000); h.advance(70000); await flush();
  assert.equal(h.ctx.WizReach.opened, 0, 'nothing opens while hidden');
  h.hide(false); h.ctx.WizCore.status.refresh(); await flush();
  assert.equal(h.ctx.WizCore.status.state.offline, '', 'back in front: no pill on the first render');
  assert.equal(h.ctx.WizReach.auto, 0, 'back in front: no Troubleshooter on the first render');
  h.advance(8100); await flush();
  assert.equal(h.ctx.WizCore.status.state.offline, 'pill', 'the pill after the grace, counted from the return');
  assert.equal(h.ctx.WizReach.auto, 0);
  h.advance(52000); await flush();
  assert.equal(h.ctx.WizReach.auto, 1, 'a minute of visible outage still opens it');
});

test('a read that failed while hidden starts its grace when the page comes back', async () => {
  const h = setup({ shellWindows: true, status: () => 'down' });
  h.L.ok = true; h.L.at = 1; h.L.emit();
  h.hide(true); h.L.ok = false; h.L.error = 'offline'; h.L.errorAt = 2; h.L.emit(); h.advance(90000); await flush();
  h.hide(false); h.ctx.WizCore.status.refresh(); await flush();
  assert.equal(h.ctx.WizCore.status.state.offline, '', 'no pill at once');
  assert.equal(h.ctx.WizReach.auto, 0, 'no Troubleshooter at once');
});
