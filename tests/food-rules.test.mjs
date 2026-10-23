// Food rules moved from android/.../usuals/UsualsPolicy.java to web/food/rules.js. These are UsualsPolicyTest and
// UsualsIdentityTest ported case for case, plus the shared voice table both orbs use.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = { window: {} };
vm.runInNewContext(readFileSync(new URL('../web/food/rules.js', import.meta.url), 'utf8'), ctx);
const R = ctx.window.WosFoodRules;
const tap = (l, near = '') => R.step('tap', l, '', near);
const type = t => R.step('type', t);

test('commit buttons are recognised (and kept out of recipes)', () => {
  for (const s of ['Place order', 'Place Order ฿245', 'Place order · ฿245', 'PLACE ORDER', 'Order now', 'Pay now', 'Confirm order', 'Swipe to order', 'ยืนยันคำสั่งซื้อ', 'สั่งอาหาร ฿120', 'Pay ฿245'])
    assert.ok(R.isCommit(s), s);
  for (const s of ['Add', 'View basket · 1 item', 'Order history', 'Krua Thai Kitchen', 'Reorder', 'Search', '', 'Orders', 'Ordering for someone else?', 'Payment methods', 'Order nowhere'])
    assert.ok(!R.isCommit(s), s);
});

test('recipes never contain commit taps', () => {
  const t = R.tidy([tap('Krua Thai Kitchen'), tap('Add', 'Kra pao moo saap'), tap('View basket · 1 item'), tap('Place order ฿245')]);
  assert.equal(t.length, 3);
  assert.ok(!R.write(t).toLowerCase().includes('place order'));
  assert.equal(R.parse('tap Krua Thai Kitchen\ntap Place order\nPay now\ntap Add @ Kra pao').length, 2);
});

test('typing collapses to final text; two taps on plus stay two', () => {
  assert.equal(R.write(R.tidy([tap('Search'), type('k'), type('kr'), type('krua'), tap('Krua Thai Kitchen')])), 'tap Search\ntype krua\ntap Krua Thai Kitchen');
  assert.equal(R.tidy([tap('+', 'Thai iced tea'), tap('+', 'Thai iced tea')]).length, 2);
});

test('write and parse round trip', () => {
  const s = 'tap Not now\ntap Search for dishes\ntype krua\nsearch\ntap Krua Thai Kitchen\ntap Add @ Kra pao moo saap\nwait 1500\ntap View basket';
  assert.equal(R.write(R.parse(s)), s);
  const add = R.parse(s)[5];
  assert.equal(add.label, 'Add'); assert.equal(add.near, 'Kra pao moo saap');
  assert.ok(R.optional(R.parse('tap Not now')[0]));
  assert.ok(!R.optional(R.parse('tap Add')[0]));
  assert.equal(R.parse('wait 999999999')[0].label, '10000');
});

test('generic labels, basket changers, addresses', () => {
  assert.ok(R.isGeneric('Add')); assert.ok(R.isGeneric('+')); assert.ok(R.isGeneric('฿65')); assert.ok(!R.isGeneric('Kra pao moo saap'));
  for (const s of ['Add', 'Add to basket · ฿65', '+', 'เพิ่ม']) assert.ok(R.isAddLabel(s), s);
  for (const s of ['Address', 'Add a note for the driver', 'Place order ฿245']) assert.ok(!R.isAddLabel(s), s);
  assert.ok(R.isRemoveLabel('−')); assert.ok(R.isRemoveLabel('Remove'));
});

test('totals', () => {
  assert.equal(R.totalOf(['Kra pao moo saap', '฿65', 'Delivery fee', '฿25', 'Total', '฿245', 'Place order ฿245']), '฿245');
  assert.equal(R.totalOf(['Total ฿245']), '฿245');
  assert.equal(R.totalOf(['Place order ฿1,245']), '฿1,245');
  assert.equal(R.totalOf(['ยอดรวม', '90 บาท']), '฿90');
  assert.equal(R.totalOf(['Kra pao', 'Add']), null);
});

/* ---------------- browse first ("Order something new"): native sends events, web works out the route ---------- */
function recorder() {
  let now = 0; const ev = [];
  return {
    ev,
    screen(s) { now += 700; ev.push({ t: now, screen: s }); },
    tap(l, near = '') { now += 300; ev.push({ t: now, step: { type: 'tap', label: l, id: '', near } }); },
    type(t) { now += 150; ev.push({ t: now, step: { type: 'type', label: t, id: '', near: '' } }); },
    route(checkout = null) { return R.write(R.tidy(R.path(R.recsOf(ev), checkout))); },
    got(checkout = null) { return R.fromRecording({ events: ev, checkout }); },
  };
}

test('browsing detours are taken out', () => {
  const r = recorder();
  r.screen('home'); r.tap('Not now'); r.type('k'); r.type('kr'); r.type('krua'); r.screen('results');
  r.tap('Kruang Burger'); r.screen('menu kruang'); r.tap('Reviews'); r.screen('reviews'); r.screen('menu kruang'); r.screen('results');
  r.tap('Krua Thai Kitchen'); r.screen('menu krua');
  r.tap('Add', 'Kra pao moo saap'); r.tap('Add', 'Kra pao moo saap'); r.tap('Add', 'Thai iced tea'); r.tap('View basket · 3 items'); r.screen('checkout');
  assert.equal(r.route(), 'tap Not now\ntype krua\ntap Krua Thai Kitchen\ntap Add @ Kra pao moo saap\ntap Add @ Kra pao moo saap\ntap Add @ Thai iced tea\ntap View basket · 3 items');
  const g = r.got();
  assert.equal(g.basket, '2× Kra pao moo saap · 1× Thai iced tea');
  assert.equal(g.suggested, 'Kra pao moo saap + Thai iced tea');
  assert.equal(g.place, 'Krua Thai Kitchen');
});

test('item page loop is kept', () => {
  const r = recorder();
  r.screen('home'); r.tap('Krua Thai Kitchen'); r.screen('menu'); r.tap('Kra pao moo saap'); r.screen('dish'); r.tap('Pork'); r.tap('Add to basket · ฿65');
  r.screen('menu'); r.tap('Som tam thai'); r.screen('dish 2'); r.screen('menu'); r.tap('View basket · 1 item'); r.screen('checkout');
  assert.equal(r.route(), 'tap Krua Thai Kitchen\ntap Kra pao moo saap\ntap Pork\ntap Add to basket · ฿65\ntap View basket · 1 item');
  const g = r.got();
  assert.equal(g.basket, '1× Kra pao moo saap'); assert.equal(g.suggested, 'Kra pao moo saap'); assert.equal(g.place, 'Krua Thai Kitchen');
});

test('removed items leave the recipe', () => {
  const r = recorder();
  r.screen('menu'); r.tap('Add', 'Kra pao moo saap'); r.tap('Add', 'Pad thai'); r.tap('Add', 'Thai iced tea'); r.tap('−', 'Thai iced tea');
  r.tap('View basket · 2 items'); r.screen('checkout');
  assert.equal(r.route(['Review order', '1× Kra pao moo saap   ฿65', 'Delivery fee ฿25', 'Total', '฿90', 'Place order ฿90']), 'tap Add @ Kra pao moo saap\ntap View basket · 2 items');
});

test('promo pop-up closers survive', () => {
  const r = recorder();
  r.screen('home'); r.screen('promo'); r.tap('Not now'); r.screen('home'); r.type('krua'); r.screen('results'); r.tap('Krua Thai Kitchen'); r.screen('menu'); r.tap('Add', 'Kra pao moo saap');
  assert.equal(r.route(), 'tap Not now\ntype krua\ntap Krua Thai Kitchen\ntap Add @ Kra pao moo saap');
});

test('names keep it short', () => {
  const st = [tap('Krua Thai Kitchen'), tap('Add', 'Kra pao moo saap'), tap('Add', 'Pad thai'), tap('Add', 'Thai iced tea'), tap('Add', 'Pad thai')];
  assert.equal(R.suggestName(st, null), 'Pad thai + 2 more');
  assert.equal(R.suggestName([], null), 'Grab order');
});

test('a native recording outcome becomes a saved order, total from checkout', () => {
  const g = R.fromRecording({ events: [{ t: 1, screen: 'menu' }, { t: 2, step: { type: 'tap', label: 'Add', near: 'Kra pao' } }, { t: 3, step: { type: 'tap', label: 'View basket' } }, { t: 4, screen: 'checkout' }],
    checkout: ['Kra pao', 'Total', '฿90', 'Place order ฿90'], total: '' });
  assert.equal(R.write(g.steps), 'tap Add @ Kra pao\ntap View basket');
  assert.equal(g.total, '฿90');
  assert.deepEqual(R.fromRecording({ events: [] }).steps.length, 0);
});

/* ---------------- voice: the shared table (in-app orb here, floating orb/side button on the phone) ---------------- */
const pick = (names, said) => {
  const list = names.map((name, i) => ({ id: 'u' + i, name }));
  const a = R.matchTable(R.voiceTable(list), said);
  return a == null || a === '+new' ? -1 : +a.slice(1);
};
const browse = (said, names = []) => R.matchTable(R.voiceTable(names.map((name, i) => ({ id: 'u' + i, name }))), said) === '+new';
// The shell strips the wake words ("Hey Saffron,") with WizConfig.stripAddress before matching; native does the same.
const strip = s => s.replace(/^(?:(?:hey|ok|okay)\s+)?(?:Wizard|Saffron)(?:[,.!]?\s+|[,.!]?$)/i, '');

test('voice matching picks the saved order (UsualsPolicyTest.voiceMatching)', () => {
  const names = ['Kra pao', 'Som tam & sticky rice', 'Morning coffee'];
  assert.equal(pick(names, 'Order my usual kra pao'), 0);
  assert.equal(pick(names, strip('Hey Wizard, order kra pao please.')), 0);
  assert.equal(pick(names, 'get me som tam'), 1);
  assert.equal(pick(names, 'reorder my morning coffee'), 2);
  assert.equal(pick(names, "what's a good kra pao place"), -1);
  assert.equal(pick(names, 'order a taxi to the airport'), -1);
  assert.equal(pick(names, 'order my usual'), -1);
  assert.equal(pick(['Kra pao'], 'order my usual'), 0);
  assert.equal(pick(['Kra pao chicken', 'Kra pao pork'], 'order kra pao'), -1); // tie: ask
});

test('order something new by voice', () => {
  for (const s of ['Order something new', 'order something', strip('Hey Wizard, order something new.'), 'order food', 'order something from Grab', 'get me some food', 'get me food from grab', 'order something to eat', 'grab me something to eat'])
    assert.ok(browse(s), s);
  for (const s of ['I want something else', 'order my usual kra pao', 'get me a taxi', 'what should I order', 'order a taxi to the airport', 'get me something'])
    assert.ok(!browse(s), s);
});

test('food spells (James, 12 Oct)', () => {
  for (const s of ['Order grab.', 'Order food.', 'order Grab food', 'order grabfood', 'order from Grab', 'order on grab', 'Order lunch', 'order dinner on Grab', 'order breakfast from grab', 'order a snack',
    'order takeout', 'order delivery', strip('Hey Wizard, order food please'), strip('Okay Wizard order food'), 'I want to order food', "I'd like to order dinner", 'I\u2019d like to order lunch', 'I wanna order food',
    "let's order food", 'can you order food', 'please order food', 'get food', 'get me some food', 'grab food', 'grab me food', 'food order', 'a grab order', 'new food order', 'order foods',
    'order me some food', 'order something new', 'order food now'])
    assert.ok(browse(s), s);
  for (const s of ['food', 'what food should I order', 'food is great', 'the grab driver is late', 'order a taxi', 'order my usual kra pao', 'order kra pao', 'order the pizza', 'I like food', 'grab a coffee', 'order pizza for the team meeting'])
    assert.ok(!browse(s), s);
});

test('a saved order named like a spell wins', () => {
  const names = ['Kra pao moo saap + Thai iced tea', 'Lunch'];
  assert.equal(pick(names, 'Order lunch.'), 1);
  assert.ok(browse('order food', names)); assert.ok(browse('order grab', names));
  assert.ok(browse('order lunch'));
});

test('the table native gets is plain anchored Java-compatible regex', () => {
  const t = R.voiceTable([{ id: 'u1', name: 'Kra pao (moo) + tea?' }, { id: 'u2', name: 'Lunch' }]);
  for (const e of t) {
    assert.match(e.pattern, /^\^.*\$$/);
    assert.ok(!/\(\?<[=!]|\\p\{|\(\?<\w/.test(e.pattern), 'no lookbehind / named groups / unicode classes: ' + e.pattern);
    new RegExp(e.pattern);
    assert.ok(Number.isInteger(e.priority) && e.priority >= 0 && e.priority <= 1000);
  }
  assert.equal(R.matchTable(t, 'order kra pao (moo) + tea?'), 'u1');
});
