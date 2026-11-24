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

// A resolved length in px: numbers in px, max()/min()/calc() with + and -, env(name, fallback) as its fallback.
// NaN for anything else (%, vh, unknown functions). Enough to check how insets add up, not a layout engine.
export function px(value) {
  const s = String(value ?? '').trim();
  let i = 0;
  const ws = () => { while (s[i] === ' ') i++; };
  const args = () => { const out = []; for (;;) { ws(); out.push(sum()); ws(); if (s[i] === ',') { i++; continue; } if (s[i] === ')') { i++; return out; } return [NaN]; } };
  const atom = () => {
    ws();
    const fn = /^(max|min|calc|env)\(/.exec(s.slice(i));
    if (fn) {
      i += fn[0].length;
      if (fn[1] === 'env') { const c = s.indexOf(',', i), e = s.indexOf(')', i); if (c < 0 || c > e) { i = e + 1; return NaN; } i = c + 1; const v = sum(); ws(); i++; return v; }
      const a = args();
      return fn[1] === 'max' ? Math.max(...a) : fn[1] === 'min' ? Math.min(...a) : a[0];
    }
    if (s[i] === '(') { i++; const v = sum(); ws(); i++; return v; }
    const n = /^(-?\d*\.?\d+)(px)?/.exec(s.slice(i));
    if (!n) { i = s.length; return NaN; }
    i += n[0].length;
    return n[2] || Number(n[1]) === 0 ? Number(n[1]) : NaN;
  };
  const sum = () => { let v = atom(); for (;;) { ws(); const op = s[i]; if ((op === '+' || op === '-') && s[i + 1] === ' ') { i++; const b = atom(); v = op === '+' ? v + b : v - b; } else return v; } };
  const v = sum(); ws();
  return i >= s.length ? v : NaN;
}
