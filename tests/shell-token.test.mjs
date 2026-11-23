// Browser owner boundary, shell side (wizard-os#133): web/core/shell-token.js and its nginx/entrypoint wiring.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createDocument } from './fixtures/mini-dom.mjs';
import { nginxShell } from './fixtures/w1-nginx.mjs';
import vm from 'node:vm';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const SRC = read('web/core/shell-token.js');
const TOKEN = 'ab'.repeat(32);
const ORIGIN = 'https://box.example.ts.net';

function store(seed = {}) {
  const data = new Map(Object.entries(seed));
  return { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: k => data.delete(k), data };
}
function boot({ token = TOKEN, framed = false, localStorage = store(), path = '/wizard-os-home/', native } = {}) {
  const calls = [], xhrHeaders = [];
  let meta = token === null ? null : { content: token, removed: false, getAttribute: () => token, remove() { this.removed = true; } };
  const metaRef = meta;
  const document = { querySelector: sel => (sel === 'meta[name="wizard-shell-token"]' && meta && !meta.removed ? meta : null) };
  function fetch(input, init) { calls.push({ input, init }); return Promise.resolve('ok'); }
  class FakeXHR { open(m, u) { this.url = u; } setRequestHeader(n, v) { xhrHeaders.push([this.url, n, v]); } send() {} }
  const window = { fetch, XMLHttpRequest: FakeXHR };
  if (native) window.WizardOSNative = native;
  window.top = framed ? {} : window;
  const ctx = { window, document, localStorage, location: { href: ORIGIN + path, origin: ORIGIN }, URL, Headers, Request };
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

test('Android: only the top-level shell page tells the app whether the box has the boundary on (issue 1430)', () => {
  const told = [];
  const native = { browserBoundary: on => told.push(on) };
  boot({ native });
  assert.deepEqual(told, [true], 'a real token: on');
  told.length = 0; boot({ token: 'off', native });
  assert.deepEqual(told, [false], 'the shipped `off`: off');
  for (const token of ['', null, 'not-a-token']) { told.length = 0; boot({ token, native }); assert.deepEqual(told, [], `${token}: says nothing (offline copy keeps the last answer)`); }
  for (const token of [TOKEN, 'off', '']) { told.length = 0; boot({ token, framed: true, native }); assert.deepEqual(told, [], `framed ${token}: a frame never speaks for the box`); }
  // An older app without the method, or one whose bridge throws, changes nothing for the page.
  assert.doesNotThrow(() => boot({ native: {} }));
  assert.doesNotThrow(() => boot({ native: { browserBoundary() { throw new Error('x'); } } }));
  assert.equal(boot({ native: { browserBoundary() { throw new Error('x'); } } }).window.WizShellBoundary.on, true);
});

test('Android: only the top-level shell page with a real token hands it to the app for its own owner calls (wizard-os#133)', () => {
  const given = [];
  const native = { browserBoundary() {}, shellToken: t => given.push(t) };
  boot({ native });
  assert.deepEqual(given, [TOKEN], 'a real token: handed over once');
  for (const token of ['off', '', null, 'not-a-token', 'AB'.repeat(32)]) { given.length = 0; boot({ token, native }); assert.deepEqual(given, [], `${token}: nothing handed over`); }
  for (const token of [TOKEN, 'off', '']) { given.length = 0; boot({ token, framed: true, native }); assert.deepEqual(given, [], `framed ${token}: a frame never hands it over`); }
  // An older app without the method, or one whose bridge throws, still arms the page.
  assert.equal(boot({ native: { browserBoundary() {} } }).window.WizShellBoundary.on, true);
  assert.equal(boot({ native: { browserBoundary() {}, shellToken() { throw new Error('x'); } } }).window.WizShellBoundary.on, true);
});

test('a framed shell page never arms the wrapper', () => {
  const b = boot({ framed: true });
  assert.equal(b.window.fetch, b.nativeFetch);
  assert.equal(b.meta.removed, true);
});

// A shell page as the browser loads it: parsed into a mini DOM; its first script must be core/shell-token.js, which
// then runs over that same document (the page's own meta, as shipped or as nginx's sub_filter filled it).
const SUB = ['<meta name="wizard-shell-token" content="off">', '<meta name="wizard-shell-token" content="$wizard_shell_token">'];
function loadPage(page, { token = null, path } = {}) {
  let html = read(page); if (token !== null) html = html.split(SUB[0]).join(SUB[1].replace('$wizard_shell_token', token));
  const doc = createDocument(); doc.documentElement.innerHTML = html.slice(html.indexOf('<head'), html.lastIndexOf('</html>'));
  const scripts = doc.querySelectorAll('script'), first = scripts[0], meta = doc.querySelector('meta[name="wizard-shell-token"]');
  const all = doc.documentElement.descendants(), seenFirst = !!meta && all.indexOf(meta) < all.indexOf(first);
  const calls = [], fetch = (input, init) => { calls.push({ input, init }); return Promise.resolve('ok'); };
  const window = { fetch, XMLHttpRequest: class { open() {} setRequestHeader() {} send() {} } }; window.top = window;
  const localStorage = store({ 'wos.browser-boundary.v1': '1' });
  vm.runInNewContext(SRC, { window, document: doc, localStorage, location: { href: ORIGIN + path, origin: ORIGIN }, URL, Headers, Request });
  return { src: first?.getAttribute('src'), metaBeforeScript: seenFirst, metaLeft: !!doc.querySelector('meta[name="wizard-shell-token"]'), window, calls, localStorage, nativeFetch: fetch };
}
async function ownerCall(p, url) { await p.window.fetch(url); return sent(p.calls.at(-1)); }

test('both shell pages carry the `off` placeholder and load the script first', async () => {
  for (const [page, path] of [['web/index.html', '/wizard-os-home/'], ['web/desktop.html', '/wizard-os-home/desktop.html']]) {
    const off = loadPage(page, { path });
    assert.equal(off.src, 'core/shell-token.js', page + ': shell-token.js is the first script');
    assert.ok(off.metaBeforeScript, page + ': the meta is parsed before it runs');
    assert.equal(off.window.fetch, off.nativeFetch, page + ': off: nothing wrapped'); assert.equal(off.localStorage.data.has('wos.browser-boundary.v1'), false, 'and the box says off');
    assert.equal(off.metaLeft, false, 'the meta leaves the page');
    const on = loadPage(page, { path, token: TOKEN });
    assert.equal(await ownerCall(on, '/wizard/v1/bootstrap'), TOKEN, page + ': nginx\'s value reaches the owner calls');
  }
});

test('nginx: off renders no token and no sub_filter; on fills it for a top-level page load only, never stored', () => {
  // the real entrypoint.sh under sh, with its /tmp and /etc/wizard-shell paths in a scratch folder and nginx,
  // envsubst and the process runner stubbed (each stub records that it ran)
  const dir = mkdtempSync(join(tmpdir(), 'wos-entry-')), bin = join(dir, 'bin'), etc = join(dir, 'etc'), out = join(dir, 'tmp');
  try {
    for (const d of [bin, etc, out]) mkdirSync(d);
    for (const f of ['static.conf', 'proxy.conf', 'proxy-mcp.conf', 'nginx.conf.template']) writeFileSync(join(etc, f), read('packaging/' + f));
    writeFileSync(join(bin, 'nginx'), `#!/bin/sh\n[ -f "${out}/wizard-boundary.conf" ] && [ -f "${out}/wizard-boundary-static.conf" ] && echo nginx-t-after-conf >> "${dir}/log"\n`);
    writeFileSync(join(bin, 'envsubst'), '#!/bin/sh\ncat\n'); writeFileSync(join(bin, 'python3'), `#!/bin/sh\necho started >> "${dir}/log"\n`);
    for (const f of ['nginx', 'envsubst', 'python3']) chmodSync(join(bin, f), 0o755);
    const script = join(dir, 'entrypoint.sh');
    writeFileSync(script, read('packaging/entrypoint.sh').split('/tmp/').join(out + '/').split('/etc/wizard-shell/').join(etc + '/'));
    const run = env => { rmSync(join(dir, 'log'), { force: true }); const r = spawnSync('sh', [script], { env: { PATH: `${bin}:/usr/bin:/bin`, ...env }, encoding: 'utf8' }); return { code: r.status, err: r.stderr, log: existsSync(join(dir, 'log')) ? readFileSync(join(dir, 'log'), 'utf8') : '', conf: f => readFileSync(join(out, f), 'utf8') }; };
    // off (the default): every read maps to no token, and nothing is filtered into the page
    let r = run({}); assert.equal(r.code, 0, r.err); assert.equal(r.log, 'nginx-t-after-conf\nstarted\n', 'written before nginx -t');
    assert.equal(r.conf('wizard-boundary.conf'), 'map "$http_sec_fetch_mode:$http_sec_fetch_dest" $wizard_shell_token { default ""; }\n');
    assert.equal(r.conf('wizard-boundary-static.conf'), '');
    // on: the token only for a real top-level navigation (and the service worker passing one on), never a frame
    writeFileSync(join(dir, 'token'), TOKEN + '\n');
    r = run({ WIZARD_BROWSER_BOUNDARY: '1', WIZARD_SHELL_TOKEN_FILE: join(dir, 'token') }); assert.equal(r.code, 0, r.err);
    assert.equal(r.conf('wizard-boundary.conf'), `map "$http_sec_fetch_mode:$http_sec_fetch_dest" $wizard_shell_token { "navigate:document" "${TOKEN}"; "navigate:empty" "${TOKEN}"; default ""; }\n`);
    const filter = r.conf('wizard-boundary-static.conf'), m = /^sub_filter '([^']+)' '([^']+)';$/m.exec(filter);
    assert.ok(m, 'one sub_filter'); assert.deepEqual([m[1], m[2]], SUB, 'it fills exactly the shipped placeholder');
    // (the pages carry the string it looks for: served() below finds the token in both served pages)
    // a token that is not 64 lowercase hex: the shell refuses to start
    for (const bad of ['', 'AB'.repeat(32), 'ab'.repeat(31)]) {
      writeFileSync(join(dir, 'token'), bad); r = run({ WIZARD_BROWSER_BOUNDARY: '1', WIZARD_SHELL_TOKEN_FILE: join(dir, 'token') });
      assert.equal(r.code, 2, `refused: ${JSON.stringify(bad)}`); assert.equal(r.log, '', 'nginx never starts');
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// A page served through the image's real nginx config (tests/fixtures/w1-nginx.mjs runs the real entrypoint.sh, then
// walks the rendered config with its includes): the file, its Cache-Control, and the page after the location's
// sub_filter with $wizard_shell_token as the http block's map gives it for this request.
function served(shell, uri, dest) {
  const headers = { 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': dest }, r = shell.request({ uri, headers });
  const http = shell.tree.find(d => d.name === 'http').children, server = http.find(d => d.name === 'server').children;
  const map = http.find(d => d.name === 'map' && d.args[1] === '$wizard_shell_token');
  const token = map ? (map.children.find(e => e.name === `navigate:${dest}`) || map.children.find(e => e.name === 'default')).args[0] : '';
  let level = server, page = readFileSync(r.file, 'utf8');
  for (const at of r.location) {
    const loc = level.find(d => d.name === 'location' && d.args.join(' ') === at); level = loc.children;
    for (const f of level.filter(d => d.name === 'sub_filter')) page = page.replace(f.args[0], f.args[1].split('$wizard_shell_token').join(token));
  }
  return { status: r.status, cache: r.header('Cache-Control'), page };
}

test('nginx serves the token into both pages for a top-level load only, never stored; off keeps the cache rule', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wos-tok-')); writeFileSync(join(dir, 'token'), TOKEN + '\n');
  const on = nginxShell({ WIZARD_BROWSER_BOUNDARY: '1', WIZARD_SHELL_TOKEN_FILE: join(dir, 'token') }), off = nginxShell({});
  try {
    for (const uri of ['/wizard-os-home/', '/wizard-os-home/desktop.html']) {
      const top = served(on, uri, 'document');
      assert.equal(top.status, 200);
      assert.ok(top.page.includes(`<meta name="wizard-shell-token" content="${TOKEN}">`), `${uri}: the token in the page`);
      assert.deepEqual(top.cache, ['no-store'], `${uri}: a page with a token is never stored`);
      const framed = served(on, uri, 'iframe');
      assert.ok(!framed.page.includes(TOKEN), `${uri}: a frame never gets it`); assert.notDeepEqual(framed.cache, ['no-store']);
      const plain = served(off, uri, 'document');
      assert.ok(plain.page.includes('<meta name="wizard-shell-token" content="off">'), `${uri}: off: the page as shipped`);
      assert.notDeepEqual(plain.cache, ['no-store'], `${uri}: off keeps its cache rule`); assert.equal(plain.cache.length, 1);
    }
  } finally { on.done(); off.done(); rmSync(dir, { recursive: true, force: true }); }
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
  for (const [page, path] of [['web/store/index.html', '/wizard-os-home/store/'], ['web/agents/index.html', '/wizard-os-home/agents/'], ['web/setup/index.html', '/wizard-os-home/setup/']])
    assert.equal(loadPage(page, { path }).src, '../core/shell-token.js', page);
});

test('Store, Agents and Setup carry the `off` placeholder, so a top-level tab of them gets the token from nginx', async () => {
  for (const [page, path] of [['web/store/index.html', '/wizard-os-home/store/'], ['web/agents/index.html', '/wizard-os-home/agents/'], ['web/setup/index.html', '/wizard-os-home/setup/']]) {
    const off = loadPage(page, { path });
    assert.ok(off.metaBeforeScript, page); assert.equal(off.window.fetch, off.nativeFetch, `${page}: as shipped, off`);
    assert.equal(off.localStorage.data.has('wos.browser-boundary.v1'), false, `${page}: the shipped value is the box's off`);
    const on = loadPage(page, { path, token: TOKEN });
    assert.equal(await ownerCall(on, '/wizard/v1/bootstrap'), TOKEN, `${page}: nginx's value arms it`);
  }
});

test('on: Store, Agents or Setup opened as a top-level tab arm themselves; in a frame they never do', async () => {
  for (const path of ['/wizard-os-home/store/index.html', '/wizard-os-home/agents/index.html', '/wizard-os-home/setup/']) {
    const top = boot({ path });
    await top.window.fetch('/wizard/v1/agents', { method: 'POST' });
    await top.window.fetch('/notes/api/x');
    assert.equal(sent(top.calls[0]), TOKEN, path);
    assert.equal(sent(top.calls[1]), null, path);
    assert.equal(top.meta.removed, true, path);
    // In a Wizard window the frame load gets the empty value: nothing armed here (the top shell arms it instead).
    const framed = boot({ path, token: '', framed: true });
    assert.equal(framed.window.fetch, framed.nativeFetch, path);
  }
});
