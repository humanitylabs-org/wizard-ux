// What a skin really paints (wizard-ux issue 1674: tests run the code, CSS included). skinPage(skin, shell) runs the
// real core/skins.js for that skin (the tokens it writes on <html> become an inline-strength rule), takes every
// stylesheet the shell page links in <head> in order (and the marks skins.js sets on <html>), puts the skin's package sheet (WosSkin.pkgOf) right after
// core/skins.css where skin-host inserts it, and returns a mini-dom document plus `value(el, prop)` (the computed value,
// custom properties inherited, var() resolved: tests/fixtures/r7A-css.mjs). colour(text) turns a resolved CSS colour
// (hex, rgb(a), named white/black/transparent, color-mix(in srgb, ...), color(from X srgb r g b / a)) into [r, g, b, a];
// over(top, under) composites, contrast(a, b) is the WCAG ratio of two opaque colours.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createDocument } from './mini-dom.mjs';
import { resolveVars, noImports } from './r7A-css.mjs';
import { styles } from './w5-css.mjs';

const ROOT = new URL('../../', import.meta.url);
const read = p => readFileSync(new URL(p, ROOT), 'utf8');

export function skinsJs(saved = {}, shell = 'phone') {
  const store = new Map(Object.entries(saved)), props = new Map();
  const root = { dataset: { shell }, style: { setProperty: (k, v) => props.set(k, v), removeProperty: k => props.delete(k) } };
  const ctx = { console, Math, performance: { now: () => 0 }, setTimeout() {}, addEventListener() {}, requestAnimationFrame() {},
    matchMedia: () => ({ matches: false, addEventListener() {} }), dispatchEvent() {}, CustomEvent: class { constructor(t) { this.type = t; } },
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    document: { documentElement: root, readyState: 'loading', addEventListener() {}, getElementById: () => null, querySelector: () => null, createElement: () => ({}) } };
  ctx.window = ctx;
  vm.runInNewContext(read('web/core/skins.js'), ctx);
  return { S: ctx.WosSkin, props, root };
}

const sheetCache = new Map();
function pageSheets(page, pkgDir) {
  const key = page + '|' + pkgDir;
  if (!sheetCache.has(key)) {
    const links = [...read('web/' + page).split('</head>')[0].matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(m => m[1]);
    const at = links.indexOf('core/skins.css');
    if (pkgDir) links.splice(at + 1, 0, `skins/${pkgDir}/skin.css`);
    sheetCache.set(key, noImports(links.map(f => read('web/' + f))).join('\n'));
  }
  return sheetCache.get(key);
}

// skin null: no skins.js tokens and no data-skin (a page that only has base.css's defaults).
// opts.extra: stylesheets mounted after the page's (a layout's sheet); opts.attrs: more attributes on <html>.
export function skinPage(skin, shell = 'phone', body = '', { extra = [], attrs = {} } = {}) {
  const page = shell === 'desktop' ? 'desktop.html' : 'index.html';
  let inline = '', pkg = null, marks = {};
  if (skin) {
    const { S, props, root } = skinsJs({ 'wos.skin': skin }, shell);
    marks = root.dataset;
    if (S.current !== skin) throw new Error('skins.js does not know ' + skin);
    pkg = S.pkgOf(skin); props.size && (inline = `#inline-style#inline-style { ${[...props].map(([k, v]) => `${k}: ${v};`).join(' ')} }`);
  }
  const list = [pageSheets(page, pkg?.css ? pkg.dir : null), ...noImports(extra), inline], css = list.join('\n');
  const doc = createDocument(), html = doc.documentElement;
  html.setAttribute('id', 'inline-style'); html.setAttribute('data-shell', shell);
  // what skins.js marked on <html> (data-skin, data-wizard-backgrounds, ...), then the caller's attributes
  for (const [k, v] of Object.entries(marks)) html.setAttribute('data-' + k.replace(/[A-Z]/g, c => '-' + c.toLowerCase()), v);
  if (skin) html.setAttribute('data-skin', skin);
  html.setAttribute('data-shell', shell);
  for (const [k, v] of Object.entries(attrs)) html.setAttribute(k, v);
  doc.body.innerHTML = body;
  // valueOf (r7A-css.mjs) with each element's cascade memoised (build the markup first: later DOM changes are not seen).
  const memo = new Map();
  const computed = el => {
    if (!el || el.nodeType === 9 || el.tagName === '#FRAGMENT') return { vars: {}, own: {} };
    if (!memo.has(el)) {
      const own = styles(el, list), vars = { ...computed(el.parentNode).vars };
      for (const [k, v] of Object.entries(own)) if (k.startsWith('--')) vars[k] = v;
      memo.set(el, { own, vars });
    }
    return memo.get(el);
  };
  const value = (el, prop) => { const c = computed(el); return resolveVars((prop.startsWith('--') ? c.vars[prop] : c.own[prop]) ?? '', c.vars); };
  return { doc, css, value };
}

const split = s => { const out = []; let d = 0, cur = ''; for (const ch of s) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && !d) { out.push(cur.trim()); cur = ''; } else cur += ch; } out.push(cur.trim()); return out; };
const call = (s, name) => { const m = new RegExp('^' + name + '\\((.*)\\)$', 's').exec(s); return m && m[1]; };
const NAMED = { white: [255, 255, 255, 1], black: [0, 0, 0, 1], transparent: [0, 0, 0, 0] };
export function colour(text) {
  const s = String(text).trim().toLowerCase(); let a;
  if (NAMED[s]) return NAMED[s].slice();
  if (/^#[0-9a-f]{3}$/.test(s)) return [...s.slice(1)].map(c => parseInt(c + c, 16)).concat(1);
  if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(s)) return [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16)).concat(s.length === 9 ? parseInt(s.slice(7), 16) / 255 : 1);
  if ((a = call(s, 'rgba?'))) { const p = a.includes(',') ? split(a) : a.replace('/', ' ').split(/\s+/).filter(Boolean); return [0, 1, 2].map(i => Number(p[i])).concat(p[3] == null ? 1 : p[3].endsWith('%') ? parseFloat(p[3]) / 100 : Number(p[3])); }
  if ((a = call(s, 'color'))) { const m = /^from (.+) srgb r g b(?: \/ ([\d.]+))?$/.exec(a); if (!m) throw new Error('colour: ' + s); return colour(m[1]).slice(0, 3).concat(m[2] == null ? 1 : Number(m[2])); }
  if ((a = call(s, 'color-mix'))) {
    const [space, x, y] = split(a); if (space !== 'in srgb') throw new Error('colour: ' + s);
    const part = t => { const m = /^(.*?)\s+([\d.]+)%$/.exec(t); return m ? [colour(m[1]), Number(m[2]) / 100] : [colour(t), null]; };
    let [[c1, p1], [c2, p2]] = [part(x), part(y)];
    if (p1 == null && p2 == null) p1 = p2 = 0.5; else if (p1 == null) p1 = 1 - p2; else if (p2 == null) p2 = 1 - p1;
    const sum = p1 + p2, w1 = p1 / sum, w2 = p2 / sum, alpha = c1[3] * w1 + c2[3] * w2;
    const rgb = [0, 1, 2].map(i => alpha ? (c1[i] * c1[3] * w1 + c2[i] * c2[3] * w2) / alpha : 0);
    return rgb.concat(alpha * Math.min(sum, 1));
  }
  throw new Error('colour: cannot read ' + s);
}
export const over = (top, under) => { const a = top[3] + under[3] * (1 - top[3]); return a ? [0, 1, 2].map(i => (top[i] * top[3] + under[i] * under[3] * (1 - top[3])) / a).concat(a) : [0, 0, 0, 0]; };
const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
export const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
