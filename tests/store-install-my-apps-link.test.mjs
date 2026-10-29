import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderInstallResult, successMessage } from '../web/store/store-install-result.js';

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

test('the Store binds that renderer to success and reserves top navigation for plain primary activation', () => {
  assert.match(store, /renderInstallResult\(\{ name: a\.name, message: m, ok \}\)/);
  assert.match(store, /say\(successMessage\(access\), true\)/);
  assert.match(store, /if \(!mine \|\| !framed \|\| e\.button !== 0 \|\| e\.metaKey \|\| e\.ctrlKey \|\| e\.shiftKey \|\| e\.altKey\) return/);
  assert.match(store, /window\.top\.location\.assign\(mine\.href\)/);
  assert.match(css, /\.toast\s+a/);
  assert.doesNotMatch(store, /wizard:open-apps/);
});
