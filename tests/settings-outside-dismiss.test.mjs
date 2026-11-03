// Outside dismisses Settings; ordinary Back/Escape peels its nested page. Execute real dispatch, not a model.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const root = process.env.QA_SETTINGS_SOURCE || new URL('../', import.meta.url).pathname;
const source = fs.readFileSync(new URL('web/app.js', new URL(`file://${root.replace(/\/$/, '')}/`)), 'utf8');
function dispatch(overlay = '') {
  const state = { page: 'about', closed: 0, paused: 0, cancelled: 0 };
  const window = {};
  for (const name of ['WosOrbSwitcher', 'WosWelcome', 'WizShareWizard', 'WizHomeScreenApps', 'WosTour', 'WosShareSheet', 'WosSelMenu', 'WosAppRoute', 'WosAppSetup', 'WosBoomerang', 'WosDevice', 'WosSkinHost', 'WosResources']) {
    window[name] = { back: () => name === overlay ? (name === 'WosShareSheet' ? 'share-sheet' : true) : false };
  }
  window.WosSettings = { cancelWait: () => state.cancelled++ };
  const s = { window, document: { querySelector: () => null }, V: { state: overlay === 'recording' ? 'listen' : 'idle', snap: { general: overlay === 'recording' } },
    pauseCommandCapture: () => state.paused++, CHATS: { KIT: { viewer: { isOpen: () => overlay === 'viewer', close: () => true } }, closeOverlay: () => false },
    LINKS: null, closeOverview: () => false, closeReviewCoach: () => false, menuFor: null,
    sheet: 'settings', settingsReturn: '', settingsView: { back: () => { if (!state.page) return false; state.page = ''; return true; } },
    closeSheets: () => { s.sheet = null; state.closed++; }, toast: () => {} };
  vm.createContext(s);
  for (const name of ['backStep', 'onBack']) {
    const fn = source.match(new RegExp(`  function ${name}\\([^]*?\\n  }`));
    assert.ok(fn, `real ${name} exists`); vm.runInContext(fn[0], s);
  }
  const scrim = source.match(/\$\('#scrim'\)\.addEventListener\('click', ([^\n]+)\);/);
  assert.ok(scrim, 'real scrim binding exists');
  s.outside = vm.runInContext(`(${scrim[1]})`, s);
  return { s, state };
}
test('ordinary nested Back returns to Settings categories without closing', () => {
  const { s, state } = dispatch(); assert.equal(s.backStep(), 'settings-page');
  assert.equal(state.page, ''); assert.equal(s.sheet, 'settings'); assert.equal(state.closed, 0);
});
test('ordinary onBack used by Escape retains nested Settings navigation', () => {
  assert.match(source, /e\.key === 'Escape'[^]*?onBack\(/);
  const { s, state } = dispatch(); s.onBack();
  assert.equal(state.page, ''); assert.equal(s.sheet, 'settings'); assert.equal(s.window.__backLog.at(-1), 'settings-page');
});
test('one actual scrim callback closes Settings from About, not just its nested page', () => {
  const { s, state } = dispatch(); assert.equal(s.outside(), 'sheet');
  assert.equal(s.sheet, null); assert.equal(state.closed, 1); assert.equal(state.page, 'about');
});
test('higher overlays consume outside input before Settings', () => {
  for (const [overlay, result] of [['WosWelcome', true], ['WizShareWizard', 'share-wizard'], ['WosShareSheet', 'share-sheet'], ['viewer', 'viewer'], ['WosDevice', true]]) {
    const { s, state } = dispatch(overlay); assert.equal(s.outside(), result, overlay);
    assert.equal(s.sheet, 'settings', overlay); assert.equal(state.page, 'about', overlay); assert.equal(state.closed, 0, overlay);
  }
});
test('outside input preserves the recording retain/pause guard', () => {
  const { s, state } = dispatch('recording'); assert.equal(s.outside(), 'recording');
  assert.equal(state.paused, 1); assert.equal(s.V.stopAsked, true); assert.equal(state.closed, 0); assert.equal(s.sheet, 'settings');
});
