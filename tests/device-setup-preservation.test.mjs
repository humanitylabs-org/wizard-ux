import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setupApp } from './fixtures/r7A-setup-harness.mjs';
import { styles } from './fixtures/w5-css.mjs';
import { valueOf, noImports } from './fixtures/r7A-css.mjs';
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
// The stylesheets web/setup/index.html links, in its order.
const SHEETS = noImports(['web/core/phone-connect.css', 'web/kit/wizard-tokens.css', 'web/setup/setup.css', 'web/kit/wizard-ui.css'].map(read));
const DONE = { first_run: false, items: [{ id: 'phone', title: 'Connect another device', state: 'done' }] };

test('completed Setup retains its separate spaced tinted connect-another entry', async () => {
  const s = await setupApp({ setup: DONE });
  const row = s.list.querySelector('button.row.wz-row[data-act="open-phone"]');
  assert.ok(row, 'the checklist row');
  assert.equal(row.querySelector('b').textContent, 'Device connected');
  const add = s.list.querySelector('button.wz-button.add-device[data-act="list-connect-device"]');
  assert.ok(add, 'a separate connect-another button under the completed row');
  assert.equal(add.textContent, 'Connect another device');
  assert.ok(!row.contains(add), 'not inside the row');
  const css = styles(add, SHEETS);
  assert.equal(css['margin-top'], '16px', 'spaced from the row');
  assert.equal(css.background, 'var(--acs)', 'tinted');
  assert.equal(css.color, 'var(--ac)');

  // Not done: no separate entry.
  const todo = await setupApp({ setup: { items: [{ id: 'phone', state: 'todo' }] } });
  assert.equal(todo.list.querySelector('.add-device'), null);
  assert.equal(todo.list.querySelector('[data-act="open-phone"] b').textContent, 'Connect another device');

  // The entry opens the phone screen straight into the connect-another flow.
  await s.tap('[data-act="list-connect-device"]');
  assert.equal(s.phone.hidden, false); assert.equal(s.list.hidden, true);
  assert.ok(s.phone.querySelector('[data-pc-flow]'), 'the connect-another flow, not the device list');
  assert.match(s.phone.textContent, /Before you scan/);

  // The row itself opens the phone screen without the flow; its menu and disconnect sheet use the shared WzSheet.
  const r = await setupApp({ setup: DONE });
  await r.tap('[data-act="open-phone"]');
  assert.equal(r.phone.hidden, false);
  assert.equal(r.phone.querySelector('[data-pc-flow]'), null);
  await r.tap('[data-act="menu"]');
  await r.tap('[data-act="ask-reset"]');
  assert.deepEqual(r.sheets, [['open', 'menu'], ['close', 'menu'], ['open', 'sheet']]);
});

test('step two completion retains a green shared check and Show again', async () => {
  const s = await setupApp({ setup: DONE });
  await s.tap('[data-act="list-connect-device"]');
  const step = () => s.phone.querySelector('[data-pc-step="2"]');
  assert.equal(step().querySelector('h5').className, '', 'not complete yet');
  await s.tap('[data-pc="step2-done"]');
  const h5 = step().querySelector('h5');
  assert.equal(h5.className, 'pc-step-complete');
  const check = h5.querySelector('span.pc-check');
  assert.ok(check, 'the shared check'); assert.equal(check.textContent, '✓'); assert.equal(check.getAttribute('aria-hidden'), 'true');
  const again = step().querySelector('[data-pc="step2-again"]');
  assert.equal(again?.textContent, 'Show again');
  assert.equal(styles(h5, SHEETS).color, 'var(--pc-ok)', 'the heading is the ok colour');
  const green = valueOf(h5, SHEETS, 'color');
  assert.equal(green, valueOf(check, SHEETS, 'color'), 'same green as the shared check');
  assert.match(green, /^#[0-9a-f]{6}$/i);
  await s.tap('[data-pc="step2-again"]');
  assert.equal(step().querySelector('h5').className, '', 'Show again brings the step back');
  assert.ok(step().querySelector('[data-pc="step2-done"]'));
});
