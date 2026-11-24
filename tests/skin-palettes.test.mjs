import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createDocument } from './fixtures/mini-dom.mjs';
import { cascade } from './fixtures/mini-css.mjs';
import { read, skinsRuntime, settingsView, experienceRuntime } from './fixtures/skin-palettes-harness.mjs';

// wizard-os spec/SKINS_AND_VIEWS.md §1: palettes live inside skins. Each test runs the real skins.js, Settings,
// appearance-host.js or experience.js (wizard-ux issue 1674).
const tick = async (n = 10) => { for (let i = 0; i < n; i++) await Promise.resolve(); };

// owner-correction: humanitylabs-org/wizard-ux#990 · 2026-11-05 · "Keep people's skins named the way they named their skins."
test('the two skins hold the right palettes, and an unlisted skin becomes its own skin', () => {
  const s = read('web/core/skins.js');
  assert.match(s, /\{ id: 'wizard', name: 'Wizard', [^\n]*palettes: \['nebula', 'grove', 'tide', 'ember', 'signal'\] \}/);
  assert.match(s, /\{ id: 'mizel', name: 'Mizel', [^\n]*palettes: \['obsidian', 'obsidian-light', 'landscapes', 'landscapes-light'\] \}/);
  assert.match(s, /\{ id: 'novairecito', name: 'Novairecito', [^\n]*palettes: \['novairecito', 'sepia'\] \}/, 'Novaire’s looks are colours of one skin');
  assert.match(s, /if \(!f\) f = \{ id: s\.id, name: s\.name, who: s\.who, palettes: \[s\.id\] \};/);
  assert.match(s, /families: FAMS,/);
  // The running table: each skin keeps the name its owner gave it, with its palettes.
  const { S } = skinsRuntime();
  const fams = Object.fromEntries(S.families.map(f => [f.id, { name: f.name, palettes: [...f.palettes] }]));
  assert.deepEqual(fams.wizard, { name: 'Wizard', palettes: ['nebula', 'grove', 'tide', 'ember', 'signal'] });
  assert.deepEqual(fams.mizel, { name: 'Mizel', palettes: ['obsidian', 'obsidian-light', 'landscapes', 'landscapes-light'] });
  assert.deepEqual(fams.novairecito, { name: 'Novairecito', palettes: ['novairecito', 'sepia'] });
  assert.equal(S.familyOf('sepia'), 'novairecito');
  assert.equal(S.familyOf('nebula'), 'wizard');
  assert.equal(S.familyOf('obsidian-light'), 'mizel');
  assert.equal(S.familyOf('landscapes-light'), 'mizel');
  assert.ok(S.families.every(f => f.palettes.length >= 1 && f.palettes.every(id => S.familyOf(id) === f.id)), 'every palette belongs to exactly its skin');
  // A collaborator skin listed in no family is a skin of its own, under the name its author gave it.
  const own = "{ id: 'zz-quiet', name: 'Quiet Harbour', who: 'A collaborator skin.', orb: [0, 1, 1], t: T({ bg: '#101010', ink: '#ffffff', violet: '#8f63ff' }) },\n";
  const added = skinsRuntime({}, s.replace('const SKINS = [\n', 'const SKINS = [\n    ' + own)).S;
  const f = added.families.find(x => x.id === 'zz-quiet');
  assert.ok(f, 'its own family');
  assert.deepEqual({ name: f.name, palettes: [...f.palettes] }, { name: 'Quiet Harbour', palettes: ['zz-quiet'] });
  assert.equal(added.familyOf('zz-quiet'), 'zz-quiet');
  assert.equal(f.who, 'A collaborator skin.', 'with its author\'s description');
});

test('the saved choice stays the palette id; the last palette per skin is remembered', () => {
  const { S, store } = skinsRuntime();
  S.set('obsidian-light');
  assert.equal(store.get('wos.skin'), 'obsidian-light', 'the saved choice is the palette id');
  assert.equal(store.get('wos.skin.last.mizel'), 'obsidian-light');
  S.set('tide');
  assert.equal(S.setFamily('mizel'), 'obsidian-light', 'picking a skin puts on its last palette');
  assert.equal(S.current, 'obsidian-light');
  assert.equal(S.lastIn('wizard'), 'tide');
  // A stale or foreign saved palette falls back to the skin's first.
  const stale = skinsRuntime({ 'wos.skin.last.wizard': 'obsidian', 'wos.skin.last.mizel': 'gone' }).S;
  assert.equal(stale.lastIn('wizard'), 'nebula');
  assert.equal(stale.lastIn('mizel'), 'obsidian');
});

// A WosSkin with two families, and a My skin library with one own skin.
function lookPage(shell = 'phone', experience) {
  const last = { wizard: 'grove', mizel: 'obsidian-light' }, picked = [];
  const WosSkin = { current: 'nebula', list: ['nebula', 'grove', 'obsidian', 'obsidian-light'].map(id => ({ id, name: id, t: {} })),
    families: [{ id: 'wizard', name: 'Wizard', palettes: ['nebula', 'grove'] }, { id: 'mizel', name: 'Mizel', palettes: ['obsidian', 'obsidian-light'] }],
    familyOf: id => id.startsWith('obsidian') ? 'mizel' : 'wizard', lastIn: id => last[id],
    set(id) { picked.push(id); this.current = id; last[this.familyOf(id)] = id; }, setFamily(id) { picked.push('family ' + id); this.set(last[id]); } };
  const WosMySkin = { recipes: [{ id: 'own-1', name: 'Quiet morning', base: 'grove' }], active: null, on() {} };
  return { ...settingsView({ shell, WosSkin, WosMySkin, WosExperience: experience }), picked, WosSkin };
}

test('Settings › Look separates family tiles from family-scoped Colours, without a Chats pairing', async () => {
  const h = lookPage();
  const html = h.html();
  const skins = html.match(/<div class="skp skp-families" role="group" aria-label="Skins">([\s\S]*?)<\/div>/)?.[1] || '';
  assert.match(skins, /data-skinfamily="wizard"/); assert.match(skins, /data-skinfamily="mizel"/);
  assert.match(skins, /data-ownskin="own-1"[^>]*>[\s\S]*Quiet morning/, 'own skins stay in the family row');
  assert.doesNotMatch(skins, /data-skinpick=/, 'colours are not skins');
  assert.match(html, /<h4>Colors<\/h4>/);
  assert.match(html, /data-skinpick="nebula"/); assert.match(html, /data-skinpick="grove"/);
  assert.doesNotMatch(html, /data-skinpick="obsidian/, 'only the chosen family supplies colours');
  assert.doesNotMatch(html, /data-chats-suggest|suggestion/, 'no Chats pairing');
  h.act('look', 'data-skinfamily', 'mizel'); await tick();
  assert.deepEqual(h.picked, ['family mizel', 'obsidian-light']);
  assert.match(h.html(), /data-skinpick="obsidian"/);
  assert.doesNotMatch(h.html(), /data-skinpick="grove"/);
  h.view.destroy();
});

// appearance-host.js with one registered app frame that says it is ready.
function appearance(skin, familyOf) {
  const events = new Map(), messages = [];
  const f = { src: 'https://box.test/apps/habits/', isConnected: true, contentDocument: {}, closest: s => s === '.win' ? { classList: { add() {}, remove() {} } } : null,
    classList: { add() {}, remove() {} }, contentWindow: { location: { origin: 'https://box.test', pathname: '/apps/habits/' }, postMessage: m => messages.push(m) } };
  const document = { documentElement: { dataset: { skin } }, readyState: 'loading', querySelectorAll: () => [f], addEventListener: (n, fn) => events.set('doc:' + n, fn) };
  const window = { WizCore: { apps: () => ({ APPS: [{ url: f.src, source: 'apps.json' }] }) }, ...(familyOf ? { WosSkin: { familyOf } } : {}) };
  vm.runInNewContext(read('web/core/appearance-host.js'), { window, WizCore: window.WizCore, document, URL, location: { origin: 'https://box.test' },
    getComputedStyle: () => ({ colorScheme: 'dark', getPropertyValue: () => '' }), addEventListener: (n, fn) => events.set(n, fn), queueMicrotask });
  events.get('message')({ origin: 'https://box.test', source: f.contentWindow, data: { type: 'wizard:appearance:ready', version: 1 } });
  return messages.at(-1).appearance;
}

test('Appearance v1 adds the skin family without changing the palette field', () => {
  const a = appearance('obsidian-light', id => id.startsWith('obsidian') ? 'mizel' : 'wizard');
  assert.equal(a.version, 1);
  assert.equal(a.skin, 'obsidian-light', 'the palette id, as before');
  assert.equal(a.family, 'mizel');
  assert.equal(appearance('grove').family, 'wizard', 'no skin engine yet: the default family');
});

// A WosExperience as Settings reads it: a For testers box with two authors' tweaks.
const tweak = (id, extra = {}) => ({ id, name: id.split('/')[1], author: id.split('/')[0], builtin: false, layout: '', view: '', on: false, ...extra });
function experienceStub(tweaks, extra = {}) {
  return { installedReady: true, state: { owner: 'wizard', busy: false, error: '', active: [], shell: 'phone', tweaks, locked: false, channel: 'latest' },
    authors: async () => [{ id: 'wizard', name: 'Wizard' }, { id: 'miguel', name: 'Miguel' }], toggle: async () => {}, groups: () => [], ...extra };
}

test('colors and tweaks are separate: onboarding offers every color; Look offers tweak sets apart from color', async () => {
  // Onboarding lists every colour: covered by tests/welcome-every-skin.test.mjs 'Pick a skin: one flat grid of every skin in WosSkin.list order, including a skin in no family'.
  // A colour pick never swaps the tweak set: covered by tests/look-skin-colour-separation.test.mjs '${shell}: separate Skin/Color choices never replace the independent tweak mix (#801)'.
  const E = experienceStub([tweak('miguel/send-and-go'), tweak('wizard/background-continue', { on: true }), tweak('miguel/reply-summary')]);
  const h = lookPage('phone', E); await tick(); h.view.focus('look');
  const html = h.html();
  assert.equal((html.match(/data-tweak-toggle="/g) || []).length, 3, 'a switch per tweak');
  assert.match(html, /data-tweak-toggle="wizard\/background-continue" role="switch" aria-checked="true"/);
  assert.match(html, /data-tweak-toggle="miguel\/send-and-go" role="switch" aria-checked="false"/, 'everything else starts off');
  assert.doesNotMatch(html, /data-tweakauthor=|data-tweakpreset/, 'one flat list: no per-author quick button, no preset sets');
  assert.ok(html.indexOf('data-tweak-toggle') > html.indexOf('<h4>Colors</h4>'), 'tweaks sit apart from colour');
  // Each tweak set shows its author's display name (real experience.js reading the real profiles), not the id.
  const names = Object.fromEntries((await experienceRuntime().E.authors()).map(a => [a.id, a.name]));
  for (const who of ['wizard', 'miguel']) assert.ok(names[who] && names[who] !== who, `${who} set has a display name: ${names[who]}`);
  h.view.destroy();
});

test('features on for everyone are plain settings where they act, not tweaks', async () => {
  const tweaks = [tweak('wizard/unified-inbox', { builtin: true, on: true, name: 'Notifications in Chats' }), tweak('wizard/machines-home', { builtin: true, name: 'Machines on Home' }),
    tweak('miguel/ai-apps', { layout: 'ai-apps', name: 'AI apps' }), tweak('miguel/send-and-go', { name: 'Send and go' })];
  // On a desktop with standard views, the view tweaks move to the Shell view picker; built-ins stay out either way.
  const desk = lookPage('desktop', experienceStub(tweaks, { desktopViews: [{ id: 'classic', name: 'Desks' }, { id: 'ai-apps', name: 'AI apps' }], desktopView: 'classic' }));
  const look = desk.html().match(/<section data-settings-feature="look">[\s\S]*?<\/section>/)[0];
  assert.match(look, /data-tweak-toggle="miguel\/send-and-go"/, 'Tweaks lists only contributed ones');
  assert.doesNotMatch(look, /data-tweak-toggle="(wizard\/unified-inbox|wizard\/machines-home|miguel\/ai-apps)"/);
  assert.match(look, /data-desktop-view="ai-apps"/, 'the view is a Shell view choice');
  assert.doesNotMatch(look, /Built in/, 'no "built-in tweaks"');
  desk.view.destroy();
  // The built-ins are ordinary switches on the pages where they act.
  const chats = lookPage('phone', experienceStub(tweaks)); chats.view.focus('chats');
  assert.match(chats.html(), /<h4>Notifications<\/h4><button type="button" class="st-row tw-row" data-tweak-toggle="wizard\/unified-inbox" role="switch" aria-checked="true">/);
  chats.view.focus('appearance');
  assert.match(chats.html(), /<h4>Home<\/h4><button type="button" class="st-row tw-row" data-tweak-toggle="wizard\/machines-home"/);
  assert.doesNotMatch(chats.html().match(/<section data-settings-feature="home-network">[\s\S]*?<\/section>/)[0], /tw-by/, 'no author on a setting');
  chats.view.destroy();
});

test('review: a new skin starts from the worn own skin\'s choices; an upgraded device keeps the retired Home map CSS for its first frame', async () => {
  const plain = experienceRuntime(); await plain.E.refresh();
  const base = await plain.E.defaults();
  // Notifications in Chats is a Settings › Chats setting, not a tweak (issue 1352): a new skin never lists or saves it.
  assert.equal(base['wizard/unified-inbox'], undefined); assert.equal(base['miguel/send-and-go'], false);
  const worn = experienceRuntime({ mySkin: { active: { id: 'own', tweaks: { 'wizard/unified-inbox': false, 'miguel/send-and-go': true } }, recipes: [] } });
  await worn.E.refresh();
  const d = await worn.E.defaults();
  assert.equal(d['wizard/unified-inbox'], undefined, 'not offered in New skin');
  assert.equal(worn.E.state.tweaks.find(t => t.id === 'wizard/unified-inbox')?.on, false, 'an older skin\'s saved off still holds');
  assert.equal(d['miguel/send-and-go'], true, 'the worn skin\'s on');
  // Catalog policy: a retired id stays out of the list, and the boot preload CSS still hides stock Home.
  const cat = JSON.parse(read('web/tweaks/catalog.json'));
  for (const old of Object.keys(cat.aliases)) {
    assert.ok(!cat.tweaks.includes(old), old + ' is retired');
  }
  // the Home map an old id now names (its CSS still preloaded at boot) on stock Home's top row: hidden while listed
  // (the old pin sat behind `old === 'miguel/machines-home'`, which no retired id ever is: it never ran)
  { const id = cat.aliases['wizard/machines-home']; assert.equal(id, 'miguel/machines-home');
    const doc = createDocument(), top = doc.createElement('div'), home = doc.createElement('div');
    home.className = 'home'; top.className = 'home-top'; home.appendChild(top); doc.body.appendChild(home);
    const css = read(`web/tweaks/${id}/tweak.css`);
    doc.documentElement.setAttribute('data-tweaks', id);
    assert.equal(cascade(top, css).display?.value, 'none', 'boot preload still hides stock Home');
    doc.documentElement.setAttribute('data-tweaks', '');
    assert.notEqual(cascade(top, css).display?.value, 'none'); }
});
