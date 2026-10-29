import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
const root = new URL('../../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
const catalog = JSON.parse(read('web/tweaks/catalog.json'));
test('tweaks use declared namespaces and stable slot/part selectors; inherited banned APIs remain banned', () => {
  const banned = ['addEventListener','setTimeout','setInterval','requestAnimationFrame','fetch(', 'XMLHttpRequest','__wos','__wux','localStorage','sessionStorage','innerHTML','outerHTML','history.','document.cookie','eval(','new Function','import(','WebSocket'];
  for (const id of catalog.tweaks) {
    const m = JSON.parse(read(`web/tweaks/${id}/manifest.json`)); assert.equal(m.id, id); assert.equal(m.author, id.split('/')[0]);
    const source = read(`web/tweaks/${id}/tweak.js`).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const term of banned) assert.ok(!source.includes(term), `${id}: banned ${term}`);
    for (const selector of source.matchAll(/\.(?:querySelector(?:All)?|closest|matches)\(([^)]*)\)/g)) assert.match(selector[1], /^['"]\[data-(?:slot|part)[=\]]/, `${id}: only literal [data-slot] / [data-part] selectors`);
    assert.match(source, /export default function setup\(api\)/);
    assert.ok(read(`web/tweaks/${id}/contract.mjs`).includes('export default'), `${id}: missing shipped contract`);
  }
});
