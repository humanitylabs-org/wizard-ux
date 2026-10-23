import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../web/core/resources.js', import.meta.url), 'utf8');
function render(skin) {
  const ctx = { window: {}, document: { documentElement: { dataset: { skin } }, addEventListener() {}, querySelectorAll: () => [], hidden: false },
    localStorage: { getItem: () => null, setItem() {} }, queueMicrotask() {}, setTimeout, clearTimeout, fetch: async () => ({ ok: false }), AbortController };
  ctx.window = ctx; ctx.window.addEventListener = () => {};
  vm.runInNewContext(src, ctx);
  return ctx.WosResources.home();
}

test('Miguel skins get the compact dial strip, James skins keep the meters', () => {
  for (const s of ['obsidian', 'obsidian-light', 'landscapes']) {
    const h = render(s);
    assert.match(h, /rs-dialed/, s); assert.doesNotMatch(h, /rs-bar|rs-warning-note|rs-health-alert/, s);
  }
  for (const s of ['nebula', 'grove', 'tide', 'ember', 'signal']) {
    const h = render(s);
    assert.doesNotMatch(h, /rs-dialed/, s); assert.match(h, /rs-zone/, s);
  }
});

test('home dial styles live only in our skin packages', () => {
  for (const f of ['obsidian', 'landscapes']) assert.match(fs.readFileSync(new URL(`../web/skins/${f}/skin.css`, import.meta.url), 'utf8'), /\.rs-dialed/);
  for (const f of ['../web/styles.css', '../web/core/resources.css', '../web/core/skins.css']) assert.doesNotMatch(fs.readFileSync(new URL(f, import.meta.url), 'utf8'), /\.rs-dialed/);
});

test('Miguel skins draw speedometer gauges that start at zero and sit at the top on phone', () => {
  for (const s of ['obsidian', 'obsidian-light', 'landscapes']) {
    const h = render(s);
    assert.match(h, /class="rs-ndl"/, s); assert.match(h, /class="rs-tick rs-major"/, s);
    assert.match(h, /--a:rotate\(-120\.0deg\)/, `${s}: needle starts at zero`);
  }
  for (const f of ['obsidian', 'landscapes']) {
    const css = fs.readFileSync(new URL(`../web/skins/${f}/skin.css`, import.meta.url), 'utf8');
    assert.match(css, /\[data-shell="phone"\] \.home \[data-home-resources\] \{ order: -1;/, f);
    assert.match(css, /\[data-home-resources\] \.rs-dialed\.rs-widget\.wz-home-widget \{ background: none; border: 0;/, `${f}: no panel`);
  }
});

test('Miguel skins: bare gear, round Ready/Working, see-through dock', () => {
  for (const [f, P] of [['obsidian', 'html[data-skin^="obsidian"]'], ['landscapes', 'html[data-skin="landscapes"]']]) {
    const css = fs.readFileSync(new URL(`../web/skins/${f}/skin.css`, import.meta.url), 'utf8');
    assert.ok(css.includes(`${P} .home-tools .gear, ${P} .gear { background: none; border: 0;`), `${f}: gear has no chip`);
    assert.match(css, /\.now-card\.wz-home-widget \{[^}]*border-radius: 50%/, `${f}: round tiles`);
  }
});

test('Ready / Working show glyph + one dot per chat only on Miguel skins', () => {
  const app = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  const body = app.slice(app.indexOf('function homeDots('), app.indexOf('function renderHome('));
  const run = skin => new Function('document', `${body}; return homeDots;`)({ documentElement: { dataset: { skin } } });
  for (const s of ['obsidian', 'obsidian-light', 'landscapes']) {
    const h = run(s)('working', 3); assert.equal((h.match(/<i /g) || []).length, 3, s);
    assert.match(run(s)('ready', 20), /<em>\+<\/em>/, `${s}: capped with +`);
  }
  for (const s of ['nebula', 'grove', 'tide', 'ember', 'signal']) assert.equal(run(s)('ready', 3), '', s);
});

test('a credit account renders as a fuel gauge with dollars left', () => {
  const injected = src.replace("ai:null,aiAt:0", "ai:{providers:[{id:'tinfoil',provider:'tinfoil',providerName:'Tinfoil',status:'ok',limits:[],paid:{type:'credits',enabled:true,currency:'USD',exponent:2,balanceMinor:450,limitMinor:2000}}]},aiAt:0");
  assert.notEqual(injected, src, 'state literal found');
  const ctx = { window: {}, document: { documentElement: { dataset: { skin: 'obsidian' } }, addEventListener() {}, querySelectorAll: () => [], hidden: false },
    localStorage: { getItem: () => null, setItem() {} }, queueMicrotask() {}, setTimeout, clearTimeout, fetch: async () => ({ ok: false }), AbortController };
  ctx.window = ctx; ctx.window.addEventListener = () => {};
  vm.runInNewContext(injected, ctx);
  const h = ctx.WosResources.home();
  assert.match(h, /rs-dial  rs-fuel rs-empty|rs-dial rs-fuel rs-empty/);
  assert.match(h, /data-money="\$4\.50"/); assert.match(h, /Tinfoil \$4\.50 credit left/);
});

test('every dial shows what is left as a fuel gauge, computer and AI on separate lines', () => {
  const injected = src.replace("server:null,serverAt:0", "server:{cpu:30,memory:95,disk:93},serverAt:0").replace("ai:null,aiAt:0", "ai:{providers:[{id:'claude:x',provider:'claude',providerName:'Claude',status:'ok',limits:[{id:'w',label:'Weekly',remainingPercent:58}]}]},aiAt:0");
  const ctx = { window: {}, document: { documentElement: { dataset: { skin: 'landscapes' } }, addEventListener() {}, querySelectorAll: () => [], hidden: false },
    localStorage: { getItem: () => null, setItem() {} }, queueMicrotask() {}, setTimeout, clearTimeout, fetch: async () => ({ ok: false }), AbortController };
  ctx.window = ctx; ctx.window.addEventListener = () => {};
  vm.runInNewContext(injected, ctx);
  const h = ctx.WosResources.home();
  assert.match(h, /aria-label="CPU 70% left"/); assert.match(h, /rs-fuel rs-empty rs-crit"[^>]*data-k="Memory"/);
  assert.match(h, /aria-label="Claude 58% left"/); assert.equal((h.match(/class="rs-e">E</g) || []).length, 1); assert.ok(h.indexOf('AI week left') < h.indexOf('aria-label="Server"'), 'AI row first');
  assert.equal((h.match(/class="rs-dials"/g) || []).length, 2);
});

test('devices sheet draws capacity bars sized by real capacity', () => {
  const injected = src.replace("devices:null,devicesAt:0", "devices:{devices:[{id:'this',kind:'this',group:'agent',name:'Big',status:'online',cpus:8,cpu:10,memory:50,memoryTotalGB:32,disks:[{label:'System disk',sizeGB:1000,freeGB:500,pct:50}]},{id:'s',kind:'ssh',group:'agent',name:'Small',status:'online',cpus:4,cpu:95,memory:20,memoryTotalGB:8,disks:[{label:'System disk',sizeGB:250,freeGB:200,pct:20}]}],network:{available:true,peers:[]}},devicesAt:0");
  assert.notEqual(injected, src, 'devices state literal found');
  const ctx = { window: {}, document: { documentElement: { dataset: { skin: 'obsidian' } }, addEventListener() {}, querySelectorAll: () => [], hidden: false },
    localStorage: { getItem: () => null, setItem() {} }, queueMicrotask() {}, setTimeout, clearTimeout, fetch: async () => ({ ok: false }), AbortController };
  ctx.window = ctx; ctx.window.addEventListener = () => {};
  vm.runInNewContext(injected.replace('window.WosResources={', 'globalThis.__dv=groupedDevicesHtml;window.WosResources={'), ctx);
  const h = ctx.__dv();
  assert.match(h, /data-cap="mem"[\s\S]*style="flex:32 1 0"[\s\S]*style="flex:8 1 0"/);
  assert.match(h, /22 GB free of 40 GB/); assert.match(h, /700 GB free of 1.3 TB/);
  assert.match(h, /data-cap="cpu"[\s\S]*rs-cap-seg rs-empty rs-crit/);
});
