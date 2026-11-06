import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../web/core/app-identity.js', import.meta.url), 'utf8');
const client = readFileSync(new URL('../web/core/app-client.js', import.meta.url), 'utf8');

function run({ path, framed = false, ownManifest = false, existing = [], standalone = false, manifest, status = 200, session = {} }) {
  const added = [], fetched = [], replaced = [];
  const el = tag => { const attrs = {}; const node = { tag, attrs, dataset: {}, setAttribute: (k, v) => { attrs[k] = v; }, remove() { const i = added.indexOf(node); if (i >= 0) added.splice(i, 1); } }; return node; };
  const document = {
    head: { appendChild: n => added.push(n) },
    createElement: el,
    querySelector: sel => {
      if (sel.startsWith('link[rel~="manifest"]')) return ownManifest || added.some(n => n.attrs.rel === 'manifest') ? {} : null;
      if (existing.includes(sel)) return {};
      return added.find(n => sel.includes(n.attrs.rel ? `rel~="${n.attrs.rel}"` : `name="${n.attrs.name}"`)) || null;
    },
  };
  const window = {};
  const location = { pathname: path.split('?')[0], href: 'https://box.test' + path, origin: 'https://box.test', replace: u => replaced.push(u) };
  const ctx = { window, document, location, navigator: { standalone }, URL,
    sessionStorage: { getItem: k => session[k] ?? null, setItem: (k, v) => { session[k] = v; } },
    fetch: (url) => { fetched.push(url); return Promise.resolve({ ok: status === 200, status, json: async () => manifest }); } };
  ctx.parent = framed ? {} : window;
  vm.runInNewContext(source, ctx);
  return { added, fetched, replaced, settle: () => new Promise(r => setTimeout(r, 10)) };
}
const MR = { name: 'Morning Report', start_url: '/morning-report/', scope: '/morning-report/', icons: [
  { src: '/wizard-os-home/install-icons/morning-report-192.png', sizes: '192x192' },
  { src: '/wizard-os-home/install-icons/morning-report-180.png', sizes: '180x180' }] };

test('app-client loads the shared identity script for top-level documents only', () => {
  assert.match(client, /parent === window && !window\.WizardAppIdentity[\s\S]{0,200}\/wizard-os-home\/core\/app-identity\.js/);
});

test('direct app page gets registry manifest, 180px touch icon and app-name title', async () => {
  const r = run({ path: '/morning-report/?date=2026-10-20', manifest: MR });
  await r.settle();
  assert.deepEqual(r.fetched, ['/wizard-os-home/install/at/morning-report.webmanifest']);
  const by = k => r.added.find(n => n.attrs.rel === k || n.attrs.name === k)?.attrs;
  assert.equal(by('manifest').href, '/wizard-os-home/install/at/morning-report.webmanifest');
  assert.equal(by('apple-touch-icon').href, '/wizard-os-home/install-icons/morning-report-180.png');
  assert.equal(by('apple-mobile-web-app-title').content, 'Morning Report');
  assert.equal(by('apple-mobile-web-app-capable').content, 'yes');
  assert.deepEqual(r.replaced, [], 'a browser tab is never redirected');
});

test('iOS home-screen launch of a saved deep URL lands on the app root once', async () => {
  const session = {};
  const first = run({ path: '/morning-report/?date=2026-10-20', standalone: true, manifest: MR, session });
  await first.settle();
  assert.deepEqual(first.replaced, ['https://box.test/morning-report/']);
  const later = run({ path: '/morning-report/?date=2026-10-19', standalone: true, manifest: MR, session });
  await later.settle();
  assert.deepEqual(later.replaced, []);
});

test('own manifest wins, existing apple tags kept, unregistered and shell paths add nothing', async () => {
  const own = run({ path: '/wizard-music/', ownManifest: true, standalone: true, existing: ['link[rel~="apple-touch-icon"]'], manifest: { ...MR, name: 'Music', start_url: '/wizard-music/' } });
  await own.settle();
  assert.equal(own.added.some(n => n.attrs.rel === 'manifest' || n.attrs.rel === 'apple-touch-icon'), false);
  assert.deepEqual(own.replaced, []);
  const missing = run({ path: '/nope/', status: 404 });
  await missing.settle();
  assert.equal(missing.added.length, 0, 'speculative manifest link is removed on 404');
  for (const path of ['/wizard-os-home/', '/wizard-ux/', '/', '/a%2Fb/']) assert.deepEqual(run({ path, manifest: MR }).fetched, [], path);
  assert.deepEqual(run({ path: '/morning-report/', framed: true, manifest: MR }).fetched, []);
});

test('foreign icon URLs are never used as apple-touch-icon', async () => {
  const r = run({ path: '/wisdom/', manifest: { ...MR, icons: [{ src: 'https://evil.example/i.png', sizes: '180x180' }] } });
  await r.settle();
  assert.equal(r.added.some(n => n.attrs.rel === 'apple-touch-icon'), false);
});
