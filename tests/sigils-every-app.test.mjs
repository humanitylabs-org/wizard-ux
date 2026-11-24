// Every app gets a real sigil, and an app without one still never looks broken.
// Standard: tools/sigils/README.md. The rule this guards: an app's launcher/dock mark is always a mask drawn in the
// same box as every other sigil (never painted text, never an <img>, never an opaque square), and every app we
// know ships in the Wizard App Store has a designed HOUSE entry.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { between, block, runRecording } from './fixtures/source-slice.mjs';
import { parsePage } from './fixtures/w1-pages.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { cascade, styleOf } from './fixtures/mini-css.mjs';

const root = new URL('../', import.meta.url).pathname;
const read = p => fs.readFileSync(root + p, 'utf8');
function sigil() {
  const window = {};
  vm.runInContext(read('web/core/sigils.js'), vm.createContext({ window, encodeURIComponent, String, Set, Array, JSON }));
  return window.WizSigil;
}

// Apps published in the Wizard App Store / index or installed by default on a Wizard box. When you publish a new
// app, add its id here AND give it a HOUSE entry in tools/sigils/build.py (see tools/sigils/README.md).
const STORE_APPS = [
  'browser', 'card-benefits', 'movies', 'defleur-video', 'files', 'messenger', 'money', 'morning-report', 'notifications', 'profiles', 'secret-drop',
  'sniper', 'transcriber', 'wisdom', 'wizard-agent-service', 'wizard-calendar', 'wizard-chatgpt', 'wizard-claude',
  'wizard-cloudflare', 'wizard-podcasts', 'wizard-search', 'wizard-shopping', 'wizard-notes', 'wizard-tinfoil', 'wizard-ux',
  // Launch set: every other app a stock Wizard ships with, so none can fall back to a letter.
  'messages', 'recorder', 'sasquatch', 'tasks', 'knowledge', 'setup', 'settings', 'agents', 'wizard-connection-router',
  'wizard-simplefin', 'wizard-google', 'wizard-youtube-music', 'wizard-voice-service',
];

test('every known Wizard App Store app has a designed sigil (no letter fallback)', () => {
  const S = sigil();
  const missing = STORE_APPS.filter(id => !S.house[id] || !S.has(S.house[id][0]) && !['hat', 'hat-private', 'agents'].includes(S.house[id][0]));
  assert.deepEqual(missing, [], `add a HOUSE entry in tools/sigils/build.py for: ${missing.join(', ')}`);
});

// owner-correction: humanitylabs-org/wizard-ux#1166 · 2026-11-08 · "Why was my home icon replaced with a Hermes icon? Please undo and revert that. Hermes should not appear anywhere in our app icons."
test('Home keeps its previous house artwork and app icons never select Hermes', () => {
  const S = sigil();
  for (const p of ['web/app.js', 'web/core/workspace-navigation.js', 'web/desktop.html']) {
    assert.match(read(p), /class="sgi sg-home"/, `${p}: original Home glyph`);
  }
  assert.equal(S.has('hermes'), false);
  for (const id of ['wizard', 'hermes-agent', 'hermes-frontend-3']) {
    assert.equal(S.of({ id, name: 'Hermes' }).glyph, 'hat');
    assert.doesNotMatch(S.html({ id, name: 'Hermes' }), /sg-hermes|sgb-hermes|sglogo/);
  }
  for (const icon of ['hermes', '/wizard-os-home/brand/apps/hermes.svg']) {
    assert.equal(S.of({ id: 'custom', icon }).glyph, 'hat');
    assert.doesNotMatch(S.html({ id: 'custom', icon }), /sg-hermes|sgb-hermes|sgimg/);
  }
  assert.match(S.named('hermes'), /sg-hat/);
  assert.doesNotMatch(read('web/core/sigils.css'), /url\(["']?\/wizard-os-home\/brand\/apps\/hermes\.svg/);
  assert.match(read('web/core/agents.js'), /return A\.isPrivate\(a\) \? 'hat-private' : 'hat'/);
  // run beside the pins above: the shells' real Home marks and the agents' real glyph
  const home = createDocument(); home.body.innerHTML = runRecording(`this.f = desk => {\n${between(read('web/core/workspace-navigation.js'), '    if (desk.home) return ', '\n')}\n};`, {}).f({ home: true });
  assert.ok(home.querySelector('.sgi.sg-home'), 'desktop desk strip: the house Home glyph');
  const ov = runRecording(`this.f = d => { let body = '';\n${between(read('web/app.js'), '    if (d.home) body = ', '\n')}\nreturn body; };`, { primary: { color: '#000' } });
  const ovDoc = createDocument(); ovDoc.body.innerHTML = ov.f({ home: true }); assert.ok(ovDoc.querySelector('.sgi.sg-home'), 'phone overview: the house Home glyph');
  const page = createDocument(), html = read('web/desktop.html'); page.body.innerHTML = html.slice(html.indexOf('<body'), html.lastIndexOf('</body>')).replace(/^<body[^>]*>/, '');
  assert.ok(page.querySelector('#logo .sgi.sg-home'), 'desktop Home button: the house Home glyph'); assert.equal(page.querySelector('#logo [class*="hermes"]'), null);
  const G = runRecording(`this.g = { ${block(read('web/core/agents.js'), '    glyph(a) {')} };`, { A: { isPrivate: a => !!a.private } });
  assert.equal(G.g.glyph({ id: 'hermes' }), 'hat'); assert.equal(G.g.glyph({ id: 'x', private: true }), 'hat-private'); assert.notEqual(G.g.glyph({ id: 'hermes', name: 'Hermes' }), 'hermes');
  assert.equal(S.brand['wizard-google'], 'google');
  assert.equal(S.brand['wizard-youtube-music'], 'youtube-music');
});

// The real phone dock paint (web/app-desks.js paintOrbApp + renderDots) into the real phone page (web/index.html),
// then the real desks.css cascade on the marks it drew.
function phoneDockMarks({ corner = false } = {}) {
  const doc = parsePage('index.html');
  if (corner) doc.querySelector('#device').classList.add('orb-corner');
  const ctx = { appVars: { idx: 1, desks: [0, 1, 2].map(i => ({ wins: i ? ['w'] : [], home: !i })) }, $: q => doc.querySelector(q), document: doc,
    window: { WizSigil: { orb() {} } }, deskSigil: i => `<span class="dsg">${i}</span>`, deskName: i => `Desk ${i}`, isReviewDesk: () => false, atPickerEnd: () => false, esc: String };
  vm.createContext(ctx);
  vm.runInContext(`${between(read('web/app-desks.js'), '  let orbAppHtml = null;', '  /* Dots: tap = jump to that desk.')}\nthis.renderDots = renderDots;`, ctx);
  ctx.renderDots();
  return { inactive: doc.querySelector('.ddot.sig[data-goto] .dsg'), active: doc.querySelector('#orbApp .dsg'), plus: doc.querySelector('.ddot.dplus .dsg') };
}
test('phone navigation keeps active and inactive app marks smaller and inside the orb', () => {
  const css = read('web/core/desks.css'), m = phoneDockMarks();
  assert.ok(m.inactive && m.active && m.plus, 'the dock drew app marks, the orb mark and New desk');
  assert.equal(styleOf(m.inactive, css, 'scale'), '.9', 'inactive marks step down by ten percent');
  assert.equal(styleOf(m.active, css, 'scale'), '.9', 'the active mark too');
  assert.equal(styleOf(m.plus, css, 'scale'), '', 'New desk is not shrunk');
  const cap = parseFloat(styleOf(m.active, css, 'max-width'));
  assert.equal(cap, 54, 'the active mark is capped before the shared optical scale');
  assert.ok(cap * .9 < 50, 'the active mark remains inside the visible half-diameter of the orb');
  assert.equal(styleOf(m.active, css, 'max-height'), '54%');
  assert.equal(styleOf(m.inactive, css, 'max-width'), '', 'only the orb mark gets the containment cap');
  const corner = phoneDockMarks({ corner: true });
  assert.equal(styleOf(corner.active, css, 'scale'), '', 'the corner orb keeps its own sizing');
});

test('Cloudflare wears the warm cloud', () => {
  const S = sigil(), s = S.of({ id: 'wizard-cloudflare', name: 'Cloudflare (Testing)' });
  assert.equal(s.glyph, 'cloud');
  assert.match(S.html({ id: 'wizard-cloudflare' }), /class="sgi sgb sgb-cloudflare sg-cloud"/);
});

test('real products carry their brand mark; a skin opts in, every other skin keeps the house glyph', () => {
  const S = sigil();
  const want = { 'wizard-cloudflare': 'cloudflare', 'wizard-claude': 'claude', 'wizard-chatgpt': 'chatgpt', 'wizard-tinfoil': 'tinfoil' };
  for (const [id, mark] of Object.entries(want)) {
    assert.equal(S.brand[id], mark);
    assert.ok(fs.existsSync(root + `web/brand/apps/${mark}.svg`), `web/brand/apps/${mark}.svg`);
    assert.match(S.html({ id }), new RegExp(`class="sgi sgb sgb-${mark} sg-${S.house[id][0]}"`));
  }
  // house apps (Files, Notifications…) never get a brand mark
  for (const id of ['files', 'notifications', 'morning-report', 'calendar']) assert.doesNotMatch(S.html({ id }), /sgb/);
  // every skin shows them: the brand rules live in the generated sigils.css, cascaded on the mark sigils.js draws
  const bdoc = createDocument(), sheet = read('web/core/sigils.css');
  for (const [id, mark] of Object.entries(want)) {
    bdoc.body.innerHTML = S.html({ id });
    assert.equal(cascade(bdoc.querySelector('.sgi'), sheet)['--sgb']?.value, `url("/wizard-os-home/brand/apps/${mark}.svg")`, id);
  }
});

// static-rule: every brand mark in sigils.js agrees with a source row in tools/sigils/README.md (files that must agree)
test('every brand mark has a recorded source', () => {
  const S = sigil(), readme = read('tools/sigils/README.md');
  for (const mark of new Set(Object.values(S.brand))) assert.match(readme, new RegExp(`\\| \x60${mark}\x60 \\|`), `README source row for ${mark}`);
});

test('an app with no sigil never shows a letter: it gets the house glyph its id and name call for', () => {
  const S = sigil();
  const want = {
    'wizard-mail|Mail': 'mail', 'smart-home|Home Assistant': 'home', 'wizard-health|Health': 'heart', 'wizard-microsoft|Microsoft': 'mail',
    'wizard-monarch|Monarch': 'dollar', 'wizard-simplefin|SimpleFIN': 'bank', 'wizard-brightdata|Bright Data': 'globe', 'backup|Backup': 'cloud',
    'contacts|Contacts': 'social', 'carlos-crm-demo|Carlos CRM (demo)': 'social', 'maverick-command|Maverick Command': 'console',
    'pr-board|PR board': 'projects', 'setup|Setup': 'setup', 'camera|Camera': 'image', 'messages|Messages': 'chats', 'spotify|Spotify': 'music',
    'telegram|Telegram': 'chats', 'line|LINE': 'chats', 'grab|Grab': 'pin', 'chrome|Chrome': 'globe', 'settings|Settings': 'setup',
    'wizard-twitterapi|TwitterAPI.io': 'social', 'wizard-youtube-music|YouTube Music': 'music', 'zz-unknown|Zebra': 'apps', 'x|': 'apps',
    'private-thing|Private thing': 'apps', 'pipeline-tool|Pipeline': 'projects',
  };
  for (const [key, glyph] of Object.entries(want)) {
    const [id, name] = key.split('|'), h = S.html({ id, name, icon: name.charAt(0) || '?' });
    const brand = S.brand[id] ? ` sgb sgb-${S.brand[id]}` : '';
    assert.equal(h, `<i class="sgi${brand} sg-${glyph}" aria-hidden="true"></i>`, key);
    assert.match(S.of({ id, name }).color, /^#[0-9A-F]{6}$/i);
  }
  for (const a of [{ id: 'q', name: '<b>"Quote"' }, { id: 'e', name: 'émile' }]) assert.doesNotMatch(S.html(a), /sgl|<(?!i |\/i>)/, a.id);
  // the hue is stable per id, so the same app keeps the same colour everywhere
  assert.equal(S.of({ id: 'zz-unknown' }).color, S.of({ id: 'zz-unknown', name: 'Other' }).color);
});

test('an app\'s own same-origin icon file is used as its silhouette; anything else is refused', () => {
  const S = sigil();
  assert.match(S.html({ id: 'own', name: 'Own', icon: '/own/icon.svg' }), /class="sgi sgl sgimg"[^>]*--sg:url\('\/own\/icon\.svg'\)/);
  for (const bad of ['https://evil.example/x.png', '//evil.example/x.svg', "/x.svg') ; background:red", 'javascript:alert(1)', '/x.gif', 'data:image/svg+xml,<svg/>'])
    assert.doesNotMatch(S.html({ id: 'own', name: 'Own', icon: bad }), /sgimg/, bad);
});

test('the fallback CSS keeps the mask: no rule turns a letter mark back into a painted box', () => {
  // the mark sigils.js draws for an app's own icon file is the letter-mark box (.sgi.sgl), drawn as a mask
  const S = sigil(), html = S.html({ id: 'own', name: 'Own', icon: '/own/icon.svg' });
  const base = read('web/core/sigils.css');
  const skins = fs.readdirSync(root + 'web/skins').filter(f => fs.existsSync(root + `web/skins/${f}/skin.css`));
  let painted = 0;
  for (const skin of ['', ...skins]) {
    const doc = createDocument(); if (skin) doc.documentElement.setAttribute('data-skin', skin);
    doc.body.innerHTML = `<div class="dock">${html}</div>`;
    const mark = doc.querySelector('.sgi.sgl'); assert.ok(mark, html);
    const won = cascade(mark, [base, skin ? read(`web/skins/${skin}/skin.css`) : ''].join('\n'));
    const label = skin || 'no skin';
    assert.equal(won['font-size']?.value, '0', `${label}: the letter itself is never painted`);
    for (const prop of ['mask', 'mask-image', '-webkit-mask', '-webkit-mask-image']) assert.notEqual(won[prop]?.value, 'none', `${label}: ${prop}`);
    assert.ok(/var\(--sg\)/.test(won['mask-image']?.value || won['-webkit-mask-image']?.value || won.mask?.value || won['-webkit-mask']?.value || ''), `${label}: drawn through the --sg mask`);
    assert.notEqual(won.background?.value, 'none', label); assert.notEqual(won.width?.value, 'auto', label);
    painted++;
  }
  assert.ok(painted >= 4, 'no skin and the built-in skins');
});

// Rebuild with the real tools/sigils/build.py in a scratch tree (its glyph library comes from the committed
// tools/sigils/sigils.json: skia-pathops, which draws the glyphs, is not needed to emit them) and compare the outputs.
// static-rule: the committed sigils.js / sigils.css must agree with what tools/sigils/build.py emits (generated files)
test('the generated files are in sync with the template (rebuild with tools/sigils/build.py)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r6B-sigils-'));
  try {
    const tools = path.join(tmp, 'tools', 'sigils'); fs.mkdirSync(tools, { recursive: true }); fs.mkdirSync(path.join(tmp, 'web', 'core'), { recursive: true });
    for (const f of fs.readdirSync(root + 'tools/sigils')) if (f !== 'glyphs.py' && /\.(py|js|css|json)$/.test(f)) fs.copyFileSync(root + 'tools/sigils/' + f, path.join(tools, f));
    fs.writeFileSync(path.join(tools, 'glyphs.py'), "import json, os\ndef build():\n    return json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sigils.json')))\n");
    fs.symlinkSync(root + 'web/brand', path.join(tmp, 'web', 'brand'));
    execFileSync('python3', [path.join(tools, 'build.py')], { stdio: 'pipe' });
    for (const f of ['sigils.js', 'sigils.css'])
      assert.ok(fs.readFileSync(path.join(tmp, 'web', 'core', f), 'utf8') === read('web/core/' + f), `web/core/${f} is stale; rerun tools/sigils/build.py`);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
