// My release layer (wizard-os#186): Miguel's behaviour and layout live in web/mine/ and apply on every skin; his skin
// packages (Dark, Light, Landscapes) are only look. Switching skins never changes how anything works.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const JAMES = ['nebula', 'grove', 'tide', 'ember', 'signal'];
const rules = css => [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => m[1].trim()).filter(s => !/^(from|to|\d+%)/.test(s) && !s.startsWith('@'));

test('the release flag loads first on both shells, and the layer right after core/skins.css', () => {
  for (const f of ['web/index.html', 'web/desktop.html']) {
    const html = read(f), at = s => html.indexOf(s);
    assert.ok(at('src="mine/mine-flag.js"') > 0 && at('src="mine/mine-flag.js"') < at('src="core/skins.js"'), `${f}: flag before skins.js`);
    assert.ok(at('href="core/skins.css"') < at('href="mine/mine.css"') && at('href="mine/mine.css"') < at('src="core/skin-host.js"'), `${f}: mine.css after skins.css, before the skin host`);
    assert.ok(at('src="mine/mine.js"') > at('src="core/skin-host.js"'), `${f}: behaviour after the skin host`);
  }
  // Skin packages are inserted after mine.css, so a skin can still recolour the layer's parts.
  assert.match(read('web/core/skin-host.js'), /prev \|\| document\.querySelector\('link\[href\*="mine\/mine\.css"\]'\) \|\| document\.querySelector\('link\[href\*="core\/skins\.css"\]'\)/);
});

test('the flag sets html[data-mine] unless ?mine=off', () => {
  const run = search => { const root = { dataset: {} }; const w = {}; vm.runInNewContext(read('web/mine/mine-flag.js'), { document: { documentElement: root }, location: { search }, URLSearchParams, window: w }); return [root.dataset, w.WosMine.on()]; };
  assert.deepEqual(run(''), [{ mine: '' }, true]);
  assert.deepEqual(run('?mine=off'), [{}, false]);
});

test('mine.css is release-scoped only and never names a skin', () => {
  const css = read('web/mine/mine.css');
  assert.ok(rules(css).length > 400, 'the layout moved here');
  const top = s => { const out = []; let d = 0, cur = ''; for (const ch of s) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && !d) { out.push(cur); cur = ''; } else cur += ch; } return out.concat(cur); };
  for (const sel of rules(css)) for (const part of top(sel)) assert.match(part.trim(), /^html\[data-mine\]/, part.slice(0, 90));
  assert.doesNotMatch(css, /data-skin(\^)?="/);
});

test("Miguel's skin packages are only look: none of the moved layout or behaviour stays in them", () => {
  for (const d of ['obsidian', 'landscapes']) {
    const css = read(`web/skins/${d}/skin.css`);
    for (const k of ['.ms-track', '.desk-dots.sym', '--pill-h', '.ov.ov-pill .ov-close', '.rs-barsw.rs-widget', ':is(.home-date, .home-time) { display: none', '.ch-pin-toggle', 'flex-direction: column-reverse', '.mz-dock-back'])
      assert.ok(!css.includes(k), `${d}/skin.css still carries ${k}`);
    const js = read(`web/skins/${d}/skin.js`);
    assert.match(js, /playIntro/); assert.doesNotMatch(js, /setupBehaviour|behaviour\.js/);
  }
});

test('behaviour runs on every skin as a skin-host built-in, through the skin hook API only', () => {
  const js = read('web/mine/mine.js');
  assert.match(js, /import \{ setupBehaviour \} from '\.\/behaviour\.js'/);
  assert.match(js, /window\.WosSkinHost\?\.builtin\('mine-behaviour', setupBehaviour, \{ when: 'always'/);
  assert.match(js, /window\.WosMine\?\.on\(\)/);
  const b = read('web/mine/behaviour.js').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(b, /\b(?:addEventListener|setTimeout|setInterval|requestAnimationFrame|localStorage|innerHTML|__wos)\b|\bfetch\s*\(|\bhistory\s*\./);
});

test('core gates Miguel\'s features on the release flag, never on a skin id', () => {
  for (const f of ['web/app.js', 'web/live.js', 'web/core/chats.js', 'web/core/chat-models.js', 'web/core/chat-power.js', 'web/core/resources.js']) {
    const src = read(f);
    assert.doesNotMatch(src, /\bOURS\b|OUR_SKINS|oursSkin|\bours\(\)|'obsidian-light', 'landscapes'/, f);
  }
});

// The release layer on a James skin (nebula): his model switch, Home bars and grouped devices appear there too.
function models(dataset) {
  const window = { WosAgents: { lock: () => '<svg class="ag-lock"></svg>' } };
  const ctx = vm.createContext({ window, document: { documentElement: { dataset } }, AbortSignal, localStorage: { getItem: () => null }, fetch: async () => ({}) });
  vm.runInContext(read('web/core/chat-models.js'), ctx);
  const M = window.WosModels;
  M.options = M.normalize({ provider: 'anthropic', model: 'claude-opus-5-5', providers: [
    { slug: 'anthropic', authenticated: true, models: ['claude-opus-5-5'] },
    { slug: 'openai-codex', authenticated: true, models: ['gpt-6-astra', 'gpt-6.1-sol'] },
    { slug: 'wizard-tinfoil', is_user_defined: true, authenticated: true, models: ['kimi-k3'] },
  ] });
  M.ready = true; M.tinfoil = { provider: 'tinfoil', credentialStored: true }; return M;
}
function home(dataset) {
  const ctx = { window: {}, document: { documentElement: { dataset }, addEventListener() {}, querySelectorAll: () => [], hidden: false },
    localStorage: { getItem: () => null, setItem() {} }, queueMicrotask() {}, setTimeout, clearTimeout, fetch: async () => ({ ok: false }), AbortController };
  ctx.window = ctx; ctx.window.addEventListener = () => {};
  vm.runInNewContext(read('web/core/resources.js'), ctx);
  return ctx.WosResources.home();
}
for (const skin of JAMES) {
  test(`${skin} + my release: the model switch with the private Tinfoil slot and the Home bars apply`, () => {
    const M = models({ skin, mine: '' });
    assert.equal(M.mine(), true);
    assert.match(M.popHtml({ mode: 'thread', cur: { model: 'claude-opus-5-5', provider: 'anthropic' } }).html, /class="mrow secure"/);
    assert.match(home({ skin, mine: '' }), /rs-barsw/);
    assert.doesNotMatch(home({ skin }), /rs-barsw/, 'without the flag: stock meters');
  });
}

test('Settings shortcuts for Day/Week/Month in review, Maps and Local command are hidden only with the release flag', () => {
  const css = read('web/mine/mine.css'), core = read('web/core/settings.css') + read('web/core/features.js') + read('web/core/settings.js');
  const hide = rules(css).filter(sel => /data-st-shortcut="day"/.test(sel));
  assert.equal(hide.length, 1, 'one rule hides them');
  assert.ok(hide[0].split(',').every(s => s.trim().startsWith('html[data-mine]')) || hide[0].startsWith('html[data-mine]'), 'scoped to the mine flag');
  for (const id of ['day', 'week', 'month', 'maps', 'command']) {
    assert.match(hide[0], new RegExp(`data-st-shortcut="${id}"`), id);
    assert.match(hide[0], new RegExp(`data-feature-open="${id}"`), id);
  }
  assert.match(css, /html\[data-mine\] \.st-root \[data-st-shortcut\][^{]*\{ display: none; \}|html\[data-mine\] \.st-root :is\(\[data-st-shortcut\], \[data-feature-open\]\)[^{]*\{ display: none; \}/);
  // Stock boxes keep them: core registers all five and hides none of them.
  for (const id of ['maps', 'command']) assert.match(core, new RegExp(`id: '${id}'`));
  assert.match(core, /for \(const level of \['day', 'week', 'month'\]\)/);
  assert.doesNotMatch(read('web/core/settings.css'), /data-st-shortcut="(day|maps|command)"/);
});
