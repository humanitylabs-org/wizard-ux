import assert from 'node:assert/strict';
export default async function check(f) { await new Promise(r => setTimeout(r, 0)); const pills = f.list.querySelector('[data-part="model-pills"]'); assert.ok(pills); assert.equal(pills.parentNode.dataset.slot, 'list-top'); assert.equal(pills.children[0].textContent, 'Test model'); await pills.children[0].onclick(); }
