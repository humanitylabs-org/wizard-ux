// New desk sorts apps into Apps / Agent apps / Agents / Connectors with system apps first, on every skin (James,
// 23 Oct 2026). The Apps sheet keeps its Recent row on every skin: no skin (or retired layout tweak) swaps it.
// Each test runs the real code: the phone's New desk (web/app-cards.js renderEmpty) and Apps sheet (app.js
// renderLauncher) over the real core/app-kinds.js, their tiles through the real stylesheets (tests/fixtures/mini-css.mjs),
// and the App Store's ?kind= entry (web/store/store.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { withShellParts } from './fixtures/shell-parts.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { block, between, runRecording } from './fixtures/source-slice.mjs';
import { loadFile, runPart } from './fixtures/r5B-parts.mjs';
import { styles } from './fixtures/w5-css.mjs';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const app = withShellParts(read('web/app.js'));
const SKINS = ['nebula', 'obsidian', 'landscapes', 'novairecito', 'sepia', 'grove'];
const APPS = [{ id: 'zeta', name: 'Zeta', kind: 'wizard', url: '/z/' }, { id: 'alpha', name: 'Alpha', kind: 'wizard', url: '/a/' }, { id: 'files', name: 'Files', kind: 'wizard', url: '/f/' }, { id: 'setup', name: 'Setup', kind: 'wizard', url: '/s/' },
  { id: 'agents', name: 'Agents', kind: 'wizard', url: '/ag/' }, { id: 'bob', name: 'Bob', kind: 'chats' }, { id: 'wizard-claude', name: 'Claude', kind: 'wizard', type: 'external' }, { id: 'acme', name: 'Acme', kind: 'wizard', type: 'external' }];
const APP = Object.fromEntries(APPS.map(a => [a.id, a]));
const BACKEND = [{ id: 'notes-svc', name: 'Notes', kind: 'wizard' }, { id: 'mem', name: 'Memory', kind: 'wizard' }];
// The real phone New desk for `skin`, rendered into a mini-dom page.
function newDesk(skin = 'nebula') {
  const doc = createDocument(); doc.documentElement.setAttribute('data-skin', skin);
  const ctx = { document: doc, window: { WizCore: { backendApps: () => BACKEND } } };
  loadFile('web/core/app-kinds.js', ctx);
  const appTile = a => `<button class="lapp" data-app="${a.id}"><span class="ic"></span><span class="nm">${a.name}</span></button>`;
  const { out } = runPart('web/app-cards.js', 'appParts', 'cards', { APPS, APP, appVars: { tileN: 0, W: {}, desks: [] }, appTile, esc: String, ico: () => '<span class="ic"></span>' }, ctx);
  doc.body.innerHTML = out.renderEmpty(0);
  return { doc, kinds: ctx.window.WosAppKinds, group: k => doc.body.querySelector(`.kg-${k} .lgrid`) };
}
const ids = grid => grid.querySelectorAll('.lapp').map(b => b.dataset.app || b.dataset.appinfo || `+${b.dataset.storekind}`);

test('New desk wears the kinds on every skin; the Apps sheet keeps its Recent row', () => {
  const stock = newDesk().doc.body.innerHTML;
  for (const skin of SKINS) {
    const { doc } = newDesk(skin);
    assert.equal(doc.body.innerHTML, stock, `${skin}: the same New desk`);
    assert.ok(doc.body.querySelector('.desk-scroll.new-desk.kinds'));
    assert.deepEqual(doc.body.querySelectorAll('.lgroup h4').map(h => h.textContent), ['Apps', 'Agent apps', 'Agents', 'Connectors']);
    assert.ok(doc.body.querySelector('.forag[data-fold="agents"] .kg-wiz'), 'Agent apps, Agents and Connectors fold under For agents');
    assert.equal(doc.body.querySelectorAll('.kg-views').length, 0, 'no Views group');
  }
  // The Apps sheet (app.js renderLauncher): Recent first, then Apps.
  const html = `${block(app, '  function appTile(a) {')}\n${block(app, '  function renderLauncher(q, live) {')}\nthis.renderLauncher = renderLauncher;`;
  for (const skin of SKINS) {
    const doc = createDocument(); doc.documentElement.setAttribute('data-skin', skin); const body = doc.createElement('div');
    const c = runRecording(html, { document: doc, $: () => body, APP, APPS, tileN: 0, esc: String, ico: () => '', store: { get: () => ['alpha', 'zeta'] }, window: { WizCore: { isMaintenanceApp: () => false } } });
    c.renderLauncher('', false);
    assert.deepEqual(body.querySelectorAll('.lgroup > h4').map(h => h.textContent.split(' ')[0]), ['Recent', 'Apps'], `${skin}: Recent row`);
    assert.deepEqual(body.querySelector('.lgroup .lgrid').querySelectorAll('.lapp').map(b => b.dataset.app), ['alpha', 'zeta']);
  }
  assert.doesNotMatch(app, /oursSkin|miguel\/layout/);
});
test('system apps lead each group', () => {
  const { kinds, group } = newDesk();
  assert.equal(kinds.isSystem(APP.setup), true, 'Setup is a system app');
  assert.deepEqual(ids(group('apps')), ['files', 'setup', 'alpha', 'zeta', '+apps'], 'system first, then A to Z');
  assert.deepEqual(group('apps').querySelectorAll('.lapp-sys').map(b => b.dataset.app), ['files', 'setup'], 'ringed');
  assert.deepEqual(ids(group('conns')), ['wizard-claude', 'acme', '+connections']);
  const byName = [...APPS].sort(kinds.byName).map(a => a.id);
  assert.ok(byName.indexOf('setup') < byName.indexOf('alpha') && byName.indexOf('files') < byName.indexOf('acme'), 'the shared order: system before A to Z');
});
test('kind styles: Miguel\'s packages keep their colours, the base stylesheet carries the layout for every skin', () => {
  const base = withShellParts(read('web/styles.css'));
  for (const skin of SKINS) {
    const file = `web/skins/${skin}/skin.css`, sheets = existsSync(new URL('../' + file, import.meta.url)) ? [base, read(file)] : [base];
    const { doc } = newDesk(skin);
    const ring = styles(doc.body.querySelector('.kg-apps .lapp-sys .ic'), sheets).border;
    assert.equal(ring, ['obsidian', 'landscapes'].includes(skin) ? '2.5px solid #8f63ff' : '2.5px solid var(--violet-2, #8f63ff)', `${skin}: the system ring`);
    assert.equal(styles(doc.body.querySelector('.kg-apps .lapp:not(.lapp-sys) .ic'), sheets).border, undefined, `${skin}: other tiles wear no ring`);
    const fold = doc.body.querySelector('.forag .fa-body');
    assert.equal(styles(fold, sheets).display, 'none', `${skin}: For agents starts folded`);
    doc.body.querySelector('.forag').classList.add('open'); assert.notEqual(styles(fold, sheets).display, 'none', `${skin}: and opens`);
    if (sheets[1] && !['obsidian', 'landscapes'].includes(skin)) assert.doesNotMatch(sheets[1], /lapp-sys|lclose|sysbox|forag|new-desk\.kinds/);
  }
});

test('every kind ends in a "+ Get" tile for its App Store section; Agents also has Build agents', () => {
  const { doc, group } = newDesk();
  for (const [k, kind, label] of [['apps', 'apps', 'Get apps'], ['wiz', 'agent-apps', 'Get agent apps'], ['agents', 'agents', 'Get agents'], ['conns', 'connections', 'Get connectors']]) {
    const last = group(k).querySelectorAll('.lapp').at(-1);
    assert.equal(last.dataset.storekind, kind, `${k} ends in + Get`); assert.equal(last.querySelector('.nm').textContent, label);
  }
  assert.equal(doc.body.querySelector('.kg-wiz h4').textContent, 'Agent apps');
  const build = group('agents').querySelector('[data-app="agents"]'); assert.equal(build.querySelector('.nm').textContent, 'Build agents');
  // The App Store opens on the section a tile names (web/store/store.js ?kind=).
  const store = withShellParts(read('web/store/store.js')), KINDS = between(store, '  const KINDS = [', '  const KIND_OF'), entry = between(store, "    const reqKind = new URLSearchParams", '    const initialQuery');
  for (const kind of ['apps', 'agent-apps', 'agents', 'connections', 'nope']) {
    const opened = [];
    runRecording(`${KINDS}\n${entry}`, { location: { search: `?kind=${kind}` }, URLSearchParams, S: { stack: [] }, openKind: k => opened.push(k) });
    assert.deepEqual(opened, kind === 'nope' ? [] : [kind], kind);
  }
});
