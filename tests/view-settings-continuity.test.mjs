// A layout's automatic Home -> Chats preparation must not dismiss the Look picker.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import { withShellParts } from './fixtures/shell-parts.mjs';
import { withWebParts } from './fixtures/web-parts.mjs';
import { between, runRecording } from './fixtures/source-slice.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { partScope, runPartRecording } from './fixtures/r5A-parts.mjs';
import { deskWorld, layout, settle } from './fixtures/ai-apps-world.mjs';
const source = withShellParts(withWebParts(readFileSync(new URL('../web/desktop/desktop.js', import.meta.url), 'utf8')));
const start = source.indexOf('  function leaveHome() {');
const leave = source.slice(start, source.indexOf('\n  function goHome()', start));
test('view mount preserves the same Settings modal/page while classic navigation still closes it', () => {
  for (const over of [true, false]) for (const modal of [true, false]) for (const home of [true, false]) {
    const panel = {hidden: !modal, page: 'appearance'}, writes = [], calls = [];
    const ctx = {window:{WosResources:{back:()=>calls.push('resources')}}, globalThis:{WosSkinHost:{panelMode:false}},
      homeOpen:home, settingsModal:modal, settingsOver:()=>over,
      closeSettings:()=>{calls.push('close'); panel.hidden=true; panel.page='overview';},
      store:{set:(...a)=>writes.push(a)}, render:()=>calls.push('render')};
    vm.runInNewContext(leave+';leaveHome()',ctx);
    const closed = home && modal && !over;
    assert.equal(calls.includes('close'), closed, JSON.stringify({over,modal,home}));
    assert.equal(panel.hidden, !modal || closed);
    assert.equal(panel.page, closed ? 'overview' : 'appearance');
    assert.equal(ctx.homeOpen, false);
    assert.equal(calls.includes('render'), home);
  }
});
// Runs the real AI apps desktop view (deskWorld) mounting on Home, then the shell's real side of the contract: the
// settingsOverlay adapter (desktop-resize.js) with the real Settings host part (desktop-settingshost.js), its scrim, and
// the real Esc owner line (desktop-pickany.js).
test('AI apps sets the everywhere-modal contract before preparing its Home chat', async () => {
  const { w } = deskWorld(); w.st.route = { home: true, view: 'list', thread: null, desk: 0, app: 'chats' };
  const atNewChat = [];
  w.api.sessions.newChat = () => { atNewChat.push(w.html.dataset.settingsOver !== undefined); return true; };
  (await layout()).default(w.api);
  for (let i = 0; i < 5 && !atNewChat.length; i++) { w.run(); await settle(); }
  assert.deepEqual(atNewChat, [true], 'the Home chat is prepared with Settings already an everywhere-modal');
  // the shell: an open Settings becomes the centred modal, its scrim and Esc close it, release undoes the contract
  const doc = createDocument(), setEl = doc.createElement('section'); setEl.id = 'dsettings'; doc.body.append(setEl);
  const desktopVars = { settingsModal: false, homeOpen: false, settingsPromoted: false };
  const part = await runPartRecording('desktop/desktop-settingshost.js', 'desktopParts', 'settingshost', { desktopVars, setEl, settingsWin: () => null, focused: () => null, winEl: () => null }, partScope({ document: doc }));
  const closes = []; part.out.bindLate({ closeSettings: () => closes.push('close'), settingsOver: () => doc.documentElement.hasAttribute('data-settings-over') });
  const resize = readFileSync(new URL('../web/desktop/desktop-resize.js', import.meta.url), 'utf8');
  const ad = runRecording(`globalThis.ad = {\n${between(resize, '    settingsOverlay: () => {', '    panes: C.panes,')}\n};`, { document: doc, hostSettings: part.out.hostSettings }).ad;
  const release = ad.settingsOverlay();
  assert.equal(doc.documentElement.hasAttribute('data-settings-over'), true);
  assert.equal(desktopVars.settingsModal, true, 'an open Settings is taken over as the modal, not closed');
  assert.ok(setEl.classList.contains('is-modal')); assert.equal(setEl.parentNode, doc.body); assert.equal(part.out.scrim.hidden, false);
  part.out.scrim.click(); assert.deepEqual(closes, ['close'], 'the scrim closes Settings');
  release(); release(); assert.equal(doc.documentElement.hasAttribute('data-settings-over'), false, 'released once, back as it was');
  const pick = readFileSync(new URL('../web/desktop/desktop-pickany.js', import.meta.url), 'utf8');
  for (const [pageBack, want] of [[false, ['settings', ['close']]], [true, ['settings-page', []]]]) {
    const watched = {}, closed = [];
    runRecording(pick.split('\n').find(l => l.includes("watchEscape('settings',")), { watchEscape: (name, active, back) => { watched[name] = { active, back }; }, settingsFocused: () => true, settingsView: { back: () => pageBack }, closeSettings: () => closed.push('close') });
    assert.equal(watched.settings.active(), true);
    assert.deepEqual([watched.settings.back(), closed], want, `Esc with a page to go back to: ${pageBack}`);
  }
});
