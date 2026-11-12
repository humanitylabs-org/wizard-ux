// Browser owner boundary, shell side (wizard-os#133): web/core/shell-token.js and its nginx/entrypoint wiring.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const SRC = read('web/core/shell-token.js');
const TOKEN = 'ab'.repeat(32);
const ORIGIN = 'https://box.example.ts.net';

function store(seed = {}) {
  const data = new Map(Object.entries(seed));
  return { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: k => data.delete(k), data };
}
function boot({ token = TOKEN, framed = false, localStorage = store() } = {}) {
  const calls = [], xhrHeaders = [];
  let meta = token === null ? null : { content: token, removed: false, getAttribute: () => token, remove() { this.removed = true; } };
  const metaRef = meta;
  const document = { querySelector: sel => (sel === 'meta[name="wizard-shell-token"]' && meta && !meta.removed ? meta : null) };
  function fetch(input, init) { calls.push({ input, init }); return Promise.resolve('ok'); }
  class FakeXHR { open(m, u) { this.url = u; } setRequestHeader(n, v) { xhrHeaders.push([this.url, n, v]); } send() {} }
  const window = { fetch, XMLHttpRequest: FakeXHR };
  window.top = framed ? {} : window;
  const ctx = { window, document, localStorage, location: { href: ORIGIN + '/wizard-os-home/', origin: ORIGIN }, URL, Headers, Request };
  vm.runInNewContext(SRC, ctx);
  return { window, calls, xhrHeaders, meta: metaRef, nativeFetch: fetch };
}
const sent = call => new Headers(call.init?.headers ?? call.input?.headers).get('x-wizard-shell-token');

test('off: no token in the page changes nothing (fetch and XHR stay the browser\'s own)', () => {
  for (const token of ['', null, 'not-a-token', 'AB'.repeat(32)]) {
    const b = boot({ token });
    assert.equal(b.window.fetch, b.nativeFetch);
    assert.equal(b.window.WizShellBoundary, undefined);
    b.window.fetch('/wizard/threads');
    assert.equal(sent(b.calls[0]), null);
    if (b.meta) assert.equal(b.meta.removed, true, 'the meta leaves the page either way');
  }
});

test('on: owner calls carry the token, app paths and other origins never do', async () => {
  const b = boot();
  assert.equal(b.meta.removed, true);
  const owner = ['/wizard/threads', '/wizard/hermes/v1/runs', '/api/system/devices', '/v1/runs', 'store-install/_slots/chats',
    '/wizard-os-home/api/route', '/wizard-ux/api/transcribe', ORIGIN + '/wizard-os-home/store-install/_remove/x/plan'];
  const not = ['/notes/api/list', '/troubleshoot/', '/wizard-os-home/core/app.js', '/wizard-os-home/store-data/wizard/v1/index/search',
    'https://evil.example/wizard/threads', 'https://box.example.ts.net.evil.example/wizard/x', '/wizard-tinfoil/api', '//evil.example/wizard/x'];
  for (const url of owner) { b.calls.length = 0; await b.window.fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' } }); assert.equal(sent(b.calls[0]), TOKEN, url); assert.equal(new Headers(b.calls[0].init.headers).get('content-type'), 'application/json'); assert.equal(b.calls[0].init.method, 'POST'); }
  for (const url of not) { b.calls.length = 0; await b.window.fetch(url); assert.equal(sent(b.calls[0]), null, url); }
  b.calls.length = 0;
  await b.window.fetch(new Request(ORIGIN + '/wizard/attention', { headers: { accept: 'application/json' } }));
  assert.equal(sent(b.calls[0]), TOKEN);
  assert.equal(b.calls[0].input.headers.get('accept'), 'application/json');
  const x = new b.window.XMLHttpRequest(); x.open('POST', '/wizard/attachments'); x.send();
  const y = new b.window.XMLHttpRequest(); y.open('GET', '/notes/api/x'); y.send();
  assert.deepEqual(b.xhrHeaders, [['/wizard/attachments', 'X-Wizard-Shell-Token', TOKEN]]);
});

test('a framed shell page never arms the wrapper', () => {
  const b = boot({ framed: true });
  assert.equal(b.window.fetch, b.nativeFetch);
  assert.equal(b.meta.removed, true);
});

test('both shell pages carry the `off` placeholder and load the script first', () => {
  for (const page of ['web/index.html', 'web/desktop.html']) {
    const html = read(page);
    const metaAt = html.indexOf('<meta name="wizard-shell-token" content="off">');
    const scriptAt = html.indexOf('<script src="core/shell-token.js"></script>');
    assert.ok(metaAt > 0 && scriptAt > metaAt, page);
    assert.equal(html.indexOf('<script'), scriptAt, page + ': shell-token.js is the first script');
  }
});

test('nginx: off renders no token and no sub_filter; on fills it for a top-level page load only, never stored', () => {
  const entry = read('packaging/entrypoint.sh'), tpl = read('packaging/nginx.conf.template'), stat = read('packaging/static.conf');
  assert.match(tpl, /include \/tmp\/wizard-boundary\.conf;\n\s*map \$wizard_shell_token \$wizard_doc_cache \{ "" \$wizard_cache_ok; default "no-store"; \}/);
  assert.match(stat, /add_header Cache-Control \$wizard_doc_cache always;/);
  assert.match(stat, /include \/tmp\/wizard-boundary-static\.conf;/);
  assert.match(entry, /printf 'map "\$http_sec_fetch_mode:\$http_sec_fetch_dest" \$wizard_shell_token \{ default ""; \}\\n' > \/tmp\/wizard-boundary\.conf\n\s*: > \/tmp\/wizard-boundary-static\.conf/);
  // Only navigations: top-level (navigate:document) or passed on by the service worker (navigate:empty); never a frame.
  assert.match(entry, /\$wizard_shell_token \{ "navigate:document" "%s"; "navigate:empty" "%s"; default ""; \}/);
  assert.doesNotMatch(entry, /iframe" "%s"/);
  assert.match(entry, /sub_filter '<meta name="wizard-shell-token" content="off">' '<meta name="wizard-shell-token" content="\$wizard_shell_token">';/);
  assert.match(entry, /grep -Eqx '\[0-9a-f\]\{64\}'/);
  assert.ok(entry.indexOf('/tmp/wizard-boundary.conf') < entry.indexOf('nginx -t'), 'written before nginx -t');
});

test('the device remembers the box\'s boundary (never the token): set on, cleared only by the box\'s `off`', () => {
  const MARK = 'wos.browser-boundary.v1';
  const on = store(); boot({ localStorage: on });
  assert.equal(on.data.get(MARK), '1');
  assert.ok(![...on.data.values()].some(v => v.includes(TOKEN)), 'the token itself is never stored');
  for (const token of ['', null, 'not-a-token']) {
    const kept = store({ [MARK]: '1' }); boot({ token, localStorage: kept });
    assert.equal(kept.data.get(MARK), '1', `an empty or unknown value (offline copy, warm-up read) keeps it: ${token}`);
  }
  const framed = store(); boot({ framed: true, localStorage: framed });
  assert.equal(framed.data.has(MARK), false, 'a framed shell page never sets it');
  const off = store({ [MARK]: '1' }); const b = boot({ token: 'off', localStorage: off });
  assert.equal(off.data.has(MARK), false, 'the box said off');
  assert.equal(b.window.fetch, b.nativeFetch);
  assert.equal(b.window.WizShellBoundary, undefined);
  const broken = boot({ localStorage: { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } } });
  assert.equal(broken.window.WizShellBoundary.on, true, 'storage that throws never stops the shell');
});

// A framed shell page (Store, Agents, Setup) inside the top-level shell: its own fetch/XHR, armed by the top.
function child(top, path, { sameOrigin = true } = {}) {
  const calls = [], xhrHeaders = [];
  function fetch(input, init) { calls.push({ input, init }); return Promise.resolve('ok'); }
  class FakeXHR { open(m, u) { this.url = u; } setRequestHeader(n, v) { xhrHeaders.push([this.url, n, v]); } send() {} }
  const href = (sameOrigin ? ORIGIN : 'https://evil.example') + path;
  const u = new URL(href);
  const win = { fetch, XMLHttpRequest: FakeXHR, Headers, Request, location: { href, origin: u.origin, pathname: u.pathname } };
  win.top = top.window; win.parent = top.window;
  const document = { querySelector: () => null };
  vm.runInNewContext(SRC, { window: win, document, localStorage: store(), location: win.location, URL, Headers, Request });
  return { win, calls, xhrHeaders, nativeFetch: fetch };
}

test('on: the shell\'s own pages in a frame (Store, Agents, Setup, Settings › Connections) send owner calls with the token, armed by the top shell', async () => {
  const top = boot();
  for (const path of ['/wizard-os-home/store/index.html', '/wizard-os-home/agents/index.html', '/wizard-os-home/setup/', '/wizard-ux/store/index.html',
    '/wizard-os-home/store-install/_connections/', '/wizard-ux/store-install/_connections/index.html']) {
    const c = child(top, path);
    assert.notEqual(c.win.fetch, c.nativeFetch, path);
    await c.win.fetch('../store-install/_slots/chats', { method: 'POST' });
    await c.win.fetch('/wizard/v1/agents');
    await c.win.fetch('/notes/api/list');
    await c.win.fetch(new Request(ORIGIN + '/api/system/devices'));
    assert.deepEqual(c.calls.map(sent), [TOKEN, TOKEN, null, TOKEN], path);
    const x = new c.win.XMLHttpRequest(); x.open('POST', '/wizard/attachments'); x.send();
    const y = new c.win.XMLHttpRequest(); y.open('GET', '/troubleshoot/api/x'); y.send();
    assert.deepEqual(c.xhrHeaders, [['/wizard/attachments', 'X-Wizard-Shell-Token', TOKEN]], path);
    assert.equal(c.win.WizShellBoundary, undefined, 'the framed page gets no handle of its own');
  }
});

test('the top shell arms only its own pages in a frame below it, never an app page, another site or the shell itself', () => {
  const top = boot();
  for (const path of ['/notes/', '/troubleshoot/index.html', '/wizard-os-home/index.html', '/wizard-os-home/store/evil.html', '/wizard-os-home/store/x/index.html', '/pages/store/index.html',
    '/wizard-os-home/store-install/_connections/api/connections', '/wizard-os-home/store-install/_connections/x.html', '/wizard-os-home/store-install/notes/', '/notes/store-install/_connections/']) {
    const c = child(top, path);
    assert.equal(c.win.fetch, c.nativeFetch, path);
  }
  const other = child(top, '/wizard-os-home/store/index.html', { sameOrigin: false });
  assert.equal(other.win.fetch, other.nativeFetch, 'another origin');
  assert.equal(top.window.WizShellBoundary.armFrame(top.window), false, 'not itself');
  const stranger = { top: {}, location: { origin: ORIGIN, pathname: '/wizard-os-home/store/index.html' } };
  assert.equal(top.window.WizShellBoundary.armFrame(stranger), false, 'a frame under another top');
  // Off: nothing to arm, a framed shell page stays the browser's own.
  const off = boot({ token: 'off' });
  const c = child(off, '/wizard-os-home/store/index.html');
  assert.equal(c.win.fetch, c.nativeFetch);
});

test('Store, Agents and Setup load shell-token.js as their first script', () => {
  for (const page of ['web/store/index.html', 'web/agents/index.html', 'web/setup/index.html']) {
    const html = read(page);
    assert.equal(html.indexOf('<script'), html.indexOf('<script src="../core/shell-token.js"></script>'), page);
  }
});
