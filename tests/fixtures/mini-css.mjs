// A small CSS cascade for node:test: parse a real stylesheet and ask which value a property gets on an element,
// usually one the real code rendered (wizard-ux issue 1674: tests run the code, CSS included). It applies selector
// matching (tests/fixtures/mini-dom.mjs), specificity, source order and !important, and keeps @media / @supports
// blocks out unless the caller turns them on. Pseudo-elements are asked for explicitly (`pseudo: '::before'`);
// pseudo-classes such as :hover are off unless listed in `states`. No inheritance, no var() resolution, no layout.
import { matches, splitSelectors, withState } from './mini-dom.mjs';

const stripComments = css => css.replace(/\/\*[\s\S]*?\*\//g, '');

export function parseCss(css) {
  const src = stripComments(css), rules = [];
  let order = 0;
  const walk = (from, to, media) => {
    let i = from;
    while (i < to) {
      const open = src.indexOf('{', i); if (open < 0 || open >= to) break;
      const head = src.slice(i, open).trim();
      let depth = 1, j = open + 1;
      for (; j < to && depth; j++) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; }
      const close = j - 1;
      if (/^@(media|supports|container|layer)\b/.test(head)) walk(open + 1, close, [...media, head]);
      else if (!head.startsWith('@')) {
        const decls = {};
        for (const d of src.slice(open + 1, close).split(/;(?![^(]*\))/)) {
          const k = d.indexOf(':'); if (k < 0) continue;
          const prop = d.slice(0, k).trim().toLowerCase(); let value = d.slice(k + 1).trim(); if (!prop) continue;
          const important = /!\s*important\s*$/i.test(value); if (important) value = value.replace(/\s*!\s*important\s*$/i, '');
          decls[prop] = { value, important };
        }
        rules.push({ selector: head, selectors: splitSelectors(head), decls, media, order: order++ });
      }
      i = j;
    }
  };
  walk(0, src.length, []);
  return rules;
}

// Specificity as one number (ids * 1e6 + classes/attributes/pseudo-classes * 1e3 + types/pseudo-elements);
// :is / :not / :has count their most specific argument, :where counts nothing.
function specificity(sel) {
  let extra = 0;
  const s = sel.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, ' ')
    .replace(/:(?:not|is|has)\(((?:[^()]|\([^()]*\))*)\)/g, (_, inner) => { extra += Math.max(0, ...splitSelectors(inner).map(specificity)); return ' '; });
  const ids = (s.match(/#[\w-]+/g) || []).length;
  const cls = (s.match(/\.[\w-]+|\[[^\]]*\]|(^|[^:]):[\w-]+(\([^)]*\))?/g) || []).length;
  const tags = (s.match(/(^|[\s>+~(])[a-zA-Z][\w-]*/g) || []).length + (s.match(/::[\w-]+/g) || []).length;
  return ids * 1e6 + cls * 1e3 + tags + extra;
}

// The declarations that reach `el`, best first per property: { prop: { value, important, selector, media } }.
// Parsing and selector prep are pure, so they are cached: tests cascade the same page sheets for many elements.
const parsed = new Map();
function parsedOnce(css) {
  let r = parsed.get(css);
  if (!r) { r = parseCss(css); if (parsed.size > 64) parsed.delete(parsed.keys().next().value); parsed.set(css, r); }
  return r;
}
const prepped = new WeakMap();
function prep(r) { // keyed by the selector list, which a rule renumbered by w5-css (a copy) shares
  let p = prepped.get(r.selectors);
  if (!p) {
    p = r.selectors.map(sel => {
      const pe = /::?(before|after|placeholder|marker|selection|backdrop|-webkit-[\w-]+)\s*$/.exec(sel);
      return { want: pe ? '::' + pe[1] : '', base: pe ? sel.slice(0, pe.index) || '*' : sel, spec: specificity(sel) };
    });
    prepped.set(r.selectors, p);
  }
  return p;
}

export function cascade(el, sheets, { pseudo = '', states = [], media = () => false } = {}) {
  const rules = (Array.isArray(sheets) ? sheets : [sheets]).flatMap(s => (typeof s === 'string' ? parsedOnce(s) : s));
  const won = {};
  withState(states, () => {
    for (const r of rules) {
      if (r.media.length && !r.media.every(m => media(m))) continue;
      let best = -1;
      for (const { want, base, spec } of prep(r)) {
        if (want !== (pseudo || '')) continue;
        if (spec <= best) continue;
        let ok = false; try { ok = matches(el, base); } catch (_) { ok = false; }
        if (ok) best = spec;
      }
      if (best < 0) continue;
      for (const [prop, d] of Object.entries(r.decls)) {
        const cur = won[prop], rank = [d.important ? 1 : 0, best, r.order];
        if (!cur || rank[0] > cur.rank[0] || (rank[0] === cur.rank[0] && (rank[1] > cur.rank[1] || (rank[1] === cur.rank[1] && rank[2] > cur.rank[2]))))
          won[prop] = { value: d.value, important: d.important, selector: r.selector, media: r.media, rank };
      }
    }
  });
  return won;
}

// One property's winning value on `el` ('' when no rule sets it).
export function styleOf(el, sheets, prop, opts) { return cascade(el, sheets, opts)[prop]?.value ?? ''; }
