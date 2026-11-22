// Small CSS helpers for the r7A batch of wizard-ux issue 1674 (tests run the code, CSS included), on top of
// tests/fixtures/w5-css.mjs: the value a property computes to on an element the test built, with custom properties
// inherited from its ancestors and var(--x, fallback) resolved the way a browser would. No layout, no calc().
import { styles } from './w5-css.mjs';

// mini-css skips a rule whose head starts with '@', so a sheet's leading `@import url(...);` would hide its first rule.
export const noImports = list => (Array.isArray(list) ? list : [list]).map(t => String(t).replace(/@import\s[^;]*;/g, ''));

// The winning declarations on el plus every custom property it inherits (nearest ancestor wins).
export function computed(el, list, opts = {}) {
  list = noImports(list);
  const chain = [];
  for (let n = el; n && n.nodeType !== 9 && n.tagName !== '#FRAGMENT'; n = n.parentNode) chain.unshift(n);
  const out = {};
  for (const n of chain) {
    const won = styles(n, list, n === el ? opts : {});
    for (const [k, v] of Object.entries(won)) if (k.startsWith('--') || n === el) out[k] = v;
  }
  return out;
}

// var(--a, var(--b, #fff)) -> the first defined custom property's value (resolved again), else the fallback.
export function resolveVars(value, vars, depth = 0) {
  if (depth > 20) return value;
  let s = String(value ?? ''), i;
  while ((i = s.indexOf('var(')) >= 0) {
    let d = 1, j = i + 4;
    for (; j < s.length && d; j++) { if (s[j] === '(') d++; else if (s[j] === ')') d--; }
    const inner = s.slice(i + 4, j - 1);
    let k = 0, depth2 = 0;
    for (; k < inner.length; k++) { if (inner[k] === '(') depth2++; else if (inner[k] === ')') depth2--; else if (inner[k] === ',' && !depth2) break; }
    const name = inner.slice(0, k).trim(), fallback = k < inner.length ? inner.slice(k + 1).trim() : '';
    const got = vars[name] !== undefined ? resolveVars(vars[name], vars, depth + 1) : resolveVars(fallback, vars, depth + 1);
    s = s.slice(0, i) + got + s.slice(j);
  }
  return s.trim();
}

// The value prop computes to on el (custom properties from its ancestors, var() resolved).
export function valueOf(el, list, prop, opts) {
  const c = computed(el, list, opts);
  return resolveVars(c[prop] ?? '', c);
}
