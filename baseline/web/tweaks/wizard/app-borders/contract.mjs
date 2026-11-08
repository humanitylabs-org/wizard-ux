import assert from 'node:assert/strict';
export default async function check(f) {
  assert.equal(f.ctx.window.WosSkin.frame.foundation, 'framed');
  await f.clear();
  assert.equal(f.ctx.window.WosSkin.frame.foundation, 'borderless');
}
