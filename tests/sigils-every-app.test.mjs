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
  'browser', 'card-benefits', 'cinequeue', 'defleur-video', 'files', 'messenger', 'morning-report', 'notifications', 'secret-drop',
  'sniper', 'transcriber', 'wisdom', 'wizard-agent-service', 'wizard-calendar', 'wizard-chatgpt', 'wizard-claude',
  'wizard-cloudflare', 'wizard-search', 'wizard-shopping', 'wizard-tinfoil', 'wizard-ux',
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

test('an app with no sigil gets a masked disc with its initial cut out, never painted text', () => {
  const S = sigil();
  for (const a of [{ id: 'zz-unknown', name: 'Zebra' }, { id: 'x', name: '' }, { id: 'q', name: '<b>"Quote"' }, { id: 'e', name: 'émile' }]) {
    const h = S.html(a);
    assert.match(h, /^<i class="sgi sgl" aria-hidden="true" style="--sg:url\(&#39;data:image\/svg\+xml,/, h);
    assert.doesNotMatch(h, /<(?!i |\/i>)/, 'no extra markup injected: ' + h);
    const s = S.of(a);
    assert.match(s.color, /^#[0-9A-F]{6}$/i);
  }
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
  const house = JSON.parse(js.match(/const HOUSE = (\{.*?\});/)[1]);
  const src = read('tools/sigils/build.py');
  for (const id of Object.keys(house)) assert.ok(src.includes(`'${id}'`), `HOUSE ${id} not in build.py`);
});
