import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
test('News uses its shipped folded-newspaper identity, including stale package metadata', () => {
  const window = { WizCore: { appLogo: () => '/wizard-os-home/store-data/app-logo/news?v=0123456789abcdef' } };
  vm.runInNewContext(fs.readFileSync(new URL('../web/core/sigils.js', import.meta.url), 'utf8'), { window, encodeURIComponent });
  const S = window.WizSigil;
  for (const record of [{id:'news', name:'News'}, {id:'news', icon:'/news/icon.svg'}]) {
    assert.equal(S.of(record).glyph, 'news');
    assert.equal(S.of(record).logo, undefined);
    assert.match(S.html(record), /class="sgi sg-news"/);
  }
  assert.match(fs.readFileSync(new URL('../web/core/sigils.css', import.meta.url), 'utf8'), /\.sg-news\{/);
});
