// James, 31 Oct 2026: keep the classic Home and Settings for everyone; Miguel's network Home (#668) is his tweak, a
// separate switch any skin can turn on (Miguel's #755 stays). Each test is named for what James asked, so a later change that brings the old default back fails here.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { existsSync } from 'node:fs';
import { read } from './fixtures/tweaks.mjs';
import { withSettingsParts } from './fixtures/settings-parts.mjs'; // settings.js parts moved out verbatim (issue 1665)
import { machinesHome } from './fixtures/machines-home-harness.mjs';
import { settingsWorld } from './fixtures/r5A-settings.mjs';
import { partScope, runPart } from './fixtures/r5A-parts.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { styleOf } from './fixtures/mini-css.mjs';
import { runRecording, between } from './fixtures/source-slice.mjs';

const catalog = JSON.parse(read('web/tweaks/catalog.json'));

// The real experience.js on a fake skin list: which tweaks load for a worn skin.
function experience(skin, saved) {
  const fams = [{ id: 'wizard', tweaks: 'wizard', palettes: ['nebula', 'grove', 'tide', 'ember', 'signal'] },
    { id: 'mizel', tweaks: 'miguel', palettes: ['obsidian', 'obsidian-light', 'landscapes', 'landscapes-light'] }];
  let active = [];
  const window = { WosSkin: { current: skin, families: fams, familyOf: id => fams.find(f => f.palettes.includes(id))?.id },
    WosSkinHost: { personalState: { ready: false }, get tweakState() { return active; }, layout: 'classic', setLayout() {}, loadTweaks: async ids => { active = ids; } },
    addEventListener() {}, dispatchEvent() {} };
  const storage = new Map(saved ? [['wos.skin-tweaks.v1', JSON.stringify(saved)]] : []);
  vm.runInNewContext(read('web/core/experience.js'), { window, document: { baseURI: 'https://wizard.test/wizard-os-home/', addEventListener() {} }, Event, URL, AbortSignal,
    localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    fetch: async url => ({ ok: true, json: async () => JSON.parse(read('web/' + url.pathname.split('/wizard-os-home/')[1])) }) });
  return { E: window.WosExperience, active: () => Array.from(active), saved: () => JSON.parse(storage.get('wos.skin-tweaks.v1') || 'null') };
}

test('James: the default Wizard skins keep the classic Home: no network map, no AI fuel widget', async () => {
  assert.ok(!existsSync(new URL('../web/tweaks/wizard/machines-home', import.meta.url)), 'no stock copy of the network Home');
  assert.ok(!catalog.defaults.some(id => id.endsWith('/machines-home')), 'never on by default for every skin');
  assert.ok(!catalog.tweaks.includes('wizard/machines-home'));
  assert.ok(!JSON.parse(read('web/tweaks/wizard/profile.json')).tweaks.some(id => id.endsWith('/machines-home')));
  for (const skin of ['nebula', 'grove', 'tide', 'ember', 'signal']) {
    const f = experience(skin); await f.E.refresh();
    assert.ok(!f.active().some(id => id.endsWith('/machines-home')), skin + ' loads no network Home');
  }
  // Nothing in core paints the widget, the fuel meter or the network tiles on its own.
  for (const file of ['web/app.js', 'web/desktop/desktop.js', 'web/core/skin-host.js', 'web/core/resources.js', 'web/index.html', 'web/desktop.html'])
    assert.doesNotMatch(read(file), /machines-home|mh-glance|AI fuel/i, file);
});

test('James: Miguel\'s network Home is his tweak, a separate switch any skin can turn on (#755 kept)', async () => {
  assert.ok(catalog.tweaks.includes('miguel/machines-home'));
  const miguel = JSON.parse(read('web/tweaks/miguel/profile.json')); // data: Miguel's quick-button preset
  assert.ok(miguel.tweaks.includes('miguel/machines-home'), 'in Miguel\'s quick button');
  // A device wearing Miguel's tweaks gets it with any skin, James's colors included.
  for (const skin of ['obsidian', 'landscapes-light', 'nebula']) {
    const f = experience(skin, { version: 1, off: {}, preset: 'miguel' }); await f.E.refresh();
    assert.ok(f.active().includes('miguel/machines-home'), skin + ' with Miguel\'s tweaks loads his Home');
  }
  // A default device does not get it, on any skin, but can switch it on by itself.
  for (const skin of ['nebula', 'obsidian']) {
    const f = experience(skin); await f.E.refresh();
    assert.ok(!f.active().includes('miguel/machines-home'), skin + ' by default: classic Home');
    await f.E.toggle('miguel/machines-home');
    assert.ok(f.active().includes('miguel/machines-home'), skin + ': the switch turns it on');
  }
});

test('James: a device that ran the network Home keeps it only if it already wears Miguel\'s tweaks', async () => {
  const miguel = experience('landscapes', { version: 1, off: {}, preset: 'none', mix: { 'miguel/snooze-someday': true }, defaultsMigrated: true }); await miguel.E.refresh();
  assert.ok(miguel.active().includes('miguel/machines-home'), 'Miguel keeps his Home after the move');
  const james = experience('nebula', { version: 1, off: {}, preset: 'none', mix: {}, defaultsMigrated: true }); await james.E.refresh();
  assert.ok(!james.active().includes('miguel/machines-home'), 'James gets the classic Home back');
  const optedOut = experience('landscapes', { version: 1, off: {}, preset: 'none', mix: { 'miguel/snooze-someday': true }, defaultsMigrated: true, defaultsOff: ['wizard/machines-home'] }); await optedOut.E.refresh();
  assert.ok(!optedOut.active().includes('miguel/machines-home'), 'a device that had switched it off stays off');
  // Once only: switching it off afterwards sticks.
  await miguel.E.toggle('miguel/machines-home'); await miguel.E.refresh();
  assert.ok(!miguel.active().includes('miguel/machines-home'));
});

test('James: Miguel\'s Home keeps its phone widget, desktop glance and System pages', () => {
  // The real tweak on the stock Home skeleton: it mounts into the home-main slot and fills the four System pages.
  const m = machinesHome({ desk: true });
  assert.ok(m.root(), 'his Home is drawn');
  assert.equal(m.root().closest('[data-slot="home-main"]'), m.slots['home-main'], 'his Home replaces the stock one only where it is loaded');
  for (const page of ['overview', 'ai', 'network', 'storage']) assert.ok(m.page(page), page + ' stays in his tweak');
  m.dispose?.();
});

test('James: stock switcher stays hidden at one, icon-only at two; network Home remains a tweak', async () => {
  // Hidden at one, icon only at two: tests/workspaces.test.mjs 'one Wizard: hidden stock control; two: icon only'
  // runs the real core/workspaces.js. Manage workspaces opens Settings › Connections: the ⌥O test there.
  assert.doesNotMatch(read('web/core/workspaces.js'), /page: '(overview|ai|network|storage)'/);
  // Miguel's Home has no switcher menu of its own: its add button asks the shared switcher.
  const tweak = read('web/tweaks/miguel/machines-home/tweak.js');
  assert.doesNotMatch(tweak, /wizMenu|renderWiz/);
  const m = machinesHome({ desk: true, managed: [{ id: 'g1', kind: 'managed', name: 'Carlos', people: ['Bea'], peopleCount: 3, url: '' }] });
  m.draw(); const add = m.page('overview').querySelector('[data-act="add-managed"]');
  assert.ok(add, 'his Home offers Add a Wizard');
  m.tap(add); await m.flush();
  assert.equal(m.calls.adds, 1, 'through api.workspaces.add()');
});

// The real Settings with every page that can show, shown: which page list a default box gets.
const fullSettings = (shell, more = {}) => settingsWorld({ shell, scope: { navigator: { userAgent: 'Android' }, WosBell: { routes: () => [] }, WosSchedules: { available: true },
  WizPhoneConnect: { create: () => ({ status: 'ok', refresh() {} }) }, ...more } });

test('James: default Settings keeps the current AI page and has no "Your network" or "Network & security" page', () => {
  const core = ['web/core/settings.js', 'web/core/usage.js', 'web/core/resources.js', 'web/core/os-updates.js', 'web/core/schedules.js', 'web/core/workspace-sync.js', 'web/desktop/desktop.js', 'web/app.js'];
  for (const file of core) assert.doesNotMatch(read(file), /page: '(overview|ai|network|storage)'/, file + ' fills no System page');
  for (const shell of ['phone', 'desktop']) {
    const w = fullSettings(shell);
    w.W.register({ id: 'r5a-conn', page: 'connections', html: () => '<p>c</p>' }); w.W.refresh();
    // Order unchanged from the classic list: Appearance first, then Chats, Notifications, Voice, Phones…
    assert.deepEqual(w.pages(), ['appearance', 'chats', 'notifications', 'voice', 'phones', 'phone', 'connections', 'recovery', 'usage', 'schedules', 'about'], shell);
    assert.deepEqual(w.groups(), [], 'one group: no group labels');
    assert.equal(w.W.hasSystem(), false);
    assert.equal(w.text(w.root.querySelector('[data-st-page="usage"] b')), 'AI usage', 'the current AI usage page stays');
    if (shell === 'desktop') assert.equal(w.root.querySelector('[aria-current="page"]').dataset.stPage, 'appearance', 'desktop opens on Appearance as before');
  }
  // The Resources title when the shared bars are there.
  const res = fullSettings('phone', { WosResources: { bars: () => '' } });
  assert.equal(res.text(res.root.querySelector('[data-st-page="usage"] b')), 'Resources');
  // A package that fills a System page brings that page (first, under System) and the group labels.
  const w = fullSettings('desktop');
  for (const id of ['overview', 'ai', 'network', 'storage']) w.W.register({ id: 'r5a-' + id, page: id, html: () => '<p>x</p>' });
  w.W.refresh();
  assert.deepEqual(w.pages().slice(0, 4), ['overview', 'ai', 'network', 'storage']);
  assert.deepEqual(w.groups(), ['System', 'Preferences']);
  assert.equal(w.root.querySelector('[aria-current="page"]').dataset.stPage, 'overview');
});

test('James: desktop Home opens Settings as the centred panel over Home, never a window beside Chats', () => {
  // The real desktop-settings.js part: openSettings from Home, from a desk, and with a Settings window on a desk.
  const run = ({ homeOpen, win = null, over = false }) => {
    const calls = [];
    const ctx = partScope();
    if (over) ctx.document.documentElement.setAttribute('data-settings-over', '');
    ctx.WizCore.desktopParts = { cog: () => ({ nativeDesktop: () => false, toggleKeys: () => {}, bindLate: () => {} }) };
    const setEl = ctx.document.createElement('div'); setEl.hidden = true;
    const vars = { homeOpen, settingsModal: false };
    const { out } = runPart('desktop/desktop-settings.js', 'desktopParts', 'settings', {
      $: () => ctx.document.createElement('div'), C: {}, closePalette: () => {}, closeWin: id => calls.push(['closeWin', id]), desktopVars: vars, focusWin: id => calls.push(['focusWin', id]),
      hostSettings: () => calls.push(['hostSettings']), newWin: o => calls.push(['newWin', o.app]), OUTBOX: {}, renderSettings: () => {}, scrim: {}, setEl,
      settingsFocused: () => false, settingsView: { focus: () => {} }, settingsWin: () => win, showSettingsModal: () => calls.push(['modal']) }, ctx);
    out.openSettings();
    assert.equal(setEl.hidden, false);
    return calls;
  };
  assert.deepEqual(run({ homeOpen: true }), [['modal']], 'from Home: the panel');
  assert.deepEqual(run({ homeOpen: true, win: { id: 'w1' } }), [['modal']], 'from Home even with a Settings window on a desk');
  assert.deepEqual(run({ homeOpen: false, over: true }), [['modal']], 'a layout without Home keeps the panel');
  assert.deepEqual(run({ homeOpen: false }), [['newWin', 'settings']], 'on a desk: a window');
  assert.deepEqual(run({ homeOpen: false, win: { id: 'w1' } }), [['focusWin', 'w1']]);
  // hasSystem: only a filled System page counts.
  const w = settingsWorld({ shell: 'desktop' }); assert.equal(w.W.hasSystem(), false);
  w.W.register({ id: 'r5a-net', page: 'network', html: () => '' }); assert.equal(w.W.hasSystem(), true);
});

test('James: the default desktop bar has no AI fuel, security, backup or machines icons, and fewer icons on the right', () => {
  const doc = createDocument(); const html = read('web/desktop.html');
  doc.body.innerHTML = html.slice(html.indexOf('<body'), html.lastIndexOf('</body>')).replace(/^<body[^>]*>/, '');
  const bar = doc.querySelector('.bar-r[data-slot="dock-end"]');
  assert.deepEqual(bar.querySelectorAll('button[id]').map(b => b.id), ['searchBtn', 'micBtn', 'commandBtn', 'dictateBtn', 'status', 'settingsBtn', 'keysBtn'], 'no new buttons in the bar');
  assert.doesNotMatch(bar.innerHTML, /fuel|backup|security|machines/i);
  assert.equal(doc.querySelector('.bar-start[data-slot="bar-start"]').childNodes.length, 0, 'the workspace slot is empty unless a package fills it');
  // One mic by default: the real generalvoice part folds the three other voice buttons out of the bar.
  const mount = saved => {
    const ctx = partScope(); const d = ctx.document; d.body.innerHTML = '<div class="bar-r"><button id="micBtn"></button><button id="commandBtn"></button><button id="dictateBtn"></button></div>';
    const mic = d.querySelector('#micBtn'); mic.insertAdjacentElement = (_w, el) => mic.parentNode.insertBefore(el, mic.nextSibling);
    const store = new Map(saved == null ? [] : [['allMics', saved]]);
    const { out } = runPart('desktop/desktop-generalvoice.js', 'desktopParts', 'generalvoice', { mic, MOD: '⌥', store: { get: (k, def) => (store.has(k) ? store.get(k) : def) }, talkNew: () => {} }, ctx);
    return { d, out };
  };
  const css = read('web/desktop/desktop.css');
  const one = mount(null);
  assert.equal(one.d.documentElement.classList.contains('one-mic'), true, 'folded unless the owner asks');
  for (const id of ['generalVoice', 'commandBtn', 'dictateBtn']) assert.equal(styleOf(one.d.querySelector('#' + id), css, 'display'), 'none', id + ' folded');
  assert.notEqual(styleOf(one.d.querySelector('#micBtn'), css, 'display'), 'none', 'the mic stays');
  assert.deepEqual(one.out.voiceMenu.querySelectorAll('button').map(b => [b.dataset.voiceGo, b.querySelector('span').textContent, b.querySelector('kbd').textContent]),
    [['micBtn', 'Talk about this', '⌥S'], ['generalVoice', 'New voice chat', '⌥V'], ['dictateBtn', 'Dictate here', '⌥D'], ['commandBtn', 'Tell the computer', '⌥C']]);
  const all = mount(true);
  assert.equal(all.d.documentElement.classList.contains('one-mic'), false, 'Settings puts them back');
  assert.notEqual(styleOf(all.d.querySelector('#generalVoice'), css, 'display'), 'none');
  // The Settings switch, desktop only (the desktop adapter hands barMics).
  let on = false; const w = settingsWorld({ shell: 'desktop', adapter: { barMics: () => ({ get: () => on, set: v => { on = v; } }) } });
  w.open('voice');
  const row = w.root.querySelector('[data-bar-mics-set]');
  assert.equal(w.text(row.querySelector('b')), 'Show every voice button'); assert.equal(row.getAttribute('aria-checked'), 'false');
  row.click(); assert.equal(on, true);
  assert.equal(w.root.querySelector('[data-bar-mics-set]').getAttribute('aria-checked'), 'true');
  const phone = settingsWorld({ shell: 'phone' }); phone.open('voice');
  assert.equal(phone.root.querySelector('[data-bar-mics]'), null, 'no switch without the desktop bar');
});

test('#755 stays: tweaks are their own switches, labelled by author, in every skin; Welcome never switches skin', async () => {
  const s = withSettingsParts(read('web/core/settings.js'));
  // Miguel, 1 Nov 2026: one flat list, no per-author "All of …" quick buttons.
  assert.doesNotMatch(s, /data-tweakauthor=|All of \$\{/, 'no per-author quick button');
  // Each tweak says who made it (a view also says which device type it is for): the real row renderer.
  const line = between(s, '  const tweakSwitches = ', "join('');") + "join('');";
  const f = runRecording(line + '\nthis.tweakSwitches = tweakSwitches;', { esc: x => String(x) });
  const by = a => ({ miguel: 'Miguel' })[a] || a;
  const doc = createDocument();
  doc.body.innerHTML = f.tweakSwitches([{ id: 'miguel/a', name: 'A', author: 'miguel', on: true }, { id: 'miguel/b', name: 'B', author: 'miguel', where: 'Desktop only', on: false }], 'data-tweak-toggle', false, by);
  assert.deepEqual(doc.querySelectorAll('.tw-row').map(r => [r.getAttribute('data-tweak-toggle'), r.getAttribute('aria-checked'), r.querySelector('.tw-by').textContent]),
    [['miguel/a', 'true', 'by Miguel'], ['miguel/b', 'false', 'Desktop only · by Miguel']]);
  // A color pick never changes tweaks: the real experience.js keeps the tweaks when the skin changes.
  const e = experience('obsidian', { version: 1, off: {}, preset: 'miguel' }); await e.E.refresh();
  const before = e.active();
  await e.E.chooseSkin('nebula'); await e.E.refresh();
  assert.deepEqual(e.active(), before);
  assert.ok(existsSync(new URL('../web/core/welcome.js', import.meta.url)));
});
