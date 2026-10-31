import assert from 'node:assert/strict';
// Desktop: a two-way switch in the middle of the bar (bar-center, where the clock was); a click on the side that is not worn switches miguel/orb-shell
// (own author only), a click on the worn side does nothing. Phone: nothing.
export default async function check(f) {
  const bar = f.doc.body.querySelector('[data-slot="bar-center"]');
  if (f.doc.documentElement.dataset.shell !== 'desktop') { assert.equal(bar.children.length, 0); return; }
  const box = bar.children.find(n => n.className === 'os-switch'); assert.ok(box, 'switch in the bar');
  const [classic, orb] = box.children;
  assert.equal(classic.attrs['aria-pressed'], 'true'); assert.equal(orb.attrs['aria-pressed'], 'false');
  const asked = []; f.ctx.window.WosExperience = { toggle: async id => { asked.push(id); } };
  classic.fire('click'); assert.deepEqual(asked, [], 'the worn side does nothing');
  orb.fire('click'); await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(asked, ['miguel/orb-shell']);
  await f.clear(); assert.equal(bar.children.length, 0);
}
