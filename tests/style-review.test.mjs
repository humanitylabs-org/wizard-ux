import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const read = p => readFileSync(new URL('../'+p, import.meta.url), 'utf8');
test('style review honors script-src self and preserves shared runtime assets', () => {
  const html=read('web/style-review/demo.html');
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), 'No inline scripts under live CSP');
  assert.match(html, /<script src="demo.js"><\/script>/);
  assert.match(read('web/style-review/demo.js'), /window\.__wizardCloseOverlay=/);
  const original=JSON.parse(read('docs/provenance/appearance-review.json'));
  for (const name of ['tokens.css','ui.css','boot.js','appearance-client.js']) {
    assert.equal(createHash('sha256').update(read('web/style-review/'+name)).digest('hex'), original.files[name], name+' remains byte-identical');
  }
});
