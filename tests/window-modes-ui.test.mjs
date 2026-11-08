import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const ui = readFileSync(new URL('../web/layouts/ai-apps/desktop.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../web/layouts/ai-apps/desktop.css', import.meta.url), 'utf8');
const backSource = readFileSync(new URL('../web/core/escape-back.js', import.meta.url), 'utf8');
const coreSource = readFileSync(new URL('../web/core/pane-layout.js', import.meta.url), 'utf8');
test('mode command changes only mode/focus, preserving tiled state and using one pane ancestor per window', () => {
 const window = { WizCore: {}, localStorage: { getItem: () => null, setItem() {} } };
 vm.runInNewContext(coreSource, { window }); const panes = window.WizCore.panes;
 panes.set({ratio:'1/3',side:'end',weights:{chats:2,app:1}}); const before=JSON.stringify(panes.get());
 const start=ui.indexOf('  function windowMode('), end=ui.indexOf('  function modeBar(',start);
 assert.ok(start>0 && end>start); const nodes=[{}, {}, {}], seen=[];
 const command=vm.runInNewContext(ui.slice(start,end)+';windowMode', {panes,dockEl:nodes[0],pane:{el:nodes[1]},secondEl:nodes[2],flip:(n,fn)=>{seen.push(n);fn();}});
 for(const mode of ['centre','pair','full','tiled']) command(mode,'chats');
 assert.equal(JSON.stringify(panes.get()),before); assert.equal(seen.length,4); assert.equal(seen[0].length,3);
 assert.match(ui,/chatHeaderHost = docked && chat \? chat : top/);
});
test('full mode is a last-priority surface, after recording and transient overlays, not an overlay owner', () => {
 const window={};vm.runInNewContext(backSource,{window});const registry=window.WizEscapeBack.create();
 let mode='full', closes=0; const panes={get:()=>({mode})}, windowMode=m=>{mode=m;};
 const start=ui.indexOf('  api.back.surface?.(() => {'), end=ui.indexOf('    const a = doc.activeElement;',start);
 assert.ok(start>0 && end>start);
 const prefix=ui.slice(start,end).replace('  api.back.surface?.(() => {','');
 const surface=vm.runInNewContext('(function(){'+prefix+'return false;})',{panes,windowMode,doc:{activeElement:null},pane:null,lastSurface:'chat',chatsEl:()=>null});
 registry.push(()=>{closes++;});registry.run({recording:()=>true,surface});assert.equal(mode,'full');assert.equal(closes,0);
 registry.run({surface});assert.equal(closes,1);assert.equal(mode,'full');registry.run({surface});assert.equal(mode,'tiled');
});
test('shifted mode shortcuts precede app dispatch but yield to existing modal guards; native plain Alt keys unchanged',()=>{
 assert.match(ui,/MODE_KEYS = \{ KeyU: 'centre', KeyJ: 'pair', KeyF: 'full', KeyT: 'tiled' \}/);
 const keys=ui.slice(ui.indexOf('    if (!e.altKey || e.ctrlKey || e.metaKey) return false;\n    const code'));
 assert.ok(keys.indexOf('snoozeOpen()')<keys.indexOf('sh && MODE_KEYS[code]'));
 assert.ok(keys.indexOf('sh && MODE_KEYS[code]')<keys.indexOf('if (!sh && appFront())'));
 assert.match(ui,/code === 'KeyF' && !sh && pane/);
 assert.match(ui,/for \(const \{ bar \} of modeBars\)/);
 assert.match(css,/background: linear-gradient\(var\(--aad-main\), var\(--aad-main\)\), var\(--aad-canvas\) !important; backdrop-filter: none/);
 assert.match(css,/data-aad-mode="full".*#bar/);
});

// James, 6 Nov 2026: centred / side by side / full screen turned the window grey (--wz-panel = 10% text mixed into
// the base) instead of the skin colour. Resolve the real CSS for built-in skins: the floating panes must paint the
// same opaque colour the tiled panes show (the window tint --aad-main over the skin base --aad-canvas).
test('window modes keep the tiled panes\' skin colour, opaque, never the grey panel mix', () => {
 const skinsJs = readFileSync(new URL('../web/core/skins.js', import.meta.url), 'utf8');
 const shellTokens = readFileSync(new URL('../web/kit/shell-tokens.css', import.meta.url), 'utf8');
 const decl = (src, sel, prop) => { const i = src.indexOf(sel); assert.ok(i >= 0, sel); const body = src.slice(src.indexOf('{', i) + 1, src.indexOf('}', i)); const m = body.match(new RegExp('(?:^|[;\\s])' + prop.replace(/[\\^$.*+?()[\]{}|-]/g, '\\$&') + ':\\s*([^;]+);')); assert.ok(m, sel + ' ' + prop); return m[1].replace(/\s*!important\s*$/, '').trim(); };
 const A = 'html[data-shell="desktop"][data-layout="ai-apps"]', NT = A + ':not([data-aad-mode="tiled"]) #stage > .wsp[data-aad-role]';
 const split = s => { const out = []; let d = 0, cur = ''; for (const ch of s) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && !d) { out.push(cur.trim()); cur = ''; } else cur += ch; } out.push(cur.trim()); return out; };
 const call = (s, name) => { const m = s.match(new RegExp('^' + name + '\\((.*)\\)$', 's')); return m && m[1]; };
 const hex = h => { h = h.slice(1); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)).concat(1); };
 const over = (top, bot) => { const a = top[3] + bot[3] * (1 - top[3]); return a ? [0, 1, 2].map(i => (top[i] * top[3] + bot[i] * bot[3] * (1 - top[3])) / a).concat(a) : [0, 0, 0, 0]; };
 function colour(expr, vars) {
  expr = expr.trim(); let a;
  if ((a = call(expr, 'var'))) { const [n, ...fb] = split(a); return vars[n] != null ? colour(vars[n], vars) : colour(fb.join(','), vars); }
  if (/^#[0-9a-f]{6}$/i.test(expr)) return hex(expr);
  if ((a = call(expr, 'rgba'))) return split(a).map(Number);
  if ((a = call(expr, 'color'))) { const m = a.match(/^from (.+) srgb r g b \/ 1$/); assert.ok(m, expr); return colour(m[1], vars).slice(0, 3).concat(1); }
  if ((a = call(expr, 'color-mix'))) { const [, x, y] = split(a), m = x.match(/^(.+) (\d+)%$/), p = m[2] / 100, c1 = colour(m[1], vars), c2 = colour(y, vars); return [0, 1, 2, 3].map(i => c1[i] * p + c2[i] * (1 - p)); }
  if ((a = call(expr, 'linear-gradient'))) { const stops = split(a); assert.equal(new Set(stops).size, 1, 'solid gradient layer'); return colour(stops[0], vars); }
  throw new Error('unresolved colour ' + expr);
 }
 const layers = (bg, vars) => split(bg).map(l => colour(l, vars)).reduceRight((under, top) => over(top, under), [0, 0, 0, 0]);
 const tok = id => { const i = skinsJs.indexOf("{ id: '" + id + "'"); assert.ok(i > 0, id); const t = skinsJs.slice(i, skinsJs.indexOf('}) }', i)); const g = k => t.match(new RegExp("(?:'" + k + "'|\\b" + k + "): '([^']+)'"))[1]; return { '--bg': g('bg'), '--ink': g('ink'), '--sk-win': g('sk-win') }; };
 const results = [];
 for (const [id, wizardFamily] of [['nebula', true], ['ember', true], ['sepia', false], ['novairecito', false]]) {
  const vars = { ...tok(id) };
  for (const k of ['--wz-base', '--wz-text', '--wz-panel']) vars[k] = decl(shellTokens, ':root', k);
  vars['--aad-canvas'] = decl(css, A + ' {', '--aad-canvas');
  vars['--aad-main'] = wizardFamily ? decl(css, A + '[data-wizard-backgrounds] {', '--aad-main') : decl(css, A + ' {', '--aad-main');
  // Tiled: the docked pane desk paints the base, its lone window paints the window tint on top.
  const desk = decl(css, A + '[data-aad-split] #stage > .wsp[data-aad-role="app"] {', 'background');
  const win = decl(css, A + ' #stage > .wsp:not(:has(> .win:not(.gone) ~ .win:not(.gone))) > .win:not(.gone) {', 'background');
  const tiled = over(layers(win, vars), layers(desk, vars));
  const modeDesk = layers(decl(css, NT + ' {', 'background'), vars);
  const modeWin = layers(decl(css, NT + ' > :is(.win, .aad-ctop, .aad-ptop) {', 'background'), vars);
  const modeTop = layers(decl(css, A + ' .aad-stop {', 'background'), vars);
  const grey = layers('var(--wz-panel)', vars), rgb = c => c.slice(0, 3).map(Math.round).join(',');
  for (const [part, c] of [['window', over(modeWin, modeDesk)], ['window alone', modeWin], ['mode bar', modeTop]]) {
   assert.equal(c[3], 1, id + ' ' + part + ' is opaque'); assert.equal(rgb(c), rgb(tiled), id + ' ' + part + ' matches tiled');
  }
  assert.equal(modeDesk[3], 1, id + ' desk is opaque'); assert.notEqual(rgb(modeWin), rgb(grey), id + ' is not the grey panel mix');
  results.push(id + ' ' + rgb(tiled));
 }
 assert.deepEqual(results.map(r => r.split(' ')[0]), ['nebula', 'ember', 'sepia', 'novairecito']);
});
