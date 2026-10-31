// James, 31 Oct 2026: keep the classic Home and Settings for everyone; Miguel's network Home (#668) is his tweak, a
// separate switch any skin can turn on (Miguel's #755 stays). Each test is named for what James asked, so a later change that brings the old default back fails here.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { existsSync } from 'node:fs';
import { read } from './fixtures/tweaks.mjs';

const catalog = JSON.parse(read('web/tweaks/catalog.json'));
const between = (s, a, b) => { const i = s.indexOf(a); assert.ok(i >= 0, a); return s.slice(i, s.indexOf(b, i + a.length)); };

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
  assert.ok(JSON.parse(read('web/tweaks/miguel/profile.json')).tweaks.includes('miguel/machines-home'), 'in Miguel\'s quick button');
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
  const miguel = experience('landscapes', { version: 1, off: {}, preset: 'none', mix: { 'miguel/home-bars': true }, defaultsMigrated: true }); await miguel.E.refresh();
  assert.ok(miguel.active().includes('miguel/machines-home'), 'Miguel keeps his Home after the move');
  const james = experience('nebula', { version: 1, off: {}, preset: 'none', mix: {}, defaultsMigrated: true }); await james.E.refresh();
  assert.ok(!james.active().includes('miguel/machines-home'), 'James gets the classic Home back');
  const optedOut = experience('landscapes', { version: 1, off: {}, preset: 'none', mix: { 'miguel/home-bars': true }, defaultsMigrated: true, defaultsOff: ['wizard/machines-home'] }); await optedOut.E.refresh();
  assert.ok(!optedOut.active().includes('miguel/machines-home'), 'a device that had switched it off stays off');
  // Once only: switching it off afterwards sticks.
  await miguel.E.toggle('miguel/machines-home'); await miguel.E.refresh();
  assert.ok(!miguel.active().includes('miguel/machines-home'));
});

test('James: Miguel\'s Home keeps its phone widget, desktop glance and System pages', () => {
  const src = read('web/tweaks/miguel/machines-home/tweak.js');
  assert.match(src, /api\.slot\.mount\('home-main', root\)/, 'his Home replaces the stock one only where it is loaded');
  for (const page of ['overview', 'ai', 'network', 'storage']) assert.match(src, new RegExp(`api\\.settings\\?\\.section\\('[a-z]+', '${page}',`), page + ' stays in his tweak');
});

test('James: the workspace control is hidden with one workspace and is a small icon (no "This Wizard" text) with two', () => {
  const src = read('web/tweaks/miguel/machines-home/tweak.js');
  const wiz = between(src, '  function renderWiz() {', '\n  }\n');
  assert.match(wiz, /const multi = managedList\(\)\.length > 0;/);
  assert.match(wiz, /wizBox\.hidden = !multi;/, 'one workspace: no control at all');
  assert.match(wiz, /if \(!multi\) \{ S\.open\.delete\('wsm'\); S\.open\.delete\('wsm-why'\); \}/, 'a menu left open closes with it');
  const button = wiz.slice(wiz.indexOf('wizBtn.replaceChildren('), wiz.indexOf('wizMenu.hidden'));
  assert.match(button, /mh-wiz-ic/, 'an icon');
  assert.doesNotMatch(button, /text: own|thisName\(\)|This Wizard/, 'never the workspace name in the bar');
  assert.match(wiz, /wizBtn\.title = `Workspace: \$\{own\}`/, 'the name is in the tooltip and label');
  assert.match(wiz, /'aria-label', `Workspace: \$\{own\}\. Switch workspace`/);
  assert.match(read('web/tweaks/miguel/machines-home/tweak.css'), /\.mh-root\.is-topbar\.is-wiz\[hidden\] \{ display: none !important; \}/);
  // The underlying switcher stays (company Wizard later): the menu and Settings › Your network's + still add one.
  assert.match(src, /'\+ Add a workspace'/);
  assert.match(src, /cls: 'mh-ws-add', 'aria-label': 'Add a Wizard you manage', data: \{ act: 'add-managed' \}/);
});

test('James: default Settings keeps the current AI page and has no "Your network" or "Network & security" page', () => {
  const s = read('web/core/settings.js');
  // The four System pages show only when a package fills them; nothing in core does.
  for (const id of ['overview', 'ai', 'network', 'storage']) assert.match(s, new RegExp(`\\{ id: '${id}', title: '[^']+', group: 'System', available: filled\\('${id}'\\) \\}`), id);
  const core = ['web/core/settings.js', 'web/core/usage.js', 'web/core/resources.js', 'web/core/os-updates.js', 'web/core/schedules.js', 'web/core/workspace-sync.js', 'web/desktop/desktop.js', 'web/app.js'];
  for (const file of core) assert.doesNotMatch(read(file), /page: '(overview|ai|network|storage)'/, file + ' fills no System page');
  assert.match(s, /\{ id: 'usage', get title\(\) \{ return window\.WosResources\?\.bars \? 'Resources' : 'AI usage'; \} \}/, 'the current AI usage / Resources page stays');
  assert.match(s, /const effectivePage = \(\) => page \|\| \(desktop \? \(filled\('overview'\)\(\) \? 'overview' : 'appearance'\) : ''\);/, 'desktop opens on Appearance as before');
  // Order unchanged from the classic list: Appearance first, then Chats, Voice, Phones…
  const order = [...between(s, 'const PAGES = [', '];').matchAll(/\{ id: '([a-z]+)'/g)].map(m => m[1]).filter(id => !['overview', 'ai', 'network', 'storage'].includes(id));
  assert.deepEqual(order, ['appearance', 'chats', 'voice', 'phones', 'phone', 'connections', 'recovery', 'usage', 'schedules', 'about']);
  // Group labels (System / Preferences) appear only when there is more than one group.
  assert.match(s, /pages\.some\(q => q\.group && q\.group !== p\.group\)/);
});

test('James: classic Home opens desktop Settings as a window; only Miguel\'s Home uses the centred panel', () => {
  const desk = read('web/desktop/desktop.js');
  assert.match(desk, /if \(homeOpen && \(settingsModal \|\| window\.WosSettings\.hasSystem\?\.\(\)\)\) \{/);
  assert.match(read('web/core/settings.js'), /hasSystem: \(\) => PAGES\.some\(p => p\.group === 'System' && p\.available\(\)\)/);
});

test('James: the default desktop bar has no AI fuel, security, backup or machines icons, and fewer icons on the right', () => {
  const html = read('web/desktop.html'), bar = between(html, '<div class="bar-r" data-slot="dock-end">', '</header>');
  const ids = [...bar.matchAll(/<button id="([A-Za-z]+)"/g)].map(m => m[1]);
  assert.deepEqual(ids, ['searchBtn', 'micBtn', 'commandBtn', 'dictateBtn', 'status', 'settingsBtn', 'keysBtn'], 'no new buttons in the bar');
  assert.doesNotMatch(bar, /fuel|backup|security|machines/i);
  assert.match(html, /<div class="bar-start" data-slot="bar-start"><\/div>/, 'the workspace slot is empty unless a package fills it');
  // One mic by default: New voice chat, Tell the computer and Dictate fold into the mic's menu (right-click or hold),
  // keep their keys, and Settings › Voice & typing puts them back.
  const desk = read('web/desktop/desktop.js'), css = read('web/desktop/desktop.css'), s = read('web/core/settings.js');
  assert.match(css, /\.one-mic #generalVoice, \.one-mic #commandBtn, \.one-mic #dictateBtn \{ display: none !important; \}/);
  assert.match(desk, /const allMics = \(\) => store\.get\('allMics', false\) === true;/, 'folded unless the owner asks');
  assert.match(desk, /document\.documentElement\.classList\.toggle\('one-mic', !allMics\(\)\)/);
  assert.match(desk, /\[\['micBtn', 'Talk about this', `\$\{MOD\}S`\], \['generalVoice', 'New voice chat', `\$\{MOD\}V`\], \['dictateBtn', 'Dictate here', `\$\{MOD\}D`\], \['commandBtn', 'Tell the computer', `\$\{MOD\}C`\]\]/);
  assert.match(desk, /shell: 'desktop', barMics: \(\) => barMics,/);
  assert.match(s, /register\(\{ id: 'bar-voice-buttons', page: 'voice', available: ctx => !!ctx\?\.barMics\?\.\(\),/, 'the Settings switch, desktop only');
  assert.match(s, /<b>Show every voice button<\/b>/);
});

test('#755 stays: tweaks are their own switches, by author, in every skin; Welcome never switches skin', () => {
  const s = read('web/core/settings.js');
  assert.match(s, /data-tweakauthor=/, 'one quick button per author');
  assert.match(read('web/core/experience.js'), /A color pick never changes tweaks/);
  assert.ok(existsSync(new URL('../web/core/welcome.js', import.meta.url)));
});
