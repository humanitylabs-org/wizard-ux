import assert from 'node:assert/strict';
export default async function check(f) { assert.ok(f.doc.head.children.some(n => n.href?.endsWith('narrow-one-app/tweak.css'))); await f.clear(); assert.equal(f.doc.head.children.length, 0); }
