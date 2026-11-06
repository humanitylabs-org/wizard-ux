// Execute the phone adapter, including its real desk-transition guard: a view's
// deferred Home chat preparation must not close or park the Look sheet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const show = section('  function showChats(', '  /* Home\'s Unread');
const go = section('  function goDesk(', '  function announce(');
function fixture({ settings, existing }) {
  const closes = [], parks = [], panel = { page: 'appearance', open: settings };
  const ctx = {
    sheet: settings ? 'settings' : 'launcher', idx: 0, HOME: 0, lastMove: null,
    desks: [{ id: 'home', home: true, wins: [] }, { id: 'chat', wins: existing ? ['c'] : [], focus: 'c' }],
    W: existing ? { c: { id: 'c', app: 'chats', thread: null } } : {},
    mainChats: w => w.app === 'chats', deskOf: id => ctx.desks.findIndex(d => d.wins.includes(id)),
    closeSheets: () => { closes.push('close'); ctx.sheet = null; panel.open = false; },
    liftSettings: () => { parks.push('park'); ctx.sheet = null; panel.open = false; },
    APP: { wizard: { id: 'wizard' } },
    openApp: (a, extra, opts = {}) => {
      ctx.W.c = { id: 'c', app: 'chats', thread: null }; ctx.desks[1].wins = ['c'];
      // openWin/placeApp follow stay; otherwise they navigate immediately.
      if (!opts.stay) ctx.goDesk(1, true);
    },
    focusWin: id => { ctx.desks[ctx.idx].focus = id; },
    CHATS: { beforeNavigate: () => true, CH: {} }, LINKS: null,
    window: { WosResources: { back() {}, sync() {} }, WosScenery: { update() {} }, WosSetupLaunch: { desk() {} }, WosSkinHost: { changed() {} } },
    placeTrack() {}, renderDots() {}, save() {}, scheduleParking() {}, syncImmersive() {}, syncReviewChip() {}, syncBound() {},
    vib() {}, markVisibleThreadsSeen() {}, announce() {},
  };
  vm.runInNewContext(go + '\n' + show + '\nthis.showChats=showChats;this.goDesk=goDesk;', ctx);
  return { ctx, closes, parks, panel };
}
test('phone AI apps preparation preserves the exact Settings sheet and Look page, with and without an existing Chats desk', () => {
  for (const existing of [true, false]) {
    const { ctx, closes, parks, panel } = fixture({ settings: true, existing });
    assert.equal(ctx.showChats()?.id, 'c');
    assert.equal(ctx.idx, 1, 'the background chat is prepared');
    assert.equal(ctx.sheet, 'settings', 'no close/reopen workaround');
    assert.deepEqual(panel, { page: 'appearance', open: true });
    assert.deepEqual(closes, []); assert.deepEqual(parks, [], 'do not lift Settings onto the old desk');
  }
});
test('enabling AI apps over the existing frontmost Chats list keeps Settings without a desk transition', () => {
  const { ctx, closes, parks, panel } = fixture({ settings: true, existing: true });
  ctx.idx = 1;
  assert.equal(ctx.showChats()?.id, 'c');
  assert.equal(ctx.idx, 1); assert.equal(ctx.sheet, 'settings');
  assert.deepEqual(panel, { page: 'appearance', open: true });
  assert.deepEqual(closes, []); assert.deepEqual(parks, []);
});
test('ordinary chat navigation still dismisses launchers, and explicit desk navigation still parks Settings', () => {
  for (const existing of [true, false]) {
    const { ctx, closes } = fixture({ settings: false, existing });
    assert.equal(ctx.showChats()?.id, 'c'); assert.deepEqual(closes, ['close']);
  }
  const { ctx, parks } = fixture({ settings: true, existing: true });
  ctx.goDesk(1, true); assert.deepEqual(parks, ['park']);
});
