import assert from 'node:assert/strict';
export default async function check(f) {
  const find = n => n.className === 'bound-grab' ? n : n.children.map(find).find(Boolean);
  const grab = () => find(f.doc.body);
  const el = grab(); assert.ok(el?.parentNode?.dataset.slot === 'device-edge', 'the handle is mounted in the device-edge slot'); assert.equal(el.hidden, true, 'hidden with no bound view');
  const press = (x0, x1, type = 'pointerup', y1 = 400) => { el.fire('pointerdown', { clientX: x0, clientY: 400, pointerId: 1 }); el.fire('pointermove', { clientX: x1, clientY: y1, pointerId: 1 }); el.fire(type, { type, clientX: x1, clientY: y1, pointerId: 1 }); };
  f.setRoute({ beside: 1 });
  assert.equal(el.hidden, false); assert.ok(el.classList.contains('right') && el.classList.contains('glow'));
  press(370, 371); assert.deepEqual(f.gone.splice(0), [2], 'tap moves to the view beside');
  press(370, 250); assert.deepEqual(f.gone.splice(0), [2], 'an intentional swipe toward the middle moves too');
  press(370, 340); press(300, 390); press(370, 250, 'pointercancel'); press(370, 300, 'pointerup', 520);
  assert.deepEqual(f.gone, [], 'short, outward, cancelled (OS edge gesture) and vertical drags do nothing');
  el.fire('animationend', {}); assert.equal(el.classList.contains('glow'), false, 'the glow stops after its runs');
  f.setRoute({ beside: -1 });
  assert.ok(el.classList.contains('left') && !el.classList.contains('right') && el.classList.contains('glow'));
  press(10, 11); assert.deepEqual(f.gone.splice(0), [0], 'on the view, the left edge goes back to the thread');
  f.setRoute({ beside: 0 }); assert.equal(el.hidden, true);
  await f.clear(); assert.equal(grab(), undefined, 'teardown removes the handle');
}
