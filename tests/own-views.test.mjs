// node --test tests/own-views.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../web/core/own-views.js', import.meta.url), 'utf8');
const module = { exports:{} }; vm.runInNewContext(source, { module });
const { own, frameUrl, marker } = module.exports;
const a = { id:'habits', name:'Habits', source:'apps.json', originalUrl:'/habits/', url:'/wizard/views/habits/', view:{ mode:'own', url:'/wizard/views/habits/' } };
test('own version supersedes original and persisted original URLs, but preserves navigation inside own version', () => {
  assert.equal(own(a), true);
  assert.equal(frameUrl(a), a.view.url);
  assert.equal(frameUrl(a, '/habits/old'), a.view.url);
  assert.equal(frameUrl(a, '/wizard/views/habits/nested'), '/wizard/views/habits/nested');
});
test('reverted and overlay screens use original and remove persisted own-view URLs', () => {
  for (const mode of ['original', 'overlay']) {
    const original = { ...a, url:'/habits/', view:{ mode, url:'/habits/' } };
    assert.equal(frameUrl(original), '/habits/');
    assert.equal(frameUrl(original, '/wizard/views/habits/'), '/habits/');
    assert.equal(marker(original), '');
  }
});
test('only the exact installed view path can show Your version, never a launcher hint or foreign path', () => {
  for (const change of [{ source:'launcher.json' }, { view:{ mode:'own', url:'https://other.test/' } }, { view:{ mode:'own', url:'/wizard/views/another/' } }]) assert.equal(own({ ...a, ...change }), false);
  assert.match(marker(a), /Your version/);
  assert.match(marker(a), /data-own-original="habits"/);
});
test('both renderers use the same frame and marker helpers without a new history/Back stack', () => {
  for (const path of ['web/app.js', 'web/desktop/desktop.js']) {
    const text = readFileSync(new URL('../' + path, import.meta.url), 'utf8');
    assert.match(text, /WosOwnViews\?\.frameUrl/); assert.match(text, /WosOwnViews\?\.marker/);
    assert.match(text, /data-own-app=/);
  }
  assert.doesNotMatch(source, /history\.(?:pushState|replaceState|back)/);
  assert.match(source, /!e\.isTrusted/);
  assert.match(source, /e\.view !== window/);
  assert.match(source, /check\.json\(\)\)\.active !== false/);
});
