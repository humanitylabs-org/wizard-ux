import assert from 'node:assert/strict';
export default async function check(f) { assert.ok(f.doc.head.children.some(n => n.href?.endsWith('interface-manual/tweak.css'))); await f.clear(); assert.equal(f.doc.head.children.length, 0); }
