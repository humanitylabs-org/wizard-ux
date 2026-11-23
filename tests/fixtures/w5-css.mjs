// Small helpers around tests/fixtures/mini-css.mjs (wizard-ux issue 1674: tests run the code, CSS included).
//  - mini-dom splits a selector at every `~`, so `[data-tweaks~="x"]` (a tweak's or skin's switch) cannot be
//    matched as written; wordAttrs() spells each `[a~="v"]` as the same test on whole words with ^= / $= / *= / =.
//  - cascade() over several sheets restarts source order per sheet; sheets() joins them into one text so a later
//    sheet wins a tie, as in a page that links them in that order.
//  - mini-css takes `X ::selection` as X itself; sheets() spells it `X *::selection` (what it means).
import { cascade as miniCascade, parseCss } from './mini-css.mjs';
import { createDocument } from './mini-dom.mjs';

export function wordAttrs(css) {
  return String(css).replace(/\[([\w-]+)~=\s*(?:"([^"]*)"|'([^']*)')\s*\]/g, (_, a, d, s) => {
    const v = d ?? s;
    return `:is([${a}="${v}"], [${a}^="${v} "], [${a}$=" ${v}"], [${a}*=" ${v} "])`;
  });
}

// A pseudo-element after a combinator (`html[data-skin="x"] ::selection`) means `*::selection`; spelled so for mini-css.
const bareNodes = css => css.replace(/([\s,>+~(])(::[\w-]+)/g, '$1*$2');
export const sheets = list => bareNodes(wordAttrs((Array.isArray(list) ? list : [list]).join('\n')));
// The same, parsed once per distinct text (a test asks about many elements under one set of sheets).
// Each sheet is parsed once (pages that share their big sheets and differ in one small inline sheet reuse them); the
// list is then numbered on in source order, as if the sheets were one text, so a later sheet still wins a tie.
const PIECES = new Map(), LISTS = new Map();
const piece = text => {
  let rules = PIECES.get(text);
  if (!rules) { rules = parseCss(sheets(text)); PIECES.set(text, rules); if (PIECES.size > 80) PIECES.delete(PIECES.keys().next().value); }
  return rules;
};
const BY_ARRAY = new WeakMap(); // a caller asking with the same list array (one page, many elements) skips the key
export function parsed(list) {
  if (Array.isArray(list) && BY_ARRAY.has(list)) return BY_ARRAY.get(list);
  const all = Array.isArray(list) ? list : [list], key = all.join('\u0000');
  let rules = LISTS.get(key);
  if (rules) { if (Array.isArray(list)) BY_ARRAY.set(list, rules); return rules; }
  if (all.length === 1) rules = piece(all[0]);
  else { let at = 0; rules = all.flatMap(t => { const r = piece(t), off = at; at += r.length; return r.map(x => ({ ...x, order: x.order + off })); }); }
  LISTS.set(key, rules); if (LISTS.size > 40) LISTS.delete(LISTS.keys().next().value);
  if (Array.isArray(list)) BY_ARRAY.set(list, rules);
  return rules;
}

// The winning declarations on `el` from these sheets (in this order), values only: { prop: value }.
export function styles(el, list, opts) {
  return Object.fromEntries(Object.entries(miniCascade(el, parsed(list), opts)).map(([k, v]) => [k, v.value]));
}

// A skeleton of the markup a selector is written for (a chain of elements, outermost first), for elements a test
// cannot draw with the real renderer: `.ch-compose button.ch-mic:not(.on) svg` -> div.ch-compose > button.ch-mic > svg.
// :is(a, b) takes its first choice, :not() adds nothing, :hover / :focus-visible / ... come back as `states`,
// ::before / ::selection as `pseudo`. The test then asks the real cascade what wins on the innermost element.
const splitTop = (s, at) => { const out = []; let d = 0, q = '', cur = ''; for (const c of s) { if (q) { cur += c; if (c === q) q = ''; continue; } if (c === '"' || c === "'") q = c; else if (c === '(' || c === '[') d++; else if (c === ')' || c === ']') d--; if (!d && at.test(c)) { if (cur.trim()) out.push(cur.trim()); cur = c === '>' ? '' : ''; continue; } cur += c; } if (cur.trim()) out.push(cur.trim()); return out; };
export function skeleton(doc, selector, parent = doc.body) {
  const states = [], parts = splitTop(selector.replace(/\s*>\s*/g, ' '), /\s/); let pseudo = '', el = parent;
  for (let part of parts) {
    let tag = 'div'; const cls = [], attrs = [];
    const take = re => { const m = re.exec(part); if (m) part = part.slice(m[0].length); return m; };
    for (let guard = 0; part && guard < 50; guard++) {
      let m;
      if ((m = take(/^([a-z][\w-]*|\*)/i))) { if (m[1] !== '*') tag = m[1]; }
      else if ((m = take(/^\.([\w-]+)/))) cls.push(m[1]);
      else if ((m = take(/^#([\w-]+)/))) attrs.push(['id', m[1]]);
      else if ((m = take(/^\[([\w-]+)(?:([~^$*|]?=)\s*"([^"]*)")?\]/))) attrs.push([m[1], m[3] ?? '']);
      else if ((m = take(/^::([\w-]+)/))) pseudo = '::' + m[1];
      else if ((m = take(/^:(?:is|where)\(/))) { let d = 1, i = 0; for (; i < part.length && d; i++) { if (part[i] === '(') d++; else if (part[i] === ')') d--; } const first = splitTop(part.slice(0, i - 1), /,/)[0].replace(/^,/, '').trim(); part = first + part.slice(i); }
      else if ((m = take(/^:not\(/))) { let d = 1, i = 0; for (; i < part.length && d; i++) { if (part[i] === '(') d++; else if (part[i] === ')') d--; } part = part.slice(i); }
      else if ((m = take(/^:([\w-]+)/))) states.push(':' + m[1]);
      else throw new Error(`skeleton: cannot build ${part} (in ${selector})`);
    }
    const n = doc.createElement(tag); if (cls.length) n.className = cls.join(' '); for (const [k, v] of attrs) n.setAttribute(k, v);
    el.appendChild(n); el = n;
  }
  return { el, states, pseudo };
}

// What wins on a skeleton of `selector` (no `html` part) under <html data-skin=skin data-shell=shell ...>.
export function onSkin(list, selector, { skin, shell = 'phone', attrs = {} } = {}) {
  return styles(...skinEl(selector, { skin, shell, attrs }, list));
}
function skinEl(selector, { skin, shell = 'phone', attrs = {} }, list) {
  const doc = createDocument(), root = doc.documentElement;
  if (skin) root.setAttribute('data-skin', skin);
  if (shell) root.setAttribute('data-shell', shell);
  for (const [k, v] of Object.entries(attrs)) root.setAttribute(k, v);
  const { el, states, pseudo } = skeleton(doc, selector);
  return [el, list, { states, pseudo }];
}
// The colours that reach that element (colour, background, border, shadow, outline, --c), joined: a shorthand's
// colour counts only when no later or stronger longhand replaced it (mini-css keeps shorthands whole).
const COLOURS = ['color', 'background', 'background-color', 'border', 'border-color', 'box-shadow', 'outline', 'outline-color', '--c'];
const LONG = { border: 'border-color', background: 'background-color', outline: 'outline-color' };
const rankOf = d => (d ? d.rank[0] * 1e12 + d.rank[1] * 1e4 + d.rank[2] : -1);
export function colours(list, selector, opts = {}) {
  const [el, , o] = skinEl(selector, opts, list), won = miniCascade(el, parsed(list), o);
  return COLOURS.filter(p => won[p] && !(LONG[p] && rankOf(won[LONG[p]]) > rankOf(won[p]))).map(p => won[p].value).join(' ; ');
}
// The stylesheets a page links (paths relative to web/), in its order.
export function linkOrder(html) {
  return [...String(html).matchAll(/<link[^>]+rel="stylesheet"[^>]*href="([^"]+)"/g)].map(m => m[1].split('?')[0]);
}
