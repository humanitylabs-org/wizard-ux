import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { cascade } from './fixtures/mini-css.mjs';
import { renderInstallResult, successMessage } from '../web/store/store-install-result.js';
import { storeContext, cut } from './fixtures/store-slice-harness.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const store = read('web/store/store.js');
const css = read('web/store/store.css');

const successLink = '<a href="../?view=apps" target="_top" data-my-apps>My apps</a>';

test('the install result renderer links every successful install to My apps', () => {
  const normal = renderInstallResult({ name: 'Calendar', message: successMessage(null), ok: true });
  assert.match(normal, /^<b>Calendar is ready<\/b><span>Find it in /);
  assert.ok(normal.includes(successLink));

  const privateResult = renderInstallResult({ name: 'Private Notes', message: successMessage({ privacy: 'private' }), ok: true });
  assert.match(privateResult, /^<b>Private Notes is ready<\/b><span>Private: only your private agent can use it\. Find it in /);
  assert.ok(privateResult.includes(successLink));

  const failure = renderInstallResult({ name: '<Broken>', message: '<Install failed>', ok: false });
  assert.equal(failure, '<b>&lt;Broken&gt; wasn’t installed</b><span>&lt;Install failed&gt;</span>');
  assert.doesNotMatch(failure, /data-my-apps|My apps/);
});

// install() and the [data-my-apps] click listener from store.js, run with stubs (tests/fixtures/store-slice-harness.mjs).
async function installOnce({ access = null, needs = false, fail = null } = {}) {
  const toasts = [], a = { id: 'calendar', name: 'Calendar', repo: 'r', commit: 'c' };
  const ctx = storeContext(cut('  async function install(a, options = {}) {', '  // A reload while an install/update runs') + '\nthis.install = install;', {
    S: { busy: new Set(), busyAt: new Map(), removing: new Set(), starting: new Map(), late: new Set(), installed: new Map(), router: new Map(), access: new Map(), stack: [], link: null, architecture: '' },
    architectureReason: () => '', status: () => 'get', openId: x => x.id, key: x => x.id, routerId: x => x.id, refresh() {}, framed: false, parent: {}, location: { origin: 'https://box.test', search: '' }, URLSearchParams,
    installRelease: async () => { if (fail) throw new Error(fail); }, load: async () => { ctx.S.installed.set('calendar', { repo: 'r', commit: 'c' }); },
    routerNeeds: async () => ({ data: needs ? { x: 1 } : null }), appAccess: async () => access, hasNeeds: d => !!d, nudgeOn: () => false, nudgeDue: () => false, top: () => '', push() {}, showSheet() {}, window: { scrollTo() {} },
    toast: html => toasts.push(html) });
  await ctx.install(a);
  return toasts;
}
function myAppsClick({ framed = true, routes = true, ...e } = {}) {
  let handler; const calls = [];
  const ctx = storeContext(cut("  document.addEventListener('click', e => {\n    const mine = e.target.closest('[data-my-apps]');", "  }, true);") + '  }, true);', {
    framed, document: { addEventListener: (t, f) => { handler = f; } },
    parent: { WizCore: { deeplink: { route: (href, el) => (calls.push(['route', href]), routes) } } }, window: { top: { location: { assign: h => calls.push(['assign', h]) } } } });
  const link = { href: 'https://box.test/wizard-os-home/?view=apps' };
  const ev = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...e, target: { closest: s => (s === '[data-my-apps]' ? link : null) },
    preventDefault: () => calls.push(['prevent']), stopImmediatePropagation() {} };
  handler(ev);
  return calls;
}
test('the Store binds that renderer to success and reserves top navigation for plain primary activation', async () => {
  const ok = await installOnce();
  assert.equal(ok.length, 1); assert.ok(ok[0].includes(successLink), 'a finished install says where to find it');
  assert.ok((await installOnce({ access: { privacy: 'private' } }))[0].includes('Private: only your private agent'));
  const failed = await installOnce({ fail: 'Install failed hard' });
  assert.match(failed[0], /wasn’t installed<\/b><span>Install failed hard/); assert.doesNotMatch(failed[0], /data-my-apps/);
  assert.deepEqual(await installOnce({ needs: true }), [], 'an install that still needs setup opens its sheet instead');
  // A plain click inside the shell routes in place; the shell refusing falls back to a top navigation.
  assert.deepEqual(myAppsClick(), [['prevent'], ['route', 'https://box.test/wizard-os-home/?view=apps']]);
  assert.deepEqual(myAppsClick({ routes: false }), [['prevent'], ['route', 'https://box.test/wizard-os-home/?view=apps'], ['assign', 'https://box.test/wizard-os-home/?view=apps']]);
  // Modified clicks, other buttons and a standalone Store keep the browser's own behaviour.
  for (const e of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { framed: false }]) assert.deepEqual(myAppsClick(e), [], JSON.stringify(e));
  // the link inside the finished-install toast is styled by the Store's CSS (readable ink, not the browser's blue)
  const doc = createDocument(); doc.body.innerHTML = `<div id="toast" class="toast" role="status">${ok[0]}</div>`; // the Store page's own toast (index.html)
  const link = doc.body.querySelector('[data-my-apps]');
  assert.equal(cascade(link, css).color?.value, 'var(--ink)');
  assert.doesNotMatch(store, /wizard:open-apps/);
});
