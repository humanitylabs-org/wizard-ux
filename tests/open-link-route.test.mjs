// A chat link to `/?open=<app>` (the link the app builder hands the owner, issue 1875) opens that app through the
// shell's deep link router, never Wizard inside a link window titled with the bare host.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const src = f => readFileSync(new URL('../web/' + f, import.meta.url), 'utf8');

function deeplink(origin = 'https://wizard.example') {
  const location = new URL(origin + '/wizard-os-home/'), calls = [];
  const window = {WizCore: {}, location, history: {replaceState() {}}};
  vm.runInNewContext(src('core/deeplink.js'), {window, location, URL, URLSearchParams, console, document: {}, history: window.history});
  const D = window.WizCore.deeplink;
  D.handle({app: id => calls.push(['app', id]), view: (v, s, i) => calls.push(['view', v, i]), thread: s => calls.push(['thread', s])});
  return {D, calls};
}

test('/?open=<app> is the shell’s own route, never a link window', () => {
  const {D, calls} = deeplink();
  for (const href of ['/?open=galaxy-calc', '/wizard/?open=galaxy-calc', 'https://wizard.example/?open=galaxy-calc']) {
    assert.equal(D.route(href), true, href);
    assert.deepEqual(calls.at(-1)?.slice(0, 2), ['app', 'galaxy-calc'], href);
  }
  const n = calls.length;
  assert.equal(D.route('/'), false);   // the bare root stays not ours
  for (const href of ['/?open=bad_id!', '/other/?open=galaxy-calc', 'https://other.example/?open=galaxy-calc']) assert.equal(D.route(href), false, href);
  assert.equal(calls.length, n);
});

test('a link window to the bare origin is never titled with the host', () => {
  const window = {WizCore: {}};
  vm.runInNewContext(src('app-linkdesk.js'), {window, URL, console});
  const {linkTitle} = window.WizCore.appParts.linkdesk({APPS: [{id: 'files', name: 'Files', url: '/files/'}], appVars: {}});
  assert.equal(linkTitle(new URL('http://127.0.0.1:47000/?open=galaxy-calc')), 'Wizard');
  assert.equal(linkTitle(new URL('https://wizard.example/')), 'Wizard');
  assert.equal(linkTitle(new URL('https://wizard.example/files/a.txt')), 'Files');
  assert.equal(linkTitle(new URL('https://wizard.example/some-page/')), 'Some Page');
});
