import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const setup = read('web/setup/setup.js');
const css = read('web/setup/setup.css');
const pc = read('web/core/phone-connect.js');
const pcCss = read('web/core/phone-connect.css');
test('completed Setup retains its separate spaced tinted connect-another entry', () => {
  assert.match(setup, /if \(st === 'done'\) h \+= '<button class="wz-button add-device" data-act="list-connect-device">Connect another device<\/button>'/);
  assert.match(setup, /act === 'list-connect-device'\) openPhone\(true\)/);
  assert.match(setup, /if \(another\) PC.connectAnother\(\)/);
  assert.match(setup, /st === 'done' \? 'Device connected'/);
  assert.match(css, /\.wz-button\.add-device\s*\{[^}]*margin-top:\s*16px;[^}]*background:\s*var\(--acs\);[^}]*color:\s*var\(--ac\)/);
});
test('step two completion retains a green shared check and Show again', () => {
  assert.match(pc, /S\.step2Done \? ' class="pc-step-complete"'/);
  assert.match(pc, /S\.step2Done \? '<span class="pc-check" aria-hidden="true">✓<\/span>'/);
  assert.match(pc, /btn\('step2-again', 'Show again'/);
  assert.match(pcCss, /h5\.pc-step-complete\s*\{[^}]*color:var\(--pc-ok\)/);
});
