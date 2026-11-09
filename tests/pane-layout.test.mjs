import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const code = fs.readFileSync(new URL('../web/core/pane-layout.js', import.meta.url), 'utf8');
const load = () => { const c = vm.createContext({}); vm.runInContext(code, c); return c.WizCore.panes; };
const plain = o => JSON.parse(JSON.stringify(o));
const p = load(), viewport = { width: 1440, height: 900 }, env = { appOn: true, chatOn: true, appWidth: 576 };
test('presets and free fractions clamp to Classic range', () => {
  for (const [s, f] of Object.entries({ '1/2': .5, '1/3': 1/3, '2/3': 2/3 })) assert.equal(p.normalize({ ratio: s }).ratio, f);
  assert.equal(p.normalize({ ratio: -1 }).ratio, .25); assert.equal(p.normalize({ ratio: 3 }).ratio, .75);
  assert.equal(p.normalize({ ratio: 'bad' }).ratio, .5);
  assert.equal(p.splitOf({ split: .1 }, 2), .5); assert.equal(p.splitOf({}, 3), .56);
});
test('default keeps the old AI apps app formula; the chat takes the room the app leaves (issue 1233)', () => {
  for (const W of [800, 1280, 1440, 1920, 2560]) for (const side of [52, 288]) for (const tabs of [52, 200]) for (const chatOn of [false, true]) {
    const g = p.geometry({}, { width: W, height: 900 }, { ...env, sideWidth: side, dockWidth: tabs, chatOn });
    assert.equal(g.sidebar.x, 0); assert.equal(g.sidebar.width, side); assert.equal(g.dock.x, W-tabs);
    const content = W-side-tabs, cmin = chatOn ? Math.max(360, Math.min(480, W*.3)) : 0;
    const aw = Math.min(576, Math.max(0, content-cmin));
    assert.equal(g.panes.app.width, aw);
    assert.equal(g.panes.chats.width, chatOn ? content-aw : 0);
    // no empty canvas between the chat column and the app panel
    if (chatOn) assert.equal(g.panes.chats.x + g.panes.chats.width, g.panes.app.x);
  }
  // a chat with no app open fills the main area (its messages centre in a 768px column there)
  const alone = p.geometry({}, viewport, { chatOn: true });
  assert.equal(alone.panes.chats.x, alone.content.x); assert.equal(alone.panes.chats.width, alone.content.width);
  // the chat never gets narrower than its old column beside a wide app
  const wideApp = p.geometry({}, { width: 2560, height: 900 }, { appOn: true, chatOn: true, appWidth: 5000 });
  assert.equal(wideApp.panes.chats.width, 480);
});
test('ratio, side swap, slot order and three weighted panes do not overlap', () => {
  for (const ratio of ['1/2','1/3','2/3']) for (const side of ['start','end']) {
    const g = p.geometry({ ratio, side }, viewport, env), c = g.panes.chats, a = g.panes.app;
    assert.equal(c.width, Math.round(g.content.width*p.PRESETS[ratio]));
    assert.ok(side === 'start' ? c.x+c.width <= a.x : a.x+a.width <= c.x);
    assert.equal(g.sidebar.x, side === 'start' ? 0 : 952);
  }
  const g = p.geometry({ slots: ['app2','app','chats'], weights: { app: 2, app2: 1, chats: 1 } }, viewport, {...env, app2On:true});
  assert.deepEqual(Object.values(plain(g.panes)).map(b=>b.width), [238,476,238]);
  assert.equal(g.panes.app2.x, 288); assert.equal(g.panes.app.x,526);
});
test('omitted slots have empty geometry, including the documented two-app arrangement', () => {
  const g = p.geometry({ slots: ['app', 'app2'], weights: { app: 2, app2: 1 } }, viewport, { ...env, app2On: true });
  assert.equal(g.panes.chats.width, 0); assert.equal(g.panes.chats.height, 0);
  assert.equal(g.panes.app.x + g.panes.app.width, g.panes.app2.x);
  const chatOnly = p.geometry({ slots: ['chats'], ratio: '1/2' }, viewport, env);
  assert.equal(chatOnly.panes.app.width, 0); assert.equal(chatOnly.panes.chats.width, chatOnly.content.width);
});
test('all dock edges and insets shrink the available rectangle', () => {
  for (const edge of ['start','end','top','bottom']) {
    const g=p.geometry({ dock:{edge,insets:{start:10,end:20,top:30,bottom:40}} },viewport,env);
    assert.ok(g.dock.x>=10 && g.dock.y>=30); assert.ok(g.dock.x+g.dock.width<=1420 && g.dock.y+g.dock.height<=860);
    assert.ok(edge==='start' ? g.content.x>=g.dock.x+g.dock.width : edge==='end' ? g.content.x+g.content.width<=g.dock.x : edge==='top' ? g.content.y>=g.dock.y+g.dock.height : g.content.y+g.content.height<=g.dock.y);
  }
});
test('device-local persistence, patches, subscriptions, malformed and denied storage', () => {
  const map=new Map(), storage={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v)};
  const a=p.create(storage), b=p.create({getItem:()=>null}); let calls=0; const off=a.subscribe(()=>calls++);
  a.set({ratio:'1/3',dock:{edge:'start'}}); a.set({side:'end'}); off(); a.set({app2:'notes'});
  assert.equal(calls,2); assert.equal(p.create(storage).get().dock.edge,'start'); assert.equal(p.create(storage).get().ratio,1/3);
  assert.equal(b.get().ratio,null); const copy=a.get(); copy.slots.pop(); assert.equal(a.get().slots.length,2);
  assert.doesNotThrow(()=>p.create({getItem(){throw Error('denied')},setItem(){throw Error('denied')}}).set({ratio:.7}));
  assert.equal(p.create({getItem:()=>'{broken'}).get().ratio,null);
});
test('Classic weighted columns retain reservation and rounding', () => {
  assert.deepEqual(plain(p.columns(1000,[.6,0],8)),[{x:8,width:586},{x:602,width:390}]);
  assert.deepEqual(plain(p.columns(1000,[2,1],8)),[{x:8,width:651},{x:667,width:325}]);
});
