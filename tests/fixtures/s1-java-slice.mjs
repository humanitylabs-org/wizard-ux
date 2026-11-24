// Run one method (or one constant) of the Android Java / iOS Swift sources in node:vm (wizard-ux issue 1674: tests
// run the code, not read it). There is no JVM or Swift toolchain on the test machines, and the methods these tests
// care about are plain logic whose Java spelling is already JavaScript apart from a few type words, so the slice is
// rewritten minimally (for-each `for (T x : xs)`, `catch (T e)`, diamond `new X<>(`) and run with recorder stand-ins
// (source-slice runRecording) for everything the test does not give. A missing method fails the run (block()).
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { block, runRecording } from './source-slice.mjs';

const ROOT = new URL('../../', import.meta.url);
export const java = p => readFileSync(new URL('android/app/src/main/java/ai/wizards/os/' + p, ROOT), 'utf8');
export const swift = p => readFileSync(new URL('ios/native/App/App/' + p, ROOT), 'utf8');

// a Java/Swift String as the slice sees it
export class JString { constructor(s) { this.s = String(s); } contains(x) { return this.s.includes(String(x?.s ?? x)); } toString() { return this.s; } }

export function asJs(code) {
  return code
    .replace(/for \((?:final )?[\w.<>[\]]+ (\w+) : /g, 'for (const $1 of ')
    .replace(/catch \((?:final )?[\w.| ]+ (\w+)\)/g, 'catch ($1)')
    .replace(/new ([\w.]+)<>\(/g, 'new $1(');
}

// The body of the method that starts at `signature` (Java `void onStop()`, Swift `static func looksLikeWizard`).
export function body(src, signature) {
  const whole = block(src, signature);
  return whole.slice(whole.indexOf('{') + 1, -1);
}

// Run that body as a method of a subclass of `base` (so `super.x()` reaches base), with `this` = the instance,
// `args` bound by name, and every other free name from `scope` or a recorder. Returns { value, calls, self }.
export function method(src, signature, { args = {}, scope = {}, base = class {}, expression = false } = {}) {
  let code = asJs(body(src, signature));
  if (expression) code = 'return (' + code + ');';
  const names = Object.keys(args);
  const ctx = { ...scope, __Base: base, __args: args };
  runRecording(`var __Slice = class extends __Base { __run(${names.join(', ')}) { ${code}\n} };`, ctx);
  const self = new ctx.__Slice();
  const value = self.__run(...names.map(n => args[n]));
  return { value, calls: ctx.calls, self, ctx };
}

// The value of one `static final <type> NAME = <expr>;` (Java) given the names its initialiser uses.
export function constant(src, name, scope = {}) {
  const m = new RegExp(`\\b${name} = ([^;]+);`).exec(src);
  if (!m) throw new Error('no constant ' + name);
  return vm.runInNewContext(m[1], { ...scope });
}

// One statement that starts at `marker` (up to its `;`), run with `scope`.
export function statement(src, marker, scope = {}) {
  const at = src.indexOf(marker);
  if (at < 0) throw new Error('no statement ' + marker);
  return runRecording(asJs(src.slice(at, src.indexOf(';', at) + 1)), scope);
}
