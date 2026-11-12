// Browser owner boundary, shell side (wizard-os#133): web/core/shell-token.js and its nginx/entrypoint wiring.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const SRC = read('web/core/shell-token.js');
const TOKEN = 'ab'.repeat(32);
const ORIGIN = 'https://box.example.ts.net';

function boot({ token = TOKEN, framed = false } = {}) {
  const calls = [], xhrHeaders = [];
  let meta = token === null ? null : { content: token, removed: false, getAttribute: () => token, remove() { this.removed = true; } };
  const metaRef = meta;
  const document = { querySelector: sel => (sel === 'meta[name="wizard-shell-token"]' && meta && !meta.removed ? meta : null) };
  function fetch(input, init) { calls.push({ input, init }); return Promise.resolve('ok'); }
  class FakeXHR { open(m, u) { this.url = u; } setRequestHeader(n, v) { xhrHeaders.push([this.url, n, v]); } send() {} }
  const window = { fetch, XMLHttpRequest: FakeXHR };
  window.top = framed ? {} : window;
  const ctx = { window, document, location: { href: ORIGIN + '/wizard-os-home/', origin: ORIGIN }, URL, Headers, Request };
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

test('both shell pages carry the empty placeholder and load the script first', () => {
  for (const page of ['web/index.html', 'web/desktop.html']) {
    const html = read(page);
    const metaAt = html.indexOf('<meta name="wizard-shell-token" content="">');
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
  assert.match(entry, /sub_filter '<meta name="wizard-shell-token" content="">' '<meta name="wizard-shell-token" content="\$wizard_shell_token">';/);
  assert.match(entry, /grep -Eqx '\[0-9a-f\]\{64\}'/);
  assert.ok(entry.indexOf('/tmp/wizard-boundary.conf') < entry.indexOf('nginx -t'), 'written before nginx -t');
});
