import assert from 'node:assert/strict';
export default async function check(f) { await new Promise(r => setTimeout(r, 0)); assert.equal(f.list.querySelector('[data-part="model-pills"]'), null); assert.equal(f.list.querySelector('[data-slot="list-top"]')?.children.length || 0, 0); }
