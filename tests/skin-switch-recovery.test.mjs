import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
// Real shared experience reconciler, no network, owner data or agent runs.
function fixture() {
  const storage = new Map(), calls = [], listeners = {};
  let fail = '', held, release, active = [];
  const window = {
    WosSkin: { current: 'nebula', familyOf: id => id === 'obsidian-light' ? 'mizel' : 'wizard', families: [{ id: 'wizard', tweaks: 'wizard' }, { id: 'mizel', tweaks: 'miguel' }] },
    WosSkinHost: { layout: 'classic', personalState: { ready: false }, get tweakState() { return active; }, loadTweaks: async ids => { active = ids; } },
    addEventListener(name, fn) { (listeners[name] ||= []).push(fn); }, dispatchEvent() {},
  };
  vm.runInNewContext(read('web/core/experience.js'), { window, Event, URL, AbortSignal,
    document: { baseURI: 'https://wizard.test/wizard-os-home/', addEventListener() {} },
    setTimeout() {}, localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    fetch: async url => {
      calls.push(url.pathname);
      if (held) await held;
      if (fail && url.pathname.includes(fail)) throw new DOMException('signal timed out', 'TimeoutError');
      return { ok: true, json: async () => JSON.parse(read('web/' + url.pathname.split('/wizard-os-home/')[1])) };
    },
  });
  return { E: window.WosExperience, window, calls, fail: s => { fail = s; }, hold: () => { held = new Promise(r => { release = () => { held = null; r(); }; }); }, release: () => release(), active: () => [...active] };
}
test('a manifest timeout after owner assignment cannot poison later same-family colour picks', async () => {
  const f = fixture(); f.fail('/manifest.json'); await f.E.refresh();
  assert.equal(f.E.state.error, 'signal timed out');
  f.fail(''); f.window.WosSkin.current = 'grove'; await f.E.chooseSkin();
  assert.equal(f.E.state.error, '', 'a fresh colour tap retries the failed reconcile, not the stale timeout');
  assert.ok(f.active().includes('wizard/unified-inbox'));
  assert.equal(f.E.state.busy, false);
});
