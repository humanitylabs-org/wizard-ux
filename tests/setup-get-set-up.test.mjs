// Get set up (wizard-ux issue 1837, on for everyone): Setup's optional list of accounts to connect. Runs the
// real Setup page (web/setup/setup.js + get-set-up.js + phone-connect.js) in a shell frame against a fake box.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupApp, tick } from './fixtures/r7A-setup-harness.mjs';

const ORIGIN = 'https://wizard.example.test';
const SETUP = { first_run: false, items: [{ id: 'phone', state: 'todo' }] };
function shell() {
  const shell = { messages: [], opened: [],
    document: { documentElement: { getAttribute: () => null, dataset: {} } },
    postMessage: (m, o) => shell.messages.push([JSON.parse(JSON.stringify(m)), o]),
    WizOpenApp: (id, path) => { shell.opened.push([id, path]); return true; } };
  return shell;
}
// A box with Mail (connected), Messenger (nothing connected), Finances (a bank account), Calendar (an iCal source
// only) installed, and no Importer.
function box({ apps = true } = {}) {
  const seen = [];
  const reply = (url, o) => {
    seen.push([url, o.headers?.['X-Wizard-Request'] || '']);
    if (url === '/wizard/v1/apps') return apps ? [200, { apps: [
      { id: 'wizard-mail', name: 'Mail', url: '/wizard-mail/' },
      { id: 'messenger', name: 'Messenger', url: '/messenger/' },
      { id: 'finances', name: 'Finances', url: '/finances/' },
      { id: 'wizard-calendar', name: 'Calendar', url: '/wizard-calendar/' },
      { id: 'elsewhere', name: 'Other', url: 'https://other.example/' },
    ] }] : [503, {}];
    if (url === ORIGIN + '/wizard-mail/api/accounts') return o.headers?.['X-Wizard-Request'] === 'mail' ? [200, { sources: [], connected: true }] : [403, {}];
    if (url === ORIGIN + '/messenger/api/unified/connectors') return [200, { providers: [{ network: 'telegram', state: 'not_configured', logins: [] }] }];
    if (url === ORIGIN + '/finances/api/overview') return [200, { accounts: [{ id: 'a1', name: 'Checking' }] }];
    if (url === ORIGIN + '/wizard-calendar/api/live') return [200, { sources: [], connected: false }];
    if (url === ORIGIN + '/wizard-calendar/api/sources') return [200, { sources: [{ id: 's1', name: 'Work' }] }];
    return null;
  };
  return { reply, seen };
}
const rows = list => [...list.querySelectorAll('[data-gsu]')].map(b => [b.getAttribute('data-gsu'), b.getAttribute('data-state'),
  ['b', 'small', '.gsu-state'].map(sel => b.querySelector(sel).textContent).join(' | ')]);

// owner-facing: every owner sees this list in Setup, with no switch to turn on.
test('Get set up sits right after the phone row, five rows, connected ones show Done', async () => {
  const sh = shell(), b = box();
  const s = await setupApp({ setup: SETUP, getSetUp: { parent: sh, box: b.reply } });
  await tick(12);
  const html = s.list.innerHTML;
  assert.ok(html.indexOf('data-act="open-phone"') < html.indexOf('data-get-set-up'), 'after the phone item');
  assert.match(html, /<h2>Get set up<\/h2><p class="intro">Optional\./);
  assert.deepEqual(rows(s.list), [
    ['wizard-mail', 'done', 'Email | I can sort your email and draft replies. | Done'],
    ['messenger', 'todo', 'Messages | I can keep up with your chats in one inbox. | Not started'],
    ['finances', 'done', 'Money | I can follow your spending and accounts. | Done'],
    ['wizard-calendar', 'done', 'Calendar | I can see your day and plan around it. | Done'],
    ['importer', 'todo', 'Bring what your old AI knows | I learn what ChatGPT or Claude already know about you. | Not started'],
  ]);
  // The Importer isn't installed and the other origin is never read.
  assert.ok(!b.seen.some(([u]) => /importer|other\.example/.test(u)));
  assert.ok(b.seen.some(([u, m]) => u.endsWith('/wizard-mail/api/accounts') && m === 'mail'));
});

test('tap: an installed app opens itself; one not installed opens its Store page, which opens it once installed', async () => {
  const sh = shell(), b = box();
  const s = await setupApp({ setup: SETUP, getSetUp: { parent: sh, box: b.reply } });
  await tick(12);
  await s.tap('[data-gsu="messenger"]');
  assert.deepEqual(sh.messages.map(m => m[0]), [{ type: 'wizard:open-app', id: 'messenger' }]);
  assert.equal(sh.messages[0][1], ORIGIN);
  await s.tap('[data-gsu="importer"]');
  assert.deepEqual(sh.opened, [['app-store', '/wizard-os-home/store/index.html?app=importer&open=1']]);
});

test('a connection made in the app shows Done the next time Setup comes back into view', async () => {
  const sh = shell(), b = box();
  let linked = false;
  const reply = (url, o) => (url.endsWith('/messenger/api/unified/connectors') ? [200, { providers: [{ state: linked ? 'connected' : 'not_configured', logins: [] }] }] : b.reply(url, o));
  const s = await setupApp({ setup: SETUP, getSetUp: { parent: sh, box: reply } });
  await tick(12);
  assert.equal(s.list.querySelector('[data-gsu="messenger"]').getAttribute('data-state'), 'todo');
  linked = true;
  for (const l of s.doc.listeners.visibilitychange || []) l.f({ type: 'visibilitychange' });
  await tick(12);
  assert.equal(s.list.querySelector('[data-gsu="messenger"]').getAttribute('data-state'), 'done');
});

test('no switch: a shell with no tweaks at all still shows the list', async () => {
  const sh = shell(), b = box();
  const s = await setupApp({ setup: SETUP, getSetUp: { parent: sh, box: b.reply } });
  await tick(12);
  assert.equal(s.list.querySelectorAll('[data-gsu]').length, 5);
  assert.ok(b.seen.some(([u]) => u === '/wizard/v1/apps'));
});

test('a box that cannot list its apps still shows the rows, none Done, and says it can’t check', async () => {
  const sh = shell(), b = box({ apps: false });
  const s = await setupApp({ setup: SETUP, getSetUp: { parent: sh, box: b.reply } });
  await tick(12);
  assert.deepEqual(rows(s.list).map(r => r[1]), ['todo', 'todo', 'todo', 'todo', 'todo']);
  assert.match(s.list.innerHTML, /Can’t check what’s connected right now/);
});
