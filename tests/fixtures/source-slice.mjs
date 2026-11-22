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
