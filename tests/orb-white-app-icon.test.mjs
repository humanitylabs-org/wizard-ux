import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createDocument } from './fixtures/mini-dom.mjs';
import { withShellParts } from './fixtures/shell-parts.mjs';
import { withWebParts } from './fixtures/web-parts.mjs';
import { block, runRecording } from './fixtures/source-slice.mjs';
const source = withShellParts(withWebParts(fs.readFileSync(process.env.ORB_SOURCE || new URL('../web/core/sigils.js', import.meta.url),'utf8')));
const expose = source.replace('  window.WizSigil =', '  window.whitePixels = whitePixels; window.WizSigil =');
function load() {
  const window = { WizCore: { appLogo: id => `/wizard-os-home/store-data/app-logo/${id}?v=0123456789abcdef` } };
  vm.runInNewContext(expose,{window,Uint8ClampedArray}); return window;
}
function tile(bg,fg,transparent = false) {
  const data = new Uint8ClampedArray(16*16*4);
  for(let y=0;y<16;y++)for(let x=0;x<16;x++) {
    const inside=x>=5&&x<11&&y>=4&&y<12,i=(y*16+x)*4;
    data.set([...(inside?fg:bg),transparent&&!inside?0:255],i);
  }
  return data;
}
for(const [name,bg,fg,transparent] of [
  ['Airlock green lock on black',[13,21,18],[76,204,163],false],
  ['app without monochrome asset',[12,12,20],[240,80,120],false],
  ['dark glyph on white tile',[255,255,255],[20,20,30],false],
  ['transparent coloured asset',[0,0,0],[50,200,100],true],
]) test(`James: orb is white without a dark square — ${name}`,()=>{
  const w=load(); assert.equal(typeof w.whitePixels,'function');
  const output=w.whitePixels(tile(bg,fg,transparent),16,16);
  for(let y=0;y<16;y++)for(let x=0;x<16;x++){
    const i=(y*16+x)*4,inside=x>=5&&x<11&&y>=4&&y<12;
    assert.equal(output[i+3],inside?255:0,'background including glyph cutouts is transparent');
    assert.deepEqual([...output.slice(i,i+3)],[255,255,255],'only white, never source colour');
  }
});
test('transparent round glyph touching all four edges keeps its foreground',()=>{
  const data=new Uint8ClampedArray(32*32*4);
  for(let y=0;y<32;y++)for(let x=0;x<32;x++)if(Math.hypot(x-15.5,y-15.5)<16)data.set([70,200,160,255],(y*32+x)*4);
  const output=load().whitePixels(data,32,32);
  assert.equal(output[(16*32+16)*4+3],255);
  for(let i=3;i<data.length;i+=4)assert.equal(output[i],data[i]);
});
test('ordinary launcher/logo icons retain their exact colour markup',()=>{
  const {WizSigil:S}=load();
  assert.match(S.html({id:'airlock'}),/class="sglogo"/);
  assert.doesNotMatch(S.html({id:'airlock'}),/orb-glyph|sg-orb/);
  assert.match(S.html({id:'notes'}),/sgi sg-notes/);
  assert.match(S.html({id:'wizard-claude'}),/sgb-claude/);
});
test('orb normalizer is available and scoped to phone orb plus desktop app identity',()=>{
  assert.equal(typeof load().WizSigil.orb,'function');
  const phone=withShellParts(withWebParts(fs.readFileSync(new URL('../web/app.js',import.meta.url),'utf8')));
  // the phone's paintOrbApp (app-desks.js, run): the desk's sigil goes in, then the normalizer runs on it
  const made=[],orbed=[],wrap={appendChild(){}};
  const pc=runRecording(block(phone,'  function paintOrbApp() {')+'\npaintOrbApp();',{$:()=>wrap,appVars:{desks:[{}],idx:0},orbAppHtml:null,deskSigil:()=>'<svg class="sg"></svg>',
    document:{getElementById:()=>null,createElement:()=>{const e={setAttribute(){}};made.push(e);return e;}},window:{WizSigil:{orb:e=>orbed.push(e.innerHTML)}}});
  assert.deepEqual(orbed,['<svg class="sg"></svg>'],'the orb app icon is normalized');assert.equal(pc.orbAppHtml,'<svg class="sg"></svg>');
  // the desktop AI apps view: paintTop paints the app in front into the orb, and paintOrbIdentity normalizes it
  const desktop=withShellParts(withWebParts(fs.readFileSync(new URL('../web/layouts/ai-apps/desktop.js',import.meta.url),'utf8')));
  const top=runRecording(block(desktop,'  function paintTop(r = api.route()) {')+'\ntry { paintTop(); } catch (e) {}',{api:{route:()=>({view:'thread',thread:'__new__',desk:3})},here:()=>({app:'notes'}),noteOn:()=>false,chatWindows:()=>[]});
  assert.deepEqual(top.calls.filter(c=>c[0]==='paintOrbIdentity').map(c=>[...c]),[['paintOrbIdentity','notes']]);
  const ided=[],micG={innerHTML:'',children:[{style:{}}]};
  runRecording(block(desktop,'  function paintOrbIdentity(appId) {')+"\npaintOrbIdentity('notes');",{micG,micMarkup:'<i class="mic"></i>',orbIdentityHtml:'<i class="mic"></i>',
    api:{apps:{list:()=>[{id:'notes',name:'Notes'}]}},doc:{defaultView:{WizSigil:{html:a=>`<b>${a.id}</b>`,orb:e=>ided.push(e.innerHTML)}}}});
  assert.deepEqual(ided,['<b>notes</b>'],'the app identity in the desktop orb is normalized');
});
// The sigil renderer the next tools/sigils/build.py run writes: the template with its data slots filled (build.py
// needs skia-pathops, not here; the orb code does not depend on the data).
const template = fs.readFileSync(new URL('../tools/sigils/sigils.template.js', import.meta.url), 'utf8')
  .replace('/*NAMES*/', '[]').replace('/*HOUSE*/', '{}').replace('/*HOUSE_ALIASES*/', '{}').replace('/*HOUSE_ONLY*/', '[]')
  .replace('/*BRAND*/', '{}').replace('/*FALLBACK*/', "['888888']")
  .replace('  window.WizSigil =', '  window.whitePixels = whitePixels; window.WizSigil =');

// mini-dom with the bits of CSSStyleDeclaration orb() uses (getPropertyValue reads the style attribute too).
function styled(doc) {
  const fix = el => {
    if (el.style.own) return el;
    const own = new Map();
    el.style.setProperty = (k, v, p) => own.set(k, [v, p]);
    el.style.getPropertyValue = k => own.get(k)?.[0] ?? ((el.getAttribute('style') || '').split(';').map(d => d.split(/:(.*)/s)).find(([n]) => n.trim() === k)?.[1]?.trim() || '');
    el.style.own = own;
    return el;
  };
  const make = doc.createElement; doc.createElement = t => fix(make(t));
  return root => { fix(root); for (const el of root.descendants()) fix(el); return root; };
}
// Runs orb() from `src` on a desk with one logo tile; Image loads are held until the test lets them finish.
function orbWorld(src = expose, logo = '/wizard-os-home/store-data/app-logo/airlock?v=0123456789abcdef') {
  const doc = createDocument(), fix = styled(doc), images = [];
  class Image { constructor() { images.push(this); } set src(v) { this._src = v; this.seen = desk.innerHTML; } get src() { return this._src; } }
  const canvas = () => ({ getContext: () => ({ drawImage() {}, getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} }), toDataURL: () => 'data:image/png;base64,WHITE' });
  const mk = doc.createElement; doc.createElement = t => t === 'canvas' ? canvas() : mk(t);
  const window = { WizCore: { appLogo: id => `/wizard-os-home/store-data/app-logo/${id}?v=0123456789abcdef` } };
  vm.runInNewContext(src, { window, Uint8ClampedArray, Image });
  const desk = doc.createElement('div'); doc.body.append(desk);
  desk.innerHTML = `<i class="sglogo" aria-hidden="true" style="--logo:url('${logo}')"></i>`; fix(desk);
  const load = async (img = images[0]) => { img.naturalWidth = img.naturalHeight = 64; img.onload(); await new Promise(r => setImmediate(r)); };
  return { S: window.WizSigil, whitePixels: window.whitePixels, doc, desk, images, load, fix };
}

test('regenerated sigil renderer retains the orb correction', async () => {
  const built = orbWorld(expose), next = orbWorld(template);
  // The white-glyph conversion gives the same pixels for every kind of tile.
  for (const [bg, fg, tr] of [[[13, 21, 18], [76, 204, 163], false], [[255, 255, 255], [20, 20, 30], false], [[0, 0, 0], [50, 200, 100], true]]) {
    const t = tile(bg, fg, tr);
    assert.deepEqual([...next.whitePixels(t, 16, 16)], [...built.whitePixels(t, 16, 16)]);
  }
  const out = next.whitePixels(tile([13, 21, 18], [76, 204, 163]), 16, 16);
  assert.equal(out[3], 0, 'regenerated: the dark square is gone'); assert.equal(out[(8 * 16 + 8) * 4 + 3], 255);
  // orb() paints the same white glyph into the desk.
  for (const w of [built, next]) { w.S.orb(w.desk); await w.load(); }
  assert.equal(next.desk.innerHTML, built.desk.innerHTML);
  assert.equal(next.desk.querySelector('img.sgi.sg-orb-raster')?.src, 'data:image/png;base64,WHITE');
  assert.equal(next.desk.querySelector('img').src, built.desk.querySelector('img').src);
  assert.deepEqual([...next.desk.querySelector('img').style.own], [...built.desk.querySelector('img').style.own]);
  // And keeps the stale-decode guard: a glyph that moved to a newer desk is not repainted.
  const moved = orbWorld(template); moved.S.orb(moved.desk);
  const newer = moved.doc.createElement('div'); moved.doc.body.append(newer); newer.append(moved.desk.querySelector('.sg-apps'));
  await moved.load();
  assert.equal(newer.querySelector('img'), null);
});

test('async image conversion cannot repaint a newer desk or leak an unconverted tile', async () => {
  // While the logo converts, the desk shows the white fallback glyph, never the coloured tile.
  const w = orbWorld();
  w.S.orb(w.desk);
  assert.equal(w.images.length, 1);
  assert.doesNotMatch(w.images[0].seen, /sglogo/, 'the coloured tile is gone before the image starts loading');
  assert.match(w.images[0].seen, /<i class="sgi sg-apps" data-orb-glyph><\/i>/);
  await w.load();
  assert.ok(w.desk.querySelector('img.sg-orb-raster'), 'converted glyph replaces the fallback');
  // A newer desk painted before the decode finished: the late result does not repaint it.
  const s = orbWorld(undefined, '/wizard-os-home/store-data/app-logo/notes?v=0123456789abcdef');
  s.S.orb(s.desk);
  s.desk.innerHTML = '<i class="sgi sg-mail"></i>';
  await s.load();
  assert.equal(s.desk.innerHTML, '<i class="sgi sg-mail"></i>');
  // The glyph moved on to another desk before the decode finished: that desk is not repainted by the old decode.
  const m = orbWorld();
  m.S.orb(m.desk);
  const newer = m.doc.createElement('div'); m.doc.body.append(newer); newer.append(m.desk.querySelector('.sg-apps'));
  await m.load();
  assert.equal(newer.querySelector('img'), null); assert.ok(newer.querySelector('.sgi.sg-apps'));
  // An unsafe address is never loaded: the fallback stays.
  const u = orbWorld(undefined, 'https://evil.test/x.png');
  u.S.orb(u.desk);
  assert.equal(u.images.length, 0); assert.ok(u.desk.querySelector('.sgi.sg-apps[data-orb-glyph]'));
  const icon = orbWorld(undefined, '/brand/apps/claude.svg'); icon.S.orb(icon.desk);
  assert.equal(icon.images.length, 1, 'a same-origin icon path converts');
  // The conversion cache is bounded: after 128 other logos the first one is decoded again.
  const c = orbWorld();
  const paint = id => { c.desk.innerHTML = `<i class="sglogo" style="--logo:url('/wizard-os-home/store-data/app-logo/${id}?v=0123456789abcdef')"></i>`; c.fix(c.desk); c.S.orb(c.desk); };
  paint('a0'); paint('a0');
  assert.equal(c.images.length, 1, 'cached while fresh');
  for (let i = 1; i <= 128; i++) paint('a' + i);
  assert.equal(c.images.length, 129);
  paint('a0');
  assert.equal(c.images.length, 130, 'evicted after 128 others');
});
