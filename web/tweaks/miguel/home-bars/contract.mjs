import assert from 'node:assert/strict';
export default async function check(f) { assert.ok(f.refreshes > 0); assert.ok(f.doc.documentElement.dataset.tweaks.includes('miguel/home-bars')); await f.clear(); assert.equal(f.doc.documentElement.dataset.tweaks, ''); }
