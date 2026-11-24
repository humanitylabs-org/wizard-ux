import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { createDocument } from './fixtures/mini-dom.mjs';
import { cascade } from './fixtures/mini-css.mjs';
test('News uses its shipped folded-newspaper identity, including stale package metadata', () => {
  const window = { WizCore: { appLogo: () => '/wizard-os-home/store-data/app-logo/news?v=0123456789abcdef' } };
  vm.runInNewContext(fs.readFileSync(new URL('../web/core/sigils.js', import.meta.url), 'utf8'), { window, encodeURIComponent });
  const S = window.WizSigil;
  for (const record of [{id:'news', name:'News'}, {id:'news', icon:'/news/icon.svg'}]) {
    assert.equal(S.of(record).glyph, 'news');
    assert.equal(S.of(record).logo, undefined);
    assert.match(S.html(record), /class="sgi sg-news"/);
  }
  // the mark it renders gets News' own glyph from the real sigils.css (not another app's, not none)
  const css = fs.readFileSync(new URL('../web/core/sigils.css', import.meta.url), 'utf8'), doc = createDocument();
  doc.body.innerHTML = S.html({ id: 'news', name: 'News' }) + S.html({ id: 'notes', name: 'Notes' });
  const [news, other] = [...doc.body.querySelectorAll('.sgi')];
  const glyph = el => cascade(el, css)['--sg']?.value || '';
  assert.match(glyph(news), /^url\('data:image\/svg\+xml/, 'News draws its own glyph');
  assert.notEqual(glyph(news), glyph(other), 'not another app\'s');
});
