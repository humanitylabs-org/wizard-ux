// Bottom app bar on desktop (wizard-ux issue 1692, switch wizard/desktop-bottom-bar, off by default): the AI apps
// desktop keeps the narrower window's one-app layout (the Apps column as the app bar along the bottom, one thing in
// front) at every window width while the switch is on. Runs the real AI apps desktop view
// (tests/fixtures/ai-apps-world.mjs). Browser proof: tests/qa-desktop-bottom-bar.cjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { El, deskWorld, layout } from './fixtures/ai-apps-world.mjs';

const ID = 'wizard/desktop-bottom-bar';

// The real AI apps desktop view at `width` px; `tweaks` is the root's data-tweaks.
async function desk({ tweaks = '', width = 1440 } = {}) {
  const had = globalThis.innerWidth; globalThis.innerWidth = width;
  const d = deskWorld(), { w } = d;
  const stage = new El('div'); stage.id = 'stage'; const chatDesk = new El('div'); chatDesk.className = 'wsp'; const dchats = new El('div'); dchats.className = 'dchats';
  chatDesk.append(dchats); stage.append(chatDesk); w.html.children[0].append(stage);
  w.html.setAttribute('data-shell', 'desktop'); w.html.setAttribute('data-layout', 'ai-apps');
  if (tweaks) w.html.setAttribute('data-tweaks', tweaks);
  const heard = {}, hadAdd = globalThis.addEventListener;
  globalThis.addEventListener = (t, fn) => { (heard[t] ||= []).push(fn); };
  try { (await layout()).default(w.api); } finally { if (hadAdd) globalThis.addEventListener = hadAdd; else delete globalThis.addEventListener; }
  const fire = t => { for (const fn of heard[t] || []) fn(new Event(t)); };
  const restore = () => { if (had === undefined) delete globalThis.innerWidth; else globalThis.innerWidth = had; };
  return { w, fire, restore, ds: () => ({ one: w.html.dataset.aadOne, tabs: w.html.dataset.aadTabs, edge: w.html.dataset.aadDockEdge }) };
}

test('switch off: from 1100 px the side panels as today; below 1100 px the app bar as today', async () => {
  for (const width of [1100, 1440, 1920]) {
    const d = await desk({ width });
    try {
      assert.equal(d.ds().one, undefined, width + ': no one-app layout');
      assert.notEqual(d.ds().tabs, 'bar', width + ': the Apps column');
      assert.equal(d.ds().edge, 'end', width + ': at the right edge');
    } finally { d.restore(); }
  }
  const n = await desk({ width: 900 });
  try { assert.equal(n.ds().tabs, 'bar'); assert.equal(n.ds().edge, 'bottom'); assert.equal(n.ds().one, 'chats'); } finally { n.restore(); }
});

test('switch on: the app bar along the bottom and one thing in front at every width', async () => {
  for (const width of [900, 1100, 1440, 1920, 2560]) {
    const d = await desk({ tweaks: ID, width });
    try {
      assert.equal(d.ds().tabs, 'bar', width + ': the Apps column is the app bar');
      assert.equal(d.ds().edge, 'bottom', width + ': along the bottom');
      assert.equal(d.ds().one, 'chats', width + ': Chats in front');
      assert.equal(d.w.html.dataset.aadSide, 'open', width + ': Chats keeps its list beside the chat');
      assert.ok(d.w.q('.aad-vt .aad-vchats'), width + ': Chats first in the bar');
    } finally { d.restore(); }
  }
});

test('flipping the switch lays the window out again at once, both ways', async () => {
  const d = await desk({ width: 1440 });
  try {
    assert.notEqual(d.ds().tabs, 'bar');
    d.w.html.setAttribute('data-tweaks', ID); d.fire('wos:experience');
    assert.equal(d.ds().tabs, 'bar', 'on: the app bar'); assert.equal(d.ds().one, 'chats'); assert.equal(d.ds().edge, 'bottom');
    d.w.html.setAttribute('data-tweaks', ''); d.fire('wos:experience');
    assert.notEqual(d.ds().tabs, 'bar', 'off: the Apps column again'); assert.equal(d.ds().one, undefined); assert.equal(d.ds().edge, 'end');
  } finally { d.restore(); }
});
