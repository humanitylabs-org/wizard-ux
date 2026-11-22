// Cut real code out of a big module so a test can run it (wizard-ux issue 1674: tests run the code, they do not
// read it as text). between() takes the source from one marker up to the next; expression() takes one whole
// `${ ... }` part of a template literal, so a test can evaluate exactly what that part of the markup renders.
import assert from 'node:assert/strict';
import vm from 'node:vm';

export function between(src, start, end, from = 0) {
  const i = src.indexOf(start, from); assert.ok(i >= 0, `missing: ${start}`);
  const j = src.indexOf(end, i + start.length); assert.ok(j > i, `missing after ${start}: ${end}`);
  return src.slice(i, j);
}

// `marker` must begin with "${": returns the balanced `${ ... }` (strings and nested templates included).
export function expression(src, marker) {
  assert.ok(marker.startsWith('${'), 'an expression marker starts with ${');
  const i = src.indexOf(marker); assert.ok(i >= 0, `missing: ${marker}`);
  const stack = [{ code: true, depth: 0 }]; let k = i + 2;
  while (k < src.length) {
    const top = stack[stack.length - 1], c = src[k];
    if (top.code) {
      if (c === "'" || c === '"') { k++; while (k < src.length && src[k] !== c) k += src[k] === '\\' ? 2 : 1; k++; continue; }
      if (c === '`') { stack.push({ code: false }); k++; continue; }
      if (c === '{') top.depth++;
      else if (c === '}') { if (top.depth === 0) { stack.pop(); if (!stack.length) return src.slice(i, k + 1); k++; continue; } top.depth--; }
      k++;
    } else {
      if (c === '\\') { k += 2; continue; }
      if (c === '`') { stack.pop(); k++; continue; }
      if (c === '$' && src[k + 1] === '{') { stack.push({ code: true, depth: 0 }); k += 2; continue; }
      k++;
    }
  }
  assert.fail(`unbalanced expression: ${marker}`);
}

// Run a slice whose free names the test does not care about: each missing name becomes a no-op function, then the
// slice runs again (bounded). Only for wiring calls whose arguments are read lazily; the context is returned.
export function runWithStubs(code, ctx = {}, rounds = 60) {
  vm.createContext(ctx);
  for (let n = 0; n < rounds; n++) {
    try { vm.runInContext(code, ctx); return ctx; }
    catch (e) {
      const m = /^(\w+) is not defined$/.exec(e?.message || '');
      if (!m || e?.name !== 'ReferenceError') throw e;
      ctx[m[1]] = () => {};
    }
  }
  assert.fail('too many unknown names');
}

// Like runWithStubs, for names a slice only reads when it is called: build(names) makes a fresh context (with a no-op
// for every name in `names`) and returns { run }; each time run() trips over an unknown name, it is added and the
// whole setup starts again, so every attempt runs from a clean state. Returns the env of the run that finished.
export function retryWithStubs(build, rounds = 60) {
  const names = new Set();
  for (let n = 0; n < rounds; n++) {
    const env = build(names);
    try { env.run(); return env; }
    catch (e) {
      const m = /^(\w+) is not defined$/.exec(e?.message || '');
      if (!m || e?.name !== 'ReferenceError') throw e;
      names.add(m[1]);
    }
  }
  assert.fail('too many unknown names');
}

// A stand-in for a name a slice uses but the test does not care about: calling it (or any property of it, to any
// depth) records [name, ...args] in `calls` and returns undefined; reading it is never a thenable or a primitive.
export function recorder(name, calls) {
  const fn = function () {};
  return new Proxy(fn, {
    apply: (_, __, args) => { calls.push([name, ...args]); return undefined; },
    get: (_, k) => (k === 'then' || typeof k === 'symbol' ? undefined : k === 'length' ? 0 : recorder(`${name}.${String(k)}`, calls)),
    has: () => false,
  });
}

const JS_GLOBALS = new Set(vm.runInNewContext('Object.getOwnPropertyNames(globalThis)'));
const KEYWORDS = new Set(('break case catch class const continue debugger default delete do else export extends finally for function if import in '
  + 'instanceof let new return super switch this throw try typeof var void while with yield async await of null true false undefined NaN Infinity arguments get set static').split(' '));
// Run `code` in `ctx`. Every identifier in it (outside comments, not after a dot; words inside strings too, harmlessly) that is neither a JS
// global, a keyword nor already in ctx becomes a recorder() first, so names a slice only reaches when called are
// covered too; names the slice declares itself shadow them. Returns ctx.
export function runRecording(code, ctx = {}, calls = (ctx.calls ||= [])) {
  vm.createContext(ctx);
  const bare = code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:\\])\/\/[^\n]*/g, '$1 ');
  const globals = JS_GLOBALS; // from a fresh context: a test may give the slice its own globalThis
  for (const m of bare.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\b/g)) {
    const n = m[1];
    if (KEYWORDS.has(n) || globals.has(n) || n in ctx) continue; // Node-only globals (setTimeout, queueMicrotask...) are recorders too
    ctx[n] = recorder(n, calls);
  }
  vm.runInContext(code, ctx);
  return ctx;
}

// A small JS scanner for block(): skips comments, strings, regex literals and template literals (with nested ${...}).
function skipCode(src, i, close) { // from i, scan code until the brace that closes depth 0 (`close` = '}'), return its index
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) return src.length; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 1; continue; }
    if (c === "'" || c === '"') { for (i++; i < src.length && src[i] !== c && src[i] !== '\n'; i++) if (src[i] === '\\') i++; continue; }
    if (c === '`') { i = skipTemplate(src, i); continue; }
    if (c === '/') {
      let k = i - 1; while (k >= 0 && /\s/.test(src[k])) k--;
      if (k < 0 || /[(,=:[!&|?{};]/.test(src[k]) || /(^|[^\w$])(return|typeof|case|in|of|void)$/.test(src.slice(Math.max(0, k - 7), k + 1))) {
        let inClass = false;
        for (i++; i < src.length && src[i] !== '\n'; i++) { const r = src[i]; if (r === '\\') { i++; continue; } if (r === '[') inClass = true; else if (r === ']') inClass = false; else if (r === '/' && !inClass) break; }
        continue;
      }
    }
    if (c === '{') depth++;
    else if (c === '}') { if (depth === 0 && close) return i; depth--; }
  }
  return src.length;
}
function skipTemplate(src, i) { // i at the opening backtick; returns the index of the closing one
  for (i++; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') { i++; continue; }
    if (c === '`') return i;
    if (c === '$' && src[i + 1] === '{') i = skipCode(src, i + 2, '}');
  }
  return src.length;
}

// The whole of one function (or block) in `src` that starts at `marker`: up to the brace matching its first '{'.
// Strings, template literals, regex literals and comments are skipped while counting braces.
export function block(src, marker, from = 0) {
  const at = src.indexOf(marker, from); assert.ok(at >= 0, `not found: ${marker}`);
  let i = src.indexOf('{', at);
  // a function declaration: its body starts after the parameter list (defaults may hold braces)
  const head = /^\s*(?:async\s+)?function\s*\*?\s*[\w$]*\s*\(/.exec(src.slice(at));
  if (head) { let p = at + head[0].length, d = 1; for (; p < src.length && d; p++) { if (src[p] === '(') d++; else if (src[p] === ')') d--; } i = src.indexOf('{', p); }
  const end = skipCode(src, i + 1, '}');
  assert.ok(end < src.length, `unbalanced: ${marker}`);
  return src.slice(at, end + 1);
}
