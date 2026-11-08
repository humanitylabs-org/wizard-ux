// Settings › About shows where this box stands against main (wizard-ux#887 rule 5): the main commit it is built on
// and how far ahead/behind main it is, in plain words ("2 behind main · 120 own changes"). core/box-source.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('..', import.meta.url);
const src = readFileSync(new URL('web/core/box-source.js', root), 'utf8');
const A = 'a'.repeat(40), B = 'b'.repeat(40);

async function boot({ files = {}, updates = null, now = () => 1e12 } = {}) {
  const fetched = [];
  let feature = null, refreshes = 0;
  const WosSettings = { register: f => { feature = f; }, refresh: () => { refreshes++; }, get features() { return feature ? [{ id: feature.id }] : []; } };
  const fetch = async (u) => {
    fetched.push(String(u));
    const path = new URL(u).pathname + new URL(u).search;
    const body = typeof files[path] === 'function' ? files[path]() : files[path];
    if (body === undefined) return { ok: false, status: 404, json: async () => { throw new Error('404'); } };
    return { ok: true, status: 200, json: async () => body };
  };
  const window = { WosSettings, WosUpdates: updates };
  const ctx = vm.createContext({ window, document: { currentScript: { src: 'https://box.ts.net/wizard-os-home/core/box-source.js' } }, location: { href: 'https://box.ts.net/wizard-os-home/' }, fetch, URL, Date: { now }, console });
  vm.runInContext(src, ctx);
  assert.ok(feature, 'registers a Settings feature');
  const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };
  const render = async () => { feature.html(); await settle(); feature.html(); await settle(); return feature.html(); };
  return { feature, fetched, render, window, refreshes: () => refreshes };
}
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

test('registers one row on the About page', async () => {
  const b = await boot();
  assert.equal(b.feature.id, 'box-source');
  assert.equal(b.feature.page, 'about');
});

test("an owner's own release: base from my-release.json, behind from the App Manager, nothing else asked", async () => {
  const changes = Array.from({ length: 120 }, (_, i) => ({ sha: String(i), title: 't' }));
  const b = await boot({ files: { '/wizard-os-home/my-release.json': { base: { ref: 'f3cb2e21', label: 'Latest f3cb2e21' }, build: '7c20c50d', changes } }, updates: { state: { release: { base: 'f3cb2e21', behind: 2 } } } });
  const t = text(await b.render());
  assert.match(t, /Built on main f3cb2e21/);
  assert.match(t, /2 behind main · 120 own changes/);
  assert.deepEqual(b.fetched, ['https://box.ts.net/wizard-os-home/my-release.json']);
  b.window.WosUpdates.state.release.behind = 0;
  assert.match(text(b.feature.html()), /0 behind main · 120 own changes/);
});

test("an owner's own release whose updates status never loads settles on 'couldn't check main', not 'checking main…' forever", async () => {
  const mine = { '/wizard-os-home/my-release.json': { base: { ref: 'f3cb2e21' }, changes: [{ sha: '1' }, { sha: '2' }] } };
  let loads = 0;
  // updates request failed / older App Manager: os-updates.js marks itself off and load() resolves with no state
  let b = await boot({ files: mine, updates: { state: null, load: async () => { loads++; return null; } } });
  assert.match(text(await b.render()), /Built on main f3cb2e21 2 own changes · couldn’t check main$/);
  assert.equal(loads, 1, 'asked once, not on every draw');
  // no WosUpdates at all
  b = await boot({ files: mine, updates: null });
  assert.match(text(await b.render()), /Built on main f3cb2e21 2 own changes · couldn’t check main$/);
  // a load that succeeds shows the real count
  const u = { state: null, load: async () => { u.state = { release: { behind: 4 } }; return u.state; } };
  b = await boot({ files: mine, updates: u });
  assert.match(text(await b.render()), /4 behind main · 2 own changes$/);
});

test("an owner's own release on public WAM (no release.behind): the full base commit is compared with main", async () => {
  const changes = Array.from({ length: 120 }, (_, i) => ({ sha: String(i), title: 't' }));
  const cmpPath = `/wizard-os-home/store-install/_main-compare?commit=${A}`;
  let asks = 0;
  const files = { '/wizard-os-home/my-release.json': { base: { ref: 'aaaaaaaa', sha: A }, build: '7c20c50d', changes },
    [cmpPath]: () => { asks++; return { commit: A, base: A, behind: 2, own: 0 }; } };
  // public WAM: updates status loads, but its release carries no behind/ahead
  let b = await boot({ files, updates: { state: { release: { version: '0.9.1' } } } });
  let t = text(await b.render());
  assert.match(t, /Built on main aaaaaaaa 2 behind main · 120 own changes$/);
  assert.doesNotMatch(t, /couldn’t check main/);
  assert.deepEqual(b.fetched, ['https://box.ts.net/wizard-os-home/my-release.json', 'https://box.ts.net' + cmpPath]);
  assert.equal(asks, 1);
  // updates status never loads at all: same fallback
  b = await boot({ files, updates: null });
  assert.match(text(await b.render()), /2 behind main · 120 own changes$/);
  // a 40-hex base.ref works too; behind 0 and no own changes = up to date
  b = await boot({ files: { '/wizard-os-home/my-release.json': { base: { ref: A }, changes: [] }, [cmpPath]: { commit: A, base: A, behind: 0, own: 0 } }, updates: { state: { release: {} } } });
  assert.match(text(await b.render()), /Built on main aaaaaaaa Up to date with main$/);
  // the compare route fails or is missing: settles on "couldn't check main"
  b = await boot({ files: { '/wizard-os-home/my-release.json': { base: { ref: 'aaaaaaaa', sha: A }, changes: [{ sha: '1' }] } }, updates: { state: { release: {} } } });
  assert.match(text(await b.render()), /1 own change · couldn’t check main$/);
  // only a short base ref: nothing to compare, no request
  b = await boot({ files: { '/wizard-os-home/my-release.json': { base: { ref: 'f3cb2e21' }, changes: [{ sha: '1' }] } }, updates: { state: { release: {} } } });
  assert.match(text(await b.render()), /1 own change · couldn’t check main$/);
  assert.deepEqual(b.fetched, ['https://box.ts.net/wizard-os-home/my-release.json']);
});

test('a published image: build.json commit, compared with main by the App Manager once an hour', async () => {
  let t0 = 1e12, asks = 0;
  const b = await boot({ now: () => t0, files: {
    '/wizard-os-home/build.json': { commit: A },
    [`/wizard-os-home/store-install/_main-compare?commit=${A}`]: () => { asks++; return { commit: A, base: A, behind: 3, own: 0 }; },
  } });
  assert.match(text(await b.render()), /Built on main aaaaaaaa 3 behind main$/);
  t0 += 59 * 60e3; b.feature.html(); await new Promise(r => setImmediate(r));
  assert.equal(asks, 1, 'no second request within the hour');
  t0 += 2 * 60e3; b.feature.html(); await new Promise(r => setImmediate(r));
  assert.equal(asks, 2);
  assert.ok(b.fetched.every(u => u.startsWith('https://box.ts.net/wizard-os-home/')), 'only this box is asked; no GitHub call or token in the browser');
});

test('plain words: up to date, ahead of main, unknown', async () => {
  let b = await boot({ files: { '/wizard-os-home/build.json': { commit: A }, [`/wizard-os-home/store-install/_main-compare?commit=${A}`]: { base: A, behind: 0, own: 0 } } });
  assert.match(text(await b.render()), /Up to date with main/);
  b = await boot({ files: { '/wizard-os-home/build.json': { commit: A }, [`/wizard-os-home/store-install/_main-compare?commit=${A}`]: { base: B, behind: 5, own: 1 } } });
  assert.match(text(await b.render()), /Built on main bbbbbbbb 5 behind main · 1 own change$/);
  b = await boot({ files: { '/wizard-os-home/build.json': { commit: A }, [`/wizard-os-home/store-install/_main-compare?commit=${A}`]: { commit: A, error: 'not on GitHub' } } });
  assert.match(text(await b.render()), /isn’t on GitHub/);
  b = await boot({ files: { '/wizard-os-home/build.json': { commit: A } } });       // no App Manager route
  assert.match(text(await b.render()), /Built from aaaaaaaa Couldn’t check main just now/);
  b = await boot();
  assert.match(text(await b.render()), /Main commit unknown/);
  b = await boot({ files: { '/wizard-os-home/build.json': { commit: '<img src=x>' } } });
  assert.match(text(await b.render()), /Main commit unknown/);
});

test('every published image is stamped with the commit it was built from', () => {
  const docker = readFileSync(new URL('Dockerfile', root), 'utf8');
  assert.match(docker, /^ARG WIZARD_UX_COMMIT=$/m);
  assert.match(docker, /grep -Eqx '\[0-9a-f\]\{40\}'.*> \/usr\/share\/nginx\/wizard-ux\/build\.json/);
  const ci = readFileSync(new URL('scripts/ci/ghcr_image.py', root), 'utf8');
  assert.equal((ci.match(/"--build-arg", "WIZARD_UX_COMMIT=" \+ args\.sha/g) || []).length, 2, 'PR build and publish both pass it');
  for (const page of ['web/index.html', 'web/desktop.html']) assert.match(readFileSync(new URL(page, root), 'utf8'), /<script src="core\/box-source\.js"><\/script>/);
});
