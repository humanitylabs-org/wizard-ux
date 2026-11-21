// A chat link to a page inside an installed app keeps its #fragment on the desktop shell (wizard-ux issue 1453:
// /wizardos-tracker/#item/humanitylabs-org/wizard-os/627 opened the Tracker at its list: LINKS.route saw the app's own
// address and opened the app plainly, dropping the hash). The real LINKS.route from desktop.js runs in a vm with the
// shell calls it makes stubbed. Browser proof (both desktop views, Tracker open and closed): tests/qa-app-link-hash.cjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { withDesktopParts } from './fixtures/desktop-parts.mjs';

const src = withDesktopParts(readFileSync(new URL('../web/desktop/desktop.js', import.meta.url), 'utf8'));
const from = src.indexOf('  if (LINKS) LINKS.route = href => {'), to = src.indexOf('  if (LINKS) window.WizLinks.intercept(', from);
assert.ok(from > 0 && to > from, 'LINKS.route block found in desktop.js');
const block = src.slice(from, to);

function route(href) {
  const calls = [];
  const TRACKER = { id: 'wizardos-tracker', name: 'Tracker', url: '/wizardos-tracker/' };
  const ctx = {
    URL, location: { href: 'https://wizard.test/wizard-os-home/desktop.html', origin: 'https://wizard.test' },
    window: { WosPages: { match: () => null } }, LINKS: {},
    appAt: u => new URL(u, 'https://wizard.test/').pathname.startsWith(TRACKER.url) ? TRACKER : null,
    openApp: (a, opts) => { calls.push(['openApp', a.id, JSON.parse(JSON.stringify(opts))]); return true; },
    openAppLink: (rel, title) => { calls.push(['openAppLink', rel, title]); return true; },
    newWin: o => { calls.push(['newWin', o]); return {}; },
  };
  vm.runInNewContext(block, ctx);
  const ok = ctx.LINKS.route(href);
  return { ok, calls };
}

test('a #fragment on the app\'s own address goes to that page (the window reused, at the item)', () => {
  const r = route('https://wizard.test/wizardos-tracker/#item/humanitylabs-org/wizard-os/627');
  assert.equal(r.ok, true);
  assert.deepEqual(r.calls, [['openApp', 'wizardos-tracker', { fresh: false, path: '/wizardos-tracker/#item/humanitylabs-org/wizard-os/627' }]]);
});

test('the app\'s own address without a fragment still just brings the app up (its page left as it is)', () => {
  const r = route('https://wizard.test/wizardos-tracker/');
  assert.deepEqual(r.calls, [['openApp', 'wizardos-tracker', { fresh: false }]]);
  assert.deepEqual(route('https://wizard.test/wizardos-tracker/#').calls, [['openApp', 'wizardos-tracker', { fresh: false }]], 'an empty # is no page');
});

test('a deeper page of the app keeps its path, query and fragment', () => {
  const r = route('https://wizard.test/wizardos-tracker/board?x=1#item/a/b/3');
  assert.deepEqual(r.calls, [['openAppLink', '/wizardos-tracker/board?x=1#item/a/b/3', 'Tracker']]);
});
