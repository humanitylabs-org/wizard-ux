// Oscar for Miguel: https://github.com/humanitylabs-org/wizard-ux/pull/962#discussion_r4466692856
// Full production host at boot; imports are logged/stubbed, not browser/pixel proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fixture, read } from './fixtures/tweaks.mjs';
const hostSource = process.env.QA_SETTINGS_SOURCE ? readFileSync(process.env.QA_SETTINGS_SOURCE + '/web/core/skin-host.js', 'utf8') : read('web/core/skin-host.js');
const boot = options => fixture({ hostSource, ...options });
const cases = {
  stored: { initialStorage: { 'wos.layout': 'ai-apps' } },
  query: { query: '?layout=ai-apps' },
  'negative-control': {},
};
function classic(f, label) {
  assert.equal(f.boot.layout, 'classic', label + ': synchronously classic before attach/catalog');
  assert.equal(f.boot.dataset, undefined, label + ': never painted unsupported data-layout');
  assert.equal(f.host.layout, 'classic');
  assert.ok(!f.boot.css.some(h => h?.includes('/layouts/ai-apps/')), label + ': no initial CSS');
  assert.ok(!f.doc.head.children.some(n => n.href?.includes('/layouts/ai-apps/')), label + ': no later CSS');
  assert.ok(!f.imports.some(h => h.includes('/layouts/ai-apps/')), label + ': no layout.js import');
  assert.ok(!f.host.state.requested.some(h => h.includes('/layouts/ai-apps/')), label + ': no asset request');
}
for (const [name, options] of Object.entries(cases)) for (const network of ['catalog-failed', 'catalog-deferred', 'host-timeout-slow-path']) {
  test(`phone ${name} remains classic through ${network}, before any successful catalog`, async () => {
    const f = boot(options); classic(f, name);
    if (network === 'host-timeout-slow-path') {
      let calls = 0; f.ctx.fetch = async () => { calls++; throw Error('timed out'); };
      assert.equal(await f.host.loadTweaks(['miguel/apps-home'], f.slots), true);
      assert.equal(calls, 2, 'original and extended retry hit the actual slow=true path');
      assert.ok(f.toasts.some(t => t.includes('timed out')));
    } else {
      let calls = 0, release;
      const response = new Promise(resolve => { release = resolve; });
      f.ctx.AbortSignal = AbortSignal; f.ctx.window.addEventListener = () => {};
      f.ctx.setTimeout = () => 0; // capture retry scheduling without a real five-second background retry
      f.ctx.fetch = async url => {
        assert.match(String(url), /tweaks\/catalog\.json/); calls++;
        return network === 'catalog-deferred' ? response : { ok: false, status: 503 };
      };
      vm.runInNewContext(read('web/core/experience.js'), f.ctx);
      const refresh = f.ctx.window.WosExperience.refresh();
      if (network === 'catalog-deferred') {
        assert.equal(f.ctx.window.WosExperience.state.busy, true);
        classic(f, name + ' while catalog is unresolved');
        release({ ok: false, status: 503 });
      }
      await refresh; assert.ok(calls >= 1); assert.match(f.ctx.window.WosExperience.state.error, /503/);
    }
    classic(f, name + ' after failure/slow path');
  });
}
test('unsupported cache cleanup is narrow and repeated phone loads stay classic', () => {
  const untouched = { 'wos.skin': 'nebula', 'unrelated.owner': 'keep', 'wos.skin-tweaks.v1': JSON.stringify({ version: 1, off: {}, mix: { 'miguel/ai-apps': true }, views: { desktop: 'miguel/ai-apps', phone: 'miguel/orb-shell' } }) };
  const first = boot({ initialStorage: { ...untouched, 'wos.layout': 'ai-apps' } }); classic(first, 'first load');
  assert.deepEqual(Object.fromEntries(first.lsMap), untouched, 'only unsupported materialized layout hint is removed');
  const second = boot({ initialStorage: Object.fromEntries(first.lsMap) }); classic(second, 'second load');
  assert.deepEqual(Object.fromEntries(second.lsMap), untouched);
  for (const query of ['?layout=ai-apps', '?layout=ai-apps']) {
    const again = boot({ query, initialStorage: untouched }); classic(again, 'repeated query');
    assert.deepEqual(Object.fromEntries(again.lsMap), untouched);
  }
});
for (const shell of ['phone', 'desktop']) for (const id of ['orb', 'apps', ...(shell === 'desktop' ? ['ai-apps'] : [])]) for (const input of ['stored', 'query']) {
  test(`${shell} supported ${id} ${input} still paints and requests its layout at boot`, () => {
    const f = boot({ shell, ...(input === 'stored' ? { initialStorage: { 'wos.layout': id } } : { query: '?layout=' + id }) });
    assert.equal(f.boot.layout, id); assert.equal(f.boot.dataset, id);
    // each shell requests only its own entry (core/skin-host.js files: phone orb -> phone.js, no sheet; desktop AI apps ->
    // desktop-boot.css + desktop.js); the rest keep layout.css / layout.js
    const [css, js] = { 'phone:orb': ['', 'phone.js'], 'desktop:ai-apps': ['desktop-boot.css', 'desktop.js'] }[shell + ':' + id] || ['layout.css', 'layout.js'];
    if (css) assert.ok(f.boot.css.some(h => h.includes('/layouts/' + id + '/' + css)));
    else assert.ok(!f.boot.css.some(h => h.includes('/layouts/' + id + '/')), 'no blocking sheet for a layout that brings its own');
    assert.ok(f.imports.some(h => h.includes('/layouts/' + id + '/' + js)));
    assert.equal(f.imports.filter(h => h.includes('/layouts/')).length, 1, 'one entry import, never the other shell\'s');
    assert.equal(f.lsMap.get('wos.layout'), id);
  });
}
test('unsupported query preserves supported phone cache and unknown cached values are not swept', () => {
  for (const id of ['orb', 'apps', 'future-layout']) {
    const f = boot({ initialStorage: { 'wos.layout': id }, query: '?layout=ai-apps' });
    assert.equal(f.host.layout, id === 'future-layout' ? 'classic' : id); assert.equal(f.lsMap.get('wos.layout'), id);
  }
});
test('host shell inventory agrees with the AI apps manifest; Settings uses manifest descriptions', () => {
  const f = boot(), item = f.host.layouts.find(l => l.id === 'ai-apps'), manifest = JSON.parse(read('web/tweaks/miguel/ai-apps/manifest.json'));
  assert.deepEqual(Array.from(item.shells || []), manifest.shells); assert.match(item.desc, /desktop only/); assert.doesNotMatch(item.desc, /\(phone\)/);
  const settings = read('web/core/settings.js'), experience = read('web/core/experience.js');
  assert.doesNotMatch(settings, /\.layouts\b/);
  assert.match(experience, /description: m.description \|\| ''/); assert.match(settings, /esc\(t.description\)/);
  assert.match(manifest.description, /desktop/);
});
