import assert from 'node:assert/strict';
// A two-way switch: desktop in the middle of the bar (bar-center, where the clock was), phone at the top of Home
// (home-main, first). A click on the side that is not worn switches miguel/orb-shell (own author only), a click on the
// worn side does nothing.
export default async function check(f) {
  const desk = f.doc.documentElement.dataset.shell === 'desktop';
  const bar = f.doc.body.querySelector(desk ? '[data-slot="bar-center"]' : '[data-slot="home-main"]');
  const box = bar.children.find(n => n.className === 'os-switch'); assert.ok(box, desk ? 'switch in the bar' : 'switch on Home');
  const [classic, orb] = box.children;
  assert.equal(classic.attrs['aria-pressed'], 'true'); assert.equal(orb.attrs['aria-pressed'], 'false');
  const asked = []; f.ctx.window.WosExperience = { toggle: async id => { asked.push(id); } };
  classic.fire('click'); assert.deepEqual(asked, [], 'the worn side does nothing');
  orb.fire('click'); await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(asked, ['miguel/orb-shell']);
  await f.clear(); assert.ok(!bar.children.some(n => n.className === 'os-switch'));
}
