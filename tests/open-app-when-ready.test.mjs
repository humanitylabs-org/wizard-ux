// #1651: a tap on an app the Store just installed must never do nothing. While the registry has no page for it
// yet, the shell says it is starting, keeps re-checking, and opens it once it is ready (phone and desktop shells).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const shells = ['web/app.js', 'web/desktop/desktop.js'];

function load(file) {
  const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const start = src.indexOf('  const OPEN_WAIT = new Map();');
  const end = src.indexOf('  // Only trusted system windows may ask', start);
  assert.ok(start > 0 && end > start, `${file}: whenOpenable helper not found`);
  return { src, body: src.slice(start, end) };
}

function harness(file, { readyAfter = Infinity } = {}) {
  const { body } = load(file);
  const APP = {}, toasts = [];
  let refreshes = 0;
  const WizCore = { refreshApps: async () => { refreshes++; if (refreshes >= readyAfter) APP.tracker = { id: 'tracker', name: 'WizardOS Tracker', kind: 'wizard', url: '/wizardos-tracker/' }; return true; } };
  const hostedOpenable = id => (APP[id]?.url ? APP[id] : null);
  const esc = s => String(s);
  const toast = (icon, text) => toasts.push(text);
  const fastTimeout = (fn) => setImmediate(fn);
  const make = new Function('APP', 'hostedOpenable', 'esc', 'toast', 'window', 'setTimeout', `${body}; return whenOpenable;`);
  const whenOpenable = make(APP, hostedOpenable, esc, toast, { WizCore }, fastTimeout);
  return { whenOpenable, toasts, APP, refreshes: () => refreshes };
}

for (const file of shells) {
  test(`${file}: an already openable app opens at once, with no toast`, async () => {
    const h = harness(file, { readyAfter: 1 });
    h.APP.tracker = { id: 'tracker', name: 'WizardOS Tracker', kind: 'wizard', url: '/wizardos-tracker/' };
    assert.equal((await h.whenOpenable('tracker')).id, 'tracker');
    assert.equal(h.refreshes(), 0);
    assert.deepEqual(h.toasts, []);
  });

  test(`${file}: a still-starting app shows Starting… and opens once the registry has its page`, async () => {
    const h = harness(file, { readyAfter: 4 });
    const second = h.whenOpenable('tracker');      // a second tap while it waits joins the same wait
    const a = await h.whenOpenable('tracker');
    assert.equal(a.url, '/wizardos-tracker/');
    assert.equal(await second, a);
    assert.equal(h.refreshes(), 4);
    assert.deepEqual(h.toasts, ['The app is starting…']);
  });

  test(`${file}: an app that never gets a page says so instead of doing nothing`, async () => {
    const h = harness(file);
    assert.equal(await h.whenOpenable('tracker'), null);
    assert.equal(h.refreshes(), 30);
    assert.equal(h.toasts.length, 2);
    assert.match(h.toasts[1], /installed but still starting\. Try again in a moment\./);
  });

  test(`${file}: the Store's open-app message waits through whenOpenable, not one refresh`, () => {
    const { src } = load(file);
    const i = src.indexOf("d.type !== 'wizard:open-app'");
    const handler = src.slice(i, src.indexOf('});', i));
    assert.match(handler, /await whenOpenable\(d\.id\)/);
    assert.doesNotMatch(handler, /if \(!hostedOpenable\(d\.id\)\) await window\.WizCore\.refreshApps/);
  });
}
