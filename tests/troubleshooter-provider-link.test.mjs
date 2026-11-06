import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../web/core/reach.js', import.meta.url), 'utf8');
function mount(url) {
  const calls = [], timers = new Map(), handlers = {}; let id = 0;
  const frame = { hidden: true, addEventListener(type, fn) { handlers[type] = fn; }, getAttribute() { return this.src; }, contentDocument: { location: { pathname: '/troubleshoot/' }, querySelector() { return {}; } } };
  const details = { open: true }, button = { addEventListener() {} }, message = {}, rows = {}, remote = {};
  const elements = { iframe: frame, details, '[data-recovery-check]': button, '[data-recovery-message]': message, '[data-recovery-rows]': rows, '[data-recovery-remote]': remote };
  const root = { isConnected: true, classList: { add() {}, remove() {} }, querySelector(selector) { assert.ok(elements[selector], selector); return elements[selector]; } };
  const context = { navigator: { onLine: true }, document: { hidden: false }, location: { hostname: 'wizard.test' }, Date, Event, AbortController,
    requestAnimationFrame(fn) { fn(); }, setTimeout(fn, ms) { timers.set(++id, { fn, ms }); return id; }, clearTimeout(id) { timers.delete(id); }, dispatchEvent() {},
    fetch: async (url, options) => { calls.push([url, options]); return { ok: true, status: 200, json: async () => ({ overall: 'ok', checks: [] }) }; } };
  context.window = context; vm.runInNewContext(source, context);
  context.WizReach.mountRecovery(root, url);
  return { calls, frame, details, timers, handlers };
}
for (const provider of ['claude', 'chatgpt']) test(`provider reconnect keeps ${provider} and exact run query after local checks`, async () => {
  const url = `/troubleshoot/?provider=${provider}&run_id=run%2Fone&return=%2Fwizard-os-home%2F#signin`;
  const h = mount(url);
  assert.equal(h.calls.length, 0, 'local recovery paints before network'); assert.equal(h.frame.src, undefined);
  const pending = [...h.timers.values()].find(t => t.ms === 0); assert.ok(pending); pending.fn();
  for (let i = 0; i < 80; i++) await Promise.resolve();
  assert.equal(h.frame.src, url, 'the requested sign-in workflow, not generic repair home');
  assert.deepEqual(h.calls.filter(([, opts]) => opts.method === 'HEAD').map(([path]) => path), [url]);
  assert.ok(h.calls.every(([, opts]) => ['GET', 'HEAD', undefined].includes(opts.method)), 'never starts sign-in or repair writes');
  h.handlers.load(); assert.equal(h.frame.hidden, false); assert.equal(h.details.open, false);
});
test('generic recovery stays generic and foreign targets never become frame URLs', async () => {
  for (const url of [undefined, 'https://example.com/troubleshoot/?provider=claude', '//example.com/troubleshoot/']) {
    const h = mount(url); [...h.timers.values()].find(t => t.ms === 0).fn();
    for (let i = 0; i < 80; i++) await Promise.resolve();
    assert.equal(h.frame.src, '/troubleshoot/');
  }
});
test('phone persists the sign-in anchor through a successful frame load and remount', async () => {
  const phone = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  const begin = phone.indexOf('    try { if (W[id]) { const here =', phone.indexOf('function bridgeFrame(f)'));
  const end = phone.indexOf('    try { win.document.addEventListener', begin);
  assert.ok(begin >= 0 && end > begin);
  const persist = phone.slice(begin, end);
  for (const appId of ['troubleshooter', 'other']) {
    const url = '/troubleshoot/?provider=claude&run_id=run%2Fone#signin';
    const W = { win: { appId, url } }; let saves = 0;
    vm.runInNewContext(persist, { id: 'win', W, APP: { [appId]: { url: '/troubleshoot/' } }, win: { location: { pathname: '/troubleshoot/', search: '?provider=claude&run_id=run%2Fone', hash: '#signin' } }, save() { saves++; } });
    assert.equal(saves, 1);
    assert.equal(W.win.url, appId === 'troubleshooter' ? url : url.split('#')[0], 'only recovery changes its saved anchor behavior');
    if (appId === 'troubleshooter') {
      const h = mount(W.win.url); [...h.timers.values()].find(t => t.ms === 0).fn();
      for (let i = 0; i < 80; i++) await Promise.resolve();
      assert.equal(h.frame.src, url, 'restored window keeps the exact workflow');
    }
  }
});

test('phone and desktop give recovery the actual window URL', () => {
  const phone = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  const desktop = readFileSync(new URL('../web/desktop/desktop.js', import.meta.url), 'utf8');
  assert.match(phone, /mountRecovery\(el,\s*W\[el\.closest\('\.win'\)\?\.dataset\.win\]\?\.url\)/);
  assert.match(desktop, /mountRecovery\(el\.querySelector\('\[data-recovery\]'\),\s*w\.url\)/);
});
