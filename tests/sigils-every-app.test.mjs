// Every app gets a real sigil, and an app without one still never looks broken.
// Standard: tools/sigils/README.md. The rule this guards: an app's launcher/dock mark is always a mask drawn in the
// same box as every other sigil (never painted text, never an <img>, never an opaque square), and every app we
// know ships in the Wizard App Store has a designed HOUSE entry.
import test from 'node:test';
import assert from 'node:assert/strict';
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
  assert.equal(S.brand['wizard-google'], 'google');
  assert.equal(S.brand['wizard-youtube-music'], 'youtube-music');
});

test('phone navigation keeps active and inactive app marks smaller and inside the orb', () => {
  const css = read('web/core/desks.css');
  const nav = css.match(/#device:not\(\.orb-corner\) \.dock :is\(\.ddot\.sig\[data-goto\], #orbApp\) \.dsg\s*\{([^}]*)\}/s);
  assert.ok(nav, 'one shell rule sizes active and inactive app marks without shrinking New desk');
  assert.match(nav[1], /scale:\s*\.9;/, 'both navigation states step down by ten percent');
  const active = css.match(/#device:not\(\.orb-corner\) \.dock #orbApp \.dsg\s*\{([^}]*)\}/s);
  assert.ok(active, 'the active app has an explicit orb containment cap');
  const cap = Number(active[1].match(/max-width:\s*([\d.]+)%/)?.[1]);
  assert.equal(cap, 54, 'the active mark is capped before the shared optical scale');
  assert.ok(cap * .9 < 50, 'the active mark remains inside the visible half-diameter of the orb');
  assert.match(active[1], /max-height:\s*54%;/);
});

test('two-orb active marks preserve the Hermes light badge and black portrait', () => {
  const css = read('web/layouts/two-orb/layout.css');
  assert.match(css, /#orbApp :is\(img, \.sgi, svg\)\s*\{[^}]*max-width:\s*24px;[^}]*max-height:\s*24px;[^}]*\}/s,
    'all active-orb marks keep the same containment cap');
  assert.match(css, /#orbApp :is\(img, \.sgi:not\(\.sg-hermes\), svg\)\s*\{[^}]*filter:\s*brightness\(0\) invert\(1\);[^}]*\}/s,
    'only ordinary masks are whitened in the active orb');
  assert.match(css, /#orbApp \.sgi:not\(\.sg-hermes\)\s*\{[^}]*background:\s*(?:#fff|white);[^}]*\}/s,
    'the layout never paints over the Hermes badge');
  assert.match(css, /:is\(\.to-face, \.to-chip-sig\) \.sgi\s*\{[^}]*width:\s*82%;[^}]*height:\s*82%;[^}]*\}/s,
    'all agent marks keep the approved optical box');
  assert.match(css, /:is\(\.to-face, \.to-chip-sig\) \.sgi:not\(\.sg-hermes\)\s*\{[^}]*filter:\s*brightness\(0\) invert\(1\)[^}]*\}/s,
    'agent-orb whitening also excludes the full-colour Hermes badge');
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
  // every mark has a recorded source
  const readme = read('tools/sigils/README.md');
  for (const mark of new Set(Object.values(S.brand))) assert.match(readme, new RegExp(`\\| \x60${mark}\x60 \\|`), `README source row for ${mark}`);
  // every skin shows them: the brand rules live in the generated sigils.css
  assert.match(read('web/core/sigils.css'), /\.sgi\.sgb-cloudflare/);
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

test('the generated files are in sync with the template (rebuild with tools/sigils/build.py)', () => {
  const tpl = read('tools/sigils/sigils.template.js'), js = read('web/core/sigils.js');
  const strip = s => s.replace(/\/\*NAMES\*\/|\/\*HOUSE\*\/|\/\*BRAND\*\/|\/\*FALLBACK\*\//g, '');
  for (const line of strip(tpl).split('\n').filter(l => l.trim() && !/NAMES|HOUSE|BRAND = |FALLBACK/.test(l)))
    assert.ok(js.includes(line), 'web/core/sigils.js is stale; rerun tools/sigils/build.py. Missing: ' + line.trim());
  const house = JSON.parse(js.match(/const HOUSE = [^{]*(\{.*?\})[);]/)[1]);
  const src = read('tools/sigils/build.py');
  for (const id of Object.keys(house)) assert.ok(src.includes(`'${id}'`), `HOUSE ${id} not in build.py`);
});
