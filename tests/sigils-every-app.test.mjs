// Every app gets a real sigil, and an app without one still never looks broken.
// Standard: tools/sigils/README.md. The rule this guards: an app's launcher/dock mark is always a mask drawn in the
// same box as every other sigil (never painted text, never an <img>, never an opaque square), and every app we
// know ships in the Wizard App Store has a designed HOUSE entry.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';

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
  'wizard-cloudflare', 'wizard-google', 'wizard-podcasts', 'wizard-search', 'wizard-shopping', 'wizard-notes', 'wizard-tinfoil',
  'wizard-ux', 'wizard-youtube-music',
];

test('every known Wizard App Store app has a designed sigil (no letter fallback)', () => {
  const S = sigil();
  const missing = STORE_APPS.filter(id => !S.house[id] || !S.has(S.house[id][0]) && !['hat', 'hat-private', 'agents'].includes(S.house[id][0]));
  assert.deepEqual(missing, [], `add a HOUSE entry in tools/sigils/build.py for: ${missing.join(', ')}`);
});

test('Cloudflare wears the warm cloud', () => {
  const S = sigil(), s = S.of({ id: 'wizard-cloudflare', name: 'Cloudflare (Testing)' });
  assert.equal(s.glyph, 'cloud');
  assert.match(S.html({ id: 'wizard-cloudflare' }), /class="sgi sgb sgb-cloudflare sg-cloud"/);
});

test('real products carry their brand mark; a skin opts in, every other skin keeps the house glyph', () => {
  const S = sigil();
  const want = {
    'wizard-cloudflare': 'cloudflare', 'wizard-claude': 'claude', 'wizard-chatgpt': 'chatgpt',
    'wizard-google': 'google', 'wizard-tinfoil': 'tinfoil', 'wizard-youtube-music': 'youtube-music',
  };
  for (const [id, mark] of Object.entries(want)) {
    assert.equal(S.brand[id], mark);
    assert.ok(fs.existsSync(root + `web/brand/apps/${mark}.svg`), `web/brand/apps/${mark}.svg`);
    assert.match(S.html({ id }), new RegExp(`class="sgi sgb sgb-${mark} sg-${S.house[id][0]}"`));
  }
  // house apps (Files, Notifications…) never get a brand mark
  for (const id of ['files', 'notifications', 'morning-report', 'calendar']) assert.doesNotMatch(S.html({ id }), /sgb/);
  // every mark has a recorded source
  const readme = read('tools/sigils/README.md');
  for (const mark of new Set(Object.values(S.brand))) assert.match(readme, new RegExp(`\\| \x60${mark}\x60 \\|`), `README source row for ${mark}`);
  // every skin shows them: the brand rules live in the generated sigils.css
  const core = read('web/core/sigils.css');
  assert.match(core, /\.sgi\.sgb-cloudflare/);
  for (const mark of ['google', 'youtube-music']) {
    assert.match(core, new RegExp(`\\.sgi\\.sgb-${mark} \\{ --sgb: url\\("/wizard-os-home/brand/apps/${mark}\\.svg"\\); \\}`));
    for (const skin of ['landscapes', 'obsidian']) {
      const css = read(`web/skins/${skin}/skin.css`);
      assert.match(css, new RegExp(`\\.sgb-${mark}`), `${skin} preserves ${mark}'s product colours`);
      assert.match(css, /background: var\(--sgb\) center \/ contain no-repeat !important/);
    }
  }
  assert.match(core, /\.sgi:is\(\.sgb-google, \.sgb-youtube-music\) \{ background: var\(--sgb\) center \/ contain no-repeat !important; filter: none !important; \}/);

  const pins = {
    google: ['ed9087d76cdc6d1c53698f6068f79872e77e87c8d012c0cfdad13b05b6ccb37c', '1b7bd30cb301a8efb47eec40a03b21cfce6f7921cdc4a82c6abbf93019fb2d95'],
    'youtube-music': ['f96c8a67f93717df8f9f57b0e96638b19e8fd80a165ddf83598592b5342612f5', '8adce35abe8685414ca53e58f3c2622bcba946e1ad0a1e220ad01f5fceb55e07'],
  };
  for (const [mark, [sourceHash, assetHash]] of Object.entries(pins)) {
    const asset = fs.readFileSync(root + `web/brand/apps/${mark}.svg`);
    assert.equal(createHash('sha256').update(asset).digest('hex'), assetHash, `${mark}: normalized asset stays pinned`);
    assert.match(readme, new RegExp(sourceHash), `${mark}: source hash recorded`);
    assert.match(readme, new RegExp(assetHash), `${mark}: normalized hash recorded`);
  }
  assert.match(read('web/brand/apps/google.svg'), /#4285F4.*#34A853.*#FBBC05.*#EA4335/);
  assert.match(read('web/brand/apps/youtube-music.svg'), /fill="#FF0000"/);
});

test('an app with no sigil never shows a letter: it gets the house glyph its id and name call for', () => {
  const S = sigil();
  const want = {
    'wizard-mail|Mail': 'mail', 'smart-home|Home Assistant': 'home', 'wizard-health|Health': 'heart', 'wizard-microsoft|Microsoft': 'mail',
    'wizard-monarch|Monarch': 'dollar', 'wizard-simplefin|SimpleFIN': 'dollar', 'wizard-brightdata|Bright Data': 'globe', 'backup|Backup': 'cloud',
    'contacts|Contacts': 'social', 'carlos-crm-demo|Carlos CRM (demo)': 'social', 'maverick-command|Maverick Command': 'console',
    'pr-board|PR board': 'projects', 'setup|Setup': 'wrench', 'camera|Camera': 'image', 'messages|Messages': 'chats', 'spotify|Spotify': 'music',
    'telegram|Telegram': 'chats', 'line|LINE': 'chats', 'grab|Grab': 'pin', 'chrome|Chrome': 'globe', 'settings|Settings': 'wrench',
    'wizard-twitterapi|TwitterAPI.io': 'social', 'zz-unknown|Zebra': 'apps', 'x|': 'apps',
    'private-thing|Private thing': 'apps', 'pipeline-tool|Pipeline': 'projects',
  };
  for (const [key, glyph] of Object.entries(want)) {
    const [id, name] = key.split('|'), h = S.html({ id, name, icon: name.charAt(0) || '?' });
    assert.equal(h, `<i class="sgi sg-${glyph}" aria-hidden="true"></i>`, key);
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
  const css = read('web/core/sigils.css');
  const rule = css.match(/\.sgi\.sgl\s*\{([^}]*)\}/);
  assert.ok(rule, '.sgi.sgl rule exists');
  assert.doesNotMatch(rule[1], /mask\s*:\s*none|background\s*:\s*none|width\s*:\s*auto/, rule[1]);
  assert.match(rule[1], /font-size:\s*0/);
  // Skins may restyle .sgi (colour, filter) but must never drop the mask on letter marks.
  for (const f of fs.readdirSync(root + 'web/skins')) {
    const p = `web/skins/${f}/skin.css`; if (!fs.existsSync(root + p)) continue;
    for (const m of read(p).matchAll(/([^{}]*\.sgl[^{}]*)\{([^}]*)\}/g))
      assert.doesNotMatch(m[2], /mask(-image)?\s*:\s*none/, `${p}: ${m[1].trim()}`);
  }
});

// Source-contract checks, not painted-browser acceptance. Keep dimensions shared;
// only the two source-colour product marks opt out of the layout's glyph paint.
for (const [file, surface] of [
  ['web/layouts/apps/layout.css', '.apd-tile'],
  ['web/layouts/apps/chrome.css', '.vc-tile'],
  ['web/layouts/orb/layout.css', '.ob-sat'],
  ['web/layouts/orb/phone.css', '.obp-sat'],
]) {
  test(`${surface}: product marks bypass layout glyph paint without losing shared dimensions`, () => {
    const css = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, selector]) => selector.includes(surface) && selector.includes('.sgi'));
    const paint = rules.filter(([, , body]) => /background\s*:/.test(body));
    assert.ok(paint.length > 0, `${file}: ordinary glyph paint is still present`);
    for (const [, selector] of paint) {
      assert.ok(selector.includes('.sgi:not(:where(.sgb-google, .sgb-youtube-music))'),
        `${file}: layout paint excludes exactly the two source-colour marks without raising specificity`);
    }
    assert.ok(rules.some(([, selector, body]) => selector.trim().endsWith(`${surface} .sgi`)
      && /width\s*:/.test(body) && /height\s*:/.test(body)),
    `${file}: shared icon dimensions still admit branded and ordinary glyphs`);
  });
}

test('the generated files are in sync with the template (rebuild with tools/sigils/build.py)', () => {
  const tpl = read('tools/sigils/sigils.template.js'), js = read('web/core/sigils.js');
  const strip = s => s.replace(/\/\*NAMES\*\/|\/\*HOUSE\*\/|\/\*BRAND\*\/|\/\*FALLBACK\*\//g, '');
  for (const line of strip(tpl).split('\n').filter(l => l.trim() && !/NAMES|HOUSE|BRAND = |FALLBACK/.test(l)))
    assert.ok(js.includes(line), 'web/core/sigils.js is stale; rerun tools/sigils/build.py. Missing: ' + line.trim());
  const house = JSON.parse(js.match(/const HOUSE = [^{]*(\{.*?\})[);]/)[1]);
  const src = read('tools/sigils/build.py');
  for (const id of Object.keys(house)) assert.ok(src.includes(`'${id}'`), `HOUSE ${id} not in build.py`);
});
