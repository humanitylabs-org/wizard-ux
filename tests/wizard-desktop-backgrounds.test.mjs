import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const KEY = 'wos.skin.wallpaper.wizard.desktop';

test('browser oracle observes reused cached covers, not the last decoded orientation', () => {
  const source=read('tests/qa-custom-background.cjs');
  const start=source.indexOf('await context.addInitScript(()=>{')+'await context.addInitScript(()=>{'.length;
  const init=source.slice(start,source.indexOf('\n  });',start));
  class Image { constructor(src) { this.src=src;this.naturalWidth=2560;this.naturalHeight=1440; } }
  class Context { constructor(canvas) { this.canvas=canvas; } drawImage() {} }
  const b={HTMLImageElement:Image,CanvasRenderingContext2D:Context,localStorage:{getItem(){return 'saved';}}};
  b.window=b;b.top=b;vm.runInNewContext(`(()=>{${init}})()`,b);
  const canvas=(id,width,height)=>({id,width,height,matches:()=>id==='skinA'});
  const wide=canvas('',1440,960),tall=canvas('',720,1120),screen=canvas('skinA',1440,960);
  new Context(wide).drawImage(new Image('/wizard/files/wide/content'),0,0,1706,960);
  new Context(tall).drawImage(new Image('/wizard/files/tall/content'),0,0,720,1280);
  const paint=new Context(screen);paint.drawImage(wide,0,0,1440,960);
  assert.equal(b.wallDraws.at(-1).src,'/wizard/files/tall/content','old oracle is stale');
  assert.equal(b.wallPaints.skinA.src,'/wizard/files/wide/content','actual wide cache reuse');
  assert.equal(b.wallPaints.skinA.targetWidth,1440);
  paint.drawImage(tall,0,0,1440,960);
  assert.notEqual(b.wallPaints.skinA.src,'/wizard/files/wide/content','wrong orientation remains detectable');
  paint.drawImage(canvas('',1440,960),0,0,1440,960);
  assert.equal(b.wallPaints.skinA,null,'non-custom painting clears prior custom evidence');
});

test('custom images upload through Wizard Files, persist references only and preserve palettes', async () => {
  const b = boot({'wos.skin':'grove'}), before = resolved(b);
  const file = {type:'image/webp',size:1024};
  await b.S.uploadWallpaper(file);
  assert.equal(b.S.wallpaper,'custom'); assert.equal(b.S.desktopBackdrop.wide,'test-wide');
  assert.deepEqual(resolved(b),before); assert.equal(b.S.current,'grove');
  b.ctx.WizUploads.upload = async () => ({id:'test-tall'});
  await b.S.uploadWallpaper(file,{portrait:true});
  assert.equal(b.S.desktopBackdrop.tall,'test-tall');
  const next=boot(Object.fromEntries(b.storage));
  assert.equal(next.S.wallpaper,'custom'); assert.equal(next.S.desktopBackdrop.tall,'test-tall');
  next.S.setWallpaper('lake'); next.S.setWallpaper('custom'); assert.equal(next.S.desktopBackdrop.wide,'test-wide');
  for(const value of b.storage.values()) assert.doesNotMatch(String(value),/data:|blob:/);
  const phone=boot(Object.fromEntries(b.storage),'phone'); assert.equal(phone.root.dataset.imageBackground,undefined);
});
test('bad, oversized, corrupt and failed uploads leave the selected backdrop intact', async () => {
  const b=boot(); b.S.setWallpaper('lake');
  await assert.rejects(b.S.uploadWallpaper({type:'image/svg+xml',size:10}),/Choose/);
  await assert.rejects(b.S.uploadWallpaper({type:'image/png',size:21*1024*1024}),/20 MB/);
  b.ctx.createImageBitmap=async()=>{throw new Error('corrupt image');};
  await assert.rejects(b.S.uploadWallpaper({type:'image/png',size:10}),/corrupt/);
  b.ctx.createImageBitmap=async()=>({close(){}}); b.ctx.WizUploads.upload=async()=>{throw new Error('offline');};
  await assert.rejects(b.S.uploadWallpaper({type:'image/png',size:10}),/offline/);
  assert.equal(b.S.wallpaper,'lake');
  assert.throws(()=>b.S.adoptDesktopBackdrop({id:'custom',wide:'../bad'}),/Unknown/);
});
function boot(saved = {}, shell = 'desktop') {
  const storage = new Map(Object.entries(saved)), props = new Map();
  const root = { dataset: { shell }, style: { setProperty: (k,v) => props.set(k,v), removeProperty: k => props.delete(k) } };
  const ctx = { document: { documentElement: root, readyState: 'loading', addEventListener() {}, querySelector: () => null, createElement: () => ({}) }, localStorage: { getItem: k => storage.get(k), setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) }, addEventListener() {}, dispatchEvent() {}, CustomEvent: class {}, requestAnimationFrame() {}, matchMedia: () => ({ matches: false }) };
  ctx.window = ctx; ctx.createImageBitmap = async () => ({ close() {} }); ctx.WizUploads = { supported: () => true, upload: async () => ({ id: 'test-wide' }) }; vm.runInNewContext(read('web/core/skins.js'), ctx);
  return { S: ctx.WosSkin, storage, root, props, ctx };
}

test('fresh and existing Wizard desktops retain living canvas, regardless of Mizel wallpaper', () => {
  for (const skin of ['nebula','grove','tide','ember','signal']) {
    const b = boot({ 'wos.skin': skin, 'wos.skin.wallpaper': 'lake' });
    assert.equal(b.S.wizardBackgrounds, true); assert.equal(b.S.wallpaper, 'living');
    assert.equal(b.root.dataset.imageBackground, undefined); assert.equal(b.storage.has(KEY), false);
  }
});

test('Wizard uses the shared catalogue and keeps color, reload persistence, family isolation and reset', () => {
  const b = boot({ 'wos.skin': 'nebula' });
  assert.deepEqual(Array.from(b.S.wallpapers, w=>w.id), ['landscapes','lake','valley','moonrise','sea','clouds','glass']);
  b.S.setWallpaper('lake'); assert.equal(b.S.current,'nebula'); assert.equal(b.storage.get(KEY),'lake');
  assert.equal(b.root.dataset.imageBackground,''); assert.equal(b.props.get('--sk-space'),'0.000');
  b.S.set('grove'); assert.equal(b.S.wallpaper,'lake');
  b.S.set('landscapes'); assert.equal(b.S.wallpaper,'landscapes'); b.S.setWallpaper('sea');
  b.S.set('tide'); assert.equal(b.S.wallpaper,'lake');
  const again=boot(Object.fromEntries(b.storage)); assert.equal(again.S.wallpaper,'lake');
  again.S.setWallpaper('living'); assert.equal(again.storage.has(KEY),false); assert.equal(again.root.dataset.imageBackground,undefined);
  assert.throws(()=>again.S.setWallpaper('not-a-scene'),/Unknown background/);
});

test('phone Wizard ignores a saved desktop image and has no new background picker; Mizel still works', () => {
  const b=boot({ 'wos.skin':'nebula', [KEY]:'lake' },'phone');
  assert.equal(b.S.wizardBackgrounds,false); assert.equal(b.S.wallpaperable,false);
  assert.equal(b.root.dataset.imageBackground,undefined); assert.equal(b.props.get('--sk-space'),'1.000');
  b.S.set('landscapes-light'); assert.equal(b.S.wallpaperable,true); b.S.setWallpaper('clouds'); assert.equal(b.S.wallpaper,'clouds');
  assert.equal(b.storage.get(KEY),'lake');
});

test('invalid saved desktop images fall back without changing Mizel; renderer and picker are shared', () => {
  assert.equal(boot({[KEY]:'bogus'}).S.wallpaper,'living');
  const s=read('web/core/settings.js'), r=read('web/core/skins.js');
  assert.match(s,/S\.wizardBackgrounds \|\| twinned\(S, family\)/);
  assert.match(s,/wizard \? card\('living', 'Living canvas', lk\)/);
  assert.match(r,/image \? 'landscapes' : SKINS\[i\]\.id/);
  assert.match(r,/image \? wizardWall : wall/);
  const css=read('web/core/skins.css');
  assert.match(css,/\[data-image-background\]:not\(\[data-wizard-backgrounds\]\) :is\(\.win/);
  assert.match(css,/\[data-wizard-backgrounds\] \.win \{\s*background: color\(from var\(--sk-win\) srgb r g b \/ 1\)/);
  assert.match(read('web/layouts/ai-apps/desktop.css'),/\[data-wizard-backgrounds\] \{\s*--aad-main: color\(from var\(--sk-win\) srgb r g b \/ 1\)/);
});

// Resolve the root-only material rules as well as skins.js's token writes. The old
// regression compared only WosSkin.current and missed the CSS-only --aad-main swap.
function resolved(b) {
  const tokens = new Map(Object.entries(b.S.list.find(s => s.id === b.S.current).t).map(([k,v]) => ['--'+k,v]));
  for (const [k,v] of b.props) if (k !== '--sk-space') tokens.set(k,v);
  const attrs = { 'data-shell': b.root.dataset.shell, 'data-layout': 'ai-apps', 'data-skin': b.root.dataset.skin };
  for (const [k,v] of Object.entries(b.root.dataset)) attrs['data-'+k.replace(/[A-Z]/g, c=>'-'+c.toLowerCase())] = v;
  const matches = selector => {
    let s = selector.trim();
    if (!s.startsWith('html')) return false;
    s = s.replace(/:not\((\[[^\]]+\])\)/g, (_, part) => matches('html'+part) ? '!no' : '');
    if (s.includes('!no')) return false;
    s = s.replace(/\[([^\]=]+)(?:="([^"]*)")?\]/g, (_, name, value) => name in attrs && (value == null || attrs[name] === value) ? '' : '!no');
    return s === 'html'; // reject descendants/pseudo classes, not a general CSS engine
  };
  const css = read('web/layouts/ai-apps/desktop.css').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [,selector,body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selector.split(',').some(matches)) continue;
    for (const [,key,value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) tokens.set(key,value.trim());
  }
  const resolve = value => value.replace(/var\((--[\w-]+)(?:,\s*(var\([^()]*\)|[^()]*))?\)/g, (_,key,fallback) => tokens.has(key) ? tokens.get(key) : fallback || '');
  for (let i=0; i<8; i++) for (const [k,v] of tokens) tokens.set(k,resolve(v));
  return { skin: b.root.dataset.skin, tokens: Object.fromEntries([...tokens].sort()) };
}
for (const palette of ['nebula','grove','tide','ember','signal']) {
  test(palette+': every background preserves the resolved palette and layout token set', () => {
    const b=boot({'wos.skin':palette}), expected=resolved(b);
    for (const background of ['living',...Array.from(b.S.wallpapers,w=>w.id),'living']) {
      b.S.setWallpaper(background);
      assert.deepEqual(resolved(b),expected,background);
      assert.equal(b.S.current,palette);
      assert.deepEqual(resolved(boot(Object.fromEntries(b.storage))),expected,'reload '+background);
    }
  });
}
test('Wizard material scope leaves Mizel and Landscapes unchanged on both shells', () => {
  for (const shell of ['desktop','phone']) for (const palette of ['obsidian','obsidian-light','landscapes','landscapes-light']) {
    const b=boot({'wos.skin':palette,[KEY]:'lake'},shell), expected=resolved(b);
    assert.equal(b.root.dataset.wizardBackgrounds,undefined);
    if (palette.startsWith('landscapes')) {
      for (const background of Array.from(b.S.wallpapers,w=>w.id)) {
        b.S.setWallpaper(background); assert.deepEqual(resolved(b),expected);
        assert.equal(b.root.dataset.imageBackground,'');
      }
      if (shell==='desktop') assert.equal(expected.tokens['--aad-main'],expected.tokens['--bg']);
    }
    b.S.set('grove'); b.S.set(palette);
    assert.equal(b.root.dataset.wizardBackgrounds,undefined);
    assert.deepEqual(resolved(b),expected);
  }
});
