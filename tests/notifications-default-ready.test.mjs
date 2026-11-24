import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import { withAppParts } from './fixtures/app-parts.mjs';
import { withShellParts } from './fixtures/shell-parts.mjs';
import { withWebParts } from './fixtures/web-parts.mjs';
import { between, block } from './fixtures/source-slice.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { unreadWorld, runIn, UNREAD } from './fixtures/r8B-unread.mjs';
import { listFixture, sectionKeys } from './fixtures/chats-list-render.mjs';
const read = p => withAppParts(withShellParts(withWebParts(readFileSync(new URL('../'+p, import.meta.url), 'utf8'))));

test('notification-only Ready survives an empty default main-agent Chats list', () => {
  const src = read('web/core/chats.js');
  // Evaluate the real eligibility expression across every Focus/status/search boundary.
  const expr = src.match(/const listNotes = ([^;]+);/)[1];
  for (const [n,F,AGID,focus,visible] of [
    ['',null,'',null,true], ['',null,'',{kind:'agent',key:'hermes'},true],
    ['',null,'other',{kind:'agent',key:'other'},false], ['',null,'',{kind:'space',key:'test'},false],
    ['query',null,'',null,false], ['',{label:'Working'},'',null,false],
  ]) assert.equal(!!vm.runInNewContext(expr,{n,F,AGID,focus,notes:()=>({awake:[{}],later:[]})}),visible);
  // The real list renderer with no chats at all: notifications alone still draw Ready instead of the empty state.
  const paint = (n, q = '') => { const f = listFixture({ inputRows: [] }); f.ctx.notes = () => ({ awake: Array.from({ length: n }, (_, i) => ({ id: 'notif:' + i })), later: [] }); const html = f.render(q); return { html, secs: sectionKeys(html), empty: /No threads match/.test(html) }; };
  const only = paint(2);
  assert.ok(only.secs.includes('ready'), 'notification-only Ready shows'); assert.equal(only.empty, false, 'no empty state over it');
  assert.ok(!only.secs.includes('yesterday') && !only.secs.includes('pastWeek'), 'notifications sit in Ready only');
  const none = paint(0);
  assert.deepEqual(none.secs, []); assert.equal(none.empty, true, 'nothing at all: the empty state, as before');
  const searched = paint(2, 'zz');
  assert.ok(!searched.secs.includes('ready'), 'a search lists no notification-only Ready'); assert.equal(searched.empty, true, 'and says nothing matched');
});

test('Ready inventory retains unread and snoozed notification rows but not completed rows or an off inbox', async () => {
  let items=[{id:'unread',read:false},{id:'snoozed',read:true},{id:'done',archived:true}], events=[];
  const window={WosSkinHost:{inboxList:true},WizCore:{backendApps:()=>[{id:'notifications'}]},dispatchEvent:e=>events.push(e.type)};
  const ctx={window,document:{querySelectorAll:()=>[],addEventListener(){}},location:{origin:'https://wizard.example.test'},addEventListener(){},setInterval(){},setTimeout(){},CustomEvent:class{constructor(type){this.type=type;}},fetch:async url=>({ok:true,json:async()=>url.includes('/items')?{items}:{unread:1,needs:1}})};
  vm.runInNewContext(read('web/core/notif-bell.js'),ctx);
  const bell=window.WosBell;
  bell.watch(()=>{}); await new Promise(r=>setImmediate(r));
  assert.equal(bell.readyCount(),2); assert.ok(events.includes('wizard:notifications'));
  window.WosSkinHost.inboxList=false; assert.equal(bell.readyCount(),0);
  window.WosSkinHost.inboxList=true;
  items=items.map(i=>({...i,archived:true}));
  await bell.mark(['unread','snoozed'],{archived:true}); assert.equal(bell.readyCount(),0);
});

// Runs the real phone Home (app-home.js), phone orb badge (app-inbox.js renderMoons), desktop Home (desktop-home.js)
// and desktop bar (desktop-steps.js paintBar) on a world where the Ready inventory (5 threads, 7 inbox items) and
// the unread projection (2 + 1) differ (tests/fixtures/r8B-unread.mjs): every pill says 3, and a notification change
// repaints both shells.
test('Home and both shells use the shared unread projection, never the notification Ready inventory', () => {
  const raw = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
  // phone Home: the Ready card, and wizard:notifications repaints Home and the moons
  { const w = unreadWorld(); vm.runInContext(raw('web/app-home.js'), w.win); let homes = 0, moons = 0;
    const H = w.win.WizCore.appParts.home({ $: () => null, DOWL: ['Sun'], MON: ['Jan'], gearBtn: () => '', live: () => ({ needs: [], ready: [], working: [] }), LIVE: w.LIVE, refreshHome: () => homes++, sideCard: () => '', unsentCard: () => '' });
    H.bindLate({ renderMoons: () => moons++ });
    const doc = createDocument(); doc.body.innerHTML = H.renderHome();
    const card = doc.body.querySelector('[data-act="ready"]');
    assert.equal(card.getAttribute('aria-label'), `Ready, ${UNREAD} unread`, 'phone Home Ready card');
    assert.equal(card.querySelector('.n')?.textContent, String(UNREAD));
    w.fire('wizard:notifications'); assert.deepEqual([homes, moons], [1, 1], 'phone: a notification change repaints Home and the orb'); }
  // phone orb/dock badge
  { const w = unreadWorld(), doc = createDocument(); doc.body.innerHTML = '<div id="moons"></div><div id="orbWrap"></div>';
    const c = runIn(w, block(raw('web/app-inbox.js'), '  function renderMoons() {') + '\nglobalThis.renderMoons = renderMoons;', { $: q => doc.body.querySelector(q), live: () => ({ needs: [], ready: [1, 2, 3, 4, 5], working: [] }), CHATS_APP: { id: 'wizard' }, Math });
    c.renderMoons(); assert.equal(w.C.workspaceNav.label('wizard'), String(UNREAD), 'phone Chats badge'); }
  // desktop Home line
  { const w = unreadWorld(); vm.runInContext(raw('web/desktop/desktop-home.js'), w.win);
    const D = w.win.WizCore.desktopParts.home({ ago: () => '', APP: {}, APPS: [], C: w.C, emoOf: () => '', esc: String, ico: () => '', LIVE: { ...w.LIVE, cardAt: () => 0 }, MOD: '⌥', OUTBOX: null });
    const doc = createDocument(); doc.body.innerHTML = D.homeHtml();
    assert.match(doc.body.querySelector('.home-line').textContent, new RegExp(`, ${UNREAD} unread, 1 working`), 'desktop Home line'); }
  // desktop bar: the Chats badge and the status pill, and wizard:notifications repaints
  { const w = unreadWorld(), doc = createDocument(), steps = raw('web/desktop/desktop-steps.js'); doc.body.innerHTML = '<div id="logo"></div><div id="wsList"></div><div id="status"></div>';
    const c = runIn(w, block(steps, '  function paintBar() {') + '\n' + between(steps, "  addEventListener('wizard:notifications',", '  function paintBar() {') + '\nglobalThis.paintBar = paintBar;',
      { $: q => doc.body.querySelector(q), APP: { wizard: { id: 'wizard' } }, desktopVars: { homeOpen: true, ws: [], cur: 0, W: {} }, esc: String, MOD: '⌥' });
    c.paintBar();
    assert.equal(w.C.workspaceNav.label('wizard'), String(UNREAD), 'desktop Chats badge');
    assert.equal(doc.body.querySelector('#status [title="Unread"]')?.textContent, String(UNREAD), 'desktop status pill');
    c.calls.length = 0; w.fire('wizard:notifications'); assert.deepEqual(c.calls.map(x => x[0]), ['render'], 'desktop: a notification change repaints'); }
});
