// A layout's automatic Home -> Chats preparation must not dismiss the Look picker.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../web/desktop/desktop.js', import.meta.url), 'utf8');
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
test('AI apps sets the everywhere-modal contract before preparing its Home chat', () => {
  const ai=readFileSync(new URL('../web/layouts/ai-apps/desktop.js', import.meta.url),'utf8');
  const at=ai.indexOf('const releaseSettings = host?.settings.overlay();');
  assert.match(source, /settingsOverlay: \(\) => \{/);
  assert.ok(at>=0 && at<ai.lastIndexOf('if (api.route().home) soon(() => { if (api.route().home) api.sessions.newChat(); });'));
  assert.match(source,/scrim.addEventListener\('click', \(\) => closeSettings\(\)\)/);
  assert.match(source,/watchEscape\('settings', \(\) => settingsFocused\(\), \(\) => \{ if \(settingsView.back\(\)\) return 'settings-page'; closeSettings\(\); return 'settings'; \}/);
});
