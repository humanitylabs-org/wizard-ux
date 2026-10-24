import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../web/core/resources.js', import.meta.url), 'utf8');
const ds = (skin, mine) => (mine ?? ['obsidian', 'obsidian-light', 'landscapes'].includes(skin)) ? { skin, mine: '' } : { skin };
function render(skin, mine) {
  const ctx = { window: {}, document: { documentElement: { dataset: ds(skin, mine) }, addEventListener() {}, querySelectorAll: () => [], hidden: false },
    localStorage: { getItem: () => null, setItem() {} }, queueMicrotask() {}, setTimeout, clearTimeout, fetch: async () => ({ ok: false }), AbortController };
  ctx.window = ctx; ctx.window.addEventListener = () => {};
  vm.runInNewContext(src, ctx);
  return ctx.WosResources.home();
}

test('home dial styles live only in the release layer (skins may tint them)', () => {
  assert.match(fs.readFileSync(new URL('../web/mine/mine.css', import.meta.url), 'utf8'), /html\[data-mine\] \.rs-dialed \{/);
  for (const f of ['../web/styles.css', '../web/core/resources.css', '../web/core/skins.css']) assert.doesNotMatch(fs.readFileSync(new URL(f, import.meta.url), 'utf8'), /\.rs-dialed/);
});

test('my release: bare gear, round Ready/Working, see-through dock', () => {
  for (const [f, P] of [['mine/mine.css', 'html[data-mine]']]) {
    const css = fs.readFileSync(new URL(`../web/${f}`, import.meta.url), 'utf8');
    assert.ok(css.includes(`${P} .home-tools .gear, ${P} .gear { background: none; border: 0;`), `${f}: gear has no chip`);
    assert.match(css, /\.now-card\.wz-home-widget \{[^}]*border-radius: 50%/, `${f}: round tiles`);
  }
});

test('Ready / Working show glyph + one dot per chat only with the release layer (any skin)', () => {
  const app = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  const body = app.slice(app.indexOf('function homeDots('), app.indexOf('function renderHome('));
  const run = (skin, mine = true) => new Function('document', `const myRelease = () => document.documentElement.dataset.mine != null; ${body}; return homeDots;`)({ documentElement: { dataset: mine ? { skin, mine: '' } : { skin } } });
  for (const s of ['obsidian', 'obsidian-light', 'landscapes', 'nebula', 'grove']) {
    const h = run(s)('working', 3); assert.equal((h.match(/<i /g) || []).length, 3, s);
    assert.match(run(s)('ready', 20), /<em>\+<\/em>/, `${s}: capped with +`);
  }
  for (const s of ['obsidian', 'landscapes', 'nebula', 'grove', 'tide', 'ember', 'signal']) assert.equal(run(s, false)('ready', 3), '', s);
});

test('devices sheet draws capacity bars sized by real capacity', () => {
  const injected = src.replace("devices:null,devicesAt:0", "devices:{devices:[{id:'this',kind:'this',group:'agent',name:'Big',status:'online',cpus:8,cpu:10,memory:50,memoryTotalGB:32,disks:[{label:'System disk',sizeGB:1000,freeGB:500,pct:50}]},{id:'s',kind:'ssh',group:'agent',name:'Small',status:'online',cpus:4,cpu:95,memory:20,memoryTotalGB:8,disks:[{label:'System disk',sizeGB:250,freeGB:200,pct:20}]}],network:{available:true,peers:[]}},devicesAt:0");
  assert.notEqual(injected, src, 'devices state literal found');
  const ctx = { window: {}, document: { documentElement: { dataset: { skin: 'obsidian', mine: '' } }, addEventListener() {}, querySelectorAll: () => [], hidden: false },
    localStorage: { getItem: () => null, setItem() {} }, queueMicrotask() {}, setTimeout, clearTimeout, fetch: async () => ({ ok: false }), AbortController };
  ctx.window = ctx; ctx.window.addEventListener = () => {};
  vm.runInNewContext(injected.replace('window.WosResources={', 'globalThis.__dv=groupedDevicesHtml;window.WosResources={'), ctx);
  const h = ctx.__dv();
  assert.match(h, /data-cap="mem"[\s\S]*style="flex:32 1 0"[\s\S]*style="flex:8 1 0"/);
  assert.match(h, /22 GB free of 40 GB/); assert.match(h, /700 GB free of 1.3 TB/);
  assert.match(h, /data-cap="cpu"[\s\S]*rs-cap-seg rs-empty rs-crit/);
});

function homeWith(skin, state, mine) {
  let s = src;
  for (const [a, b] of state) { assert.ok(s.includes(a), a); s = s.replace(a, b); }
  const ctx = { window: {}, document: { documentElement: { dataset: ds(skin, mine) }, addEventListener() {}, querySelectorAll: () => [], hidden: false },
    localStorage: { getItem: () => null, setItem() {} }, queueMicrotask() {}, setTimeout, clearTimeout, fetch: async () => ({ ok: false }), AbortController };
  ctx.window = ctx; ctx.window.addEventListener = () => {};
  vm.runInNewContext(s, ctx); return ctx.WosResources.home();
}
const STATE = [["server:null,serverAt:0", "server:{cpu:30,memory:50,disk:93,diskSize:200},serverAt:0"],
  ["ai:null,aiAt:0", "ai:{providers:[{id:'claude:x',provider:'claude',providerName:'Claude',status:'ok',limits:[{id:'w',label:'Weekly',remainingPercent:58}]},{id:'tinfoil',provider:'tinfoil',providerName:'Tinfoil',status:'ok',limits:[],paid:{type:'credits',enabled:true,currency:'USD',exponent:2,balanceMinor:450,limitMinor:2000}}]},aiAt:0"],
  ["devices:null,devicesAt:0", "devices:{devices:[{id:'this',kind:'this',group:'agent',name:'Box',status:'online',cpus:4,cpu:30,memory:50,memoryTotalGB:16,disks:[{sizeGB:200,freeGB:14,pct:93}]},{id:'s',kind:'ssh',group:'agent',name:'Laptop',status:'online',cpus:4,cpu:5,memory:40,memoryTotalGB:8,disks:[{sizeGB:475,freeGB:400,pct:15}]}],network:{available:true,peers:[]}},devicesAt:0"]];

test('my release shows Home resources as bars of what is left; without it every skin keeps the meters', () => {
  for (const s of ['obsidian', 'obsidian-light', 'landscapes']) {
    const h = homeWith(s, STATE);
    assert.match(h, /rs-barsw/, s); assert.doesNotMatch(h, /rs-dial|rs-bar"|rs-warning-note/, s);
    assert.ok(h.indexOf('aria-label="AI resources used this week"') < h.indexOf('aria-label="Compute resources used"'), `${s}: AI first`);
  }
  for (const s of ['obsidian', 'landscapes', 'nebula', 'grove', 'tide', 'ember', 'signal']) { const h = homeWith(s, STATE, false); assert.doesNotMatch(h, /rs-barsw/, s); assert.match(h, /rs-zone/, s); }
});

test('compute bars split by machine capacity; AI and credit show what is left', () => {
  const h = homeWith('landscapes', STATE);
  assert.match(h, /aria-label="Claude 42% used"/); assert.match(h, /aria-label="Tinfoil \$4\.50 left"/);
  assert.match(h, /data-k="hw:mem"[\s\S]*?flex:16 1 0[\s\S]*?flex:8 1 0/);
  assert.match(h, /data-k="hw:disk"[\s\S]*?rs-bs rs-crit rs-d0" style="flex:200 1 0"/);
  assert.match(h, /aria-label="Memory 11\/24 GB used"/);
  assert.match(h, /data-w="93"/, 'disk fill = 93% used');
});

test('Home separates AI and Computers, colours compute segments by machine with a legend', () => {
  const h = homeWith('obsidian', STATE);
  assert.match(h, /rs-bg rs-bg-ai[\s\S]*<b>AI resources<\/b>[\s\S]*rs-bg rs-bg-hw[\s\S]*<b>Compute resources<\/b>/);
  assert.match(h, /class="rs-lg"><span class="rs-d0"><i><\/i>Box<\/span><span class="rs-d1"><i><\/i>Laptop/);
  assert.match(h, /data-k="hw:mem"[\s\S]*?rs-bs rs-d0[\s\S]*?rs-bs rs-d1/);
});
