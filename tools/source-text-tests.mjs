#!/usr/bin/env node
// Finds tests that only check that some text exists in a source file (wizard-ux issue 1674).
//
// A test of that kind reads web/... as a string and asserts a regex or substring is in it, without importing or
// running the code. It passes while the feature is broken and fails on harmless refactors. Every node:test
// `test(...)` / `it(...)` block in tests/*.test.mjs is sorted into one of three kinds:
//   runs     - the block (or a file-level helper it uses) runs code: an import of a repo module, node:vm,
//              Function/eval, a child process, a browser, a server;
//   text     - it runs nothing and asserts that some text IS present (the kind issue 1674 removes);
//   absence  - it runs nothing and only asserts that text is NOT present (a lint-style rule: no personal paths,
//              no hex colours, no feature ids in core). These stay: they cannot pass while something is broken;
//   rule     - a repo-wide static rule over the source text (an inventory, an allowlist, files that must agree),
//              marked with a `// static-rule: <why>` comment line right above the test;
//   other    - it reads no source file at all (it checks test-local code or data).
// tests/source-text-tests.test.mjs keeps the `text` list from growing (tests/fixtures/source-text-tests.json).
//
// Each block also counts its source pins: positive assertions whose subject is source text (a regex or substring
// matched against a file read as text), also inside a block that runs code. A pin fails on a harmless refactor and
// can pass while the behaviour is broken; tests/fixtures/source-pins.json lists the files that still have them and
// only shrinks.
//
// Usage: node tools/source-text-tests.mjs [--json] [--list] [--pins] [--pin-list] [dir]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Small JS scanner: blanks out comments, strings, template text and regex literals (same length, so offsets stay),
// which lets bracket matching and keyword search work on code only.
export function codeOnly(src) {
  const out = src.split('');
  const blank = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' '; };
  let i = 0; let last = ''; // last significant char or word, to tell a regex from a division
  const tmplDepth = [];
  const regexAllowed = () => last === '' || /[(,=:[!&|?{};+\-*%<>~^]$/.test(last) ||
    /^(return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/.test(last);
  while (i < src.length) {
    const c = src[i]; const n = src[i + 1];
    if (c === '/' && n === '/') { const j = src.indexOf('\n', i); const e = j < 0 ? src.length : j; blank(i, e); i = e; continue; }
    if (c === '/' && n === '*') { const j = src.indexOf('*/', i + 2); const e = j < 0 ? src.length : j + 2; blank(i, e); i = e; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1; while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      blank(i + 1, j); i = j + 1; last = 'str'; continue;
    }
    if (c === '`' || (c === '}' && tmplDepth.length && tmplDepth[tmplDepth.length - 1] === 0)) {
      if (c === '}') tmplDepth.pop();
      let j = i + 1;
      while (j < src.length && src[j] !== '`' && !(src[j] === '$' && src[j + 1] === '{')) j += src[j] === '\\' ? 2 : 1;
      blank(i + 1, j);
      if (src[j] === '$') { tmplDepth.push(0); i = j + 2; last = '{'; continue; }
      i = j + 1; last = 'str'; continue;
    }
    if (c === '/' && regexAllowed()) {
      let j = i + 1; let cls = false;
      while (j < src.length && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false; else if (src[j] === '/' && !cls) break;
        j++;
      }
      blank(i + 1, j); j++; while (/[a-z]/i.test(src[j] || '')) j++;
      i = j; last = 'str'; continue;
    }
    if (tmplDepth.length) { if (c === '{') tmplDepth[tmplDepth.length - 1]++; else if (c === '}') tmplDepth[tmplDepth.length - 1]--; }
    if (/\s/.test(c)) { i++; continue; }
    if (/[\w$]/.test(c)) { let j = i; while (/[\w$]/.test(src[j] || '')) j++; last = src.slice(i, j); i = j; continue; }
    last = c; i++;
  }
  return out.join('');
}

function closeOf(code, open) { // index just past the bracket that closes code[open]
  const pairs = { '(': ')', '[': ']', '{': '}' }; const stack = [];
  for (let k = open; k < code.length; k++) {
    const c = code[k];
    if (pairs[c]) stack.push(pairs[c]);
    else if (c === ')' || c === ']' || c === '}') { stack.pop(); if (!stack.length) return k + 1; }
  }
  return code.length;
}

const EXEC = [
  /\bvm\s*\.\s*\w+/, /\b(runInContext|runInNewContext|runInThisContext|createContext|compileFunction)\s*\(/,
  /\bnew\s+(vm\.)?Script\s*\(/, /(^|[^\w$.])Function\s*\(/, /(^|[^\w$.])eval\s*\(/, /(^|[^\w$.])import\s*\(/,
  /(^|[^\w$.])(spawnSync|execFileSync|execSync|spawn|execFile|exec|fork)\s*\(/, /\.(spawnSync|execFileSync|execSync|spawn|execFile|fork)\s*\(/ /* not RegExp .exec( */, /\bnew\s+Worker\s*\(/,
  /\b(chromium|firefox|webkit|launch)\s*\(/, /\bcreateServer\s*\(/, /\bfetch\s*\(/, /\brequire\s*\(/,
];
const reEsc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Does code text mention the name as a whole identifier (not as a property)?
const mentions = (name, text) => new RegExp(`(^|[^\\w$.]|\\.\\.\\.)${reEsc(name)}(?![\\w$])`).test(text); // `...name` (a spread) counts
const isParts = spec => /(^|\/)[\w-]*parts\.mjs$/.test(spec); // fixtures that only join moved-out source text back
// an imported file reader or source string is not running code, wherever it comes from
const READER = /^(?!(?:create|make|build|new|load|run)[A-Z])(read\w*|root|\w*(Source|Src))$/; // createBetaSource() is a factory, not text
const EXTERNAL_OK = /^node:(test|assert|assert\/strict|fs|fs\/promises|path|url|crypto|os|util)$/;

// A fixture's export that is source text itself (`export const SRC = readFileSync(...)`) is read, not run.
const RAW_EXPORT = /^\s*(readFileSync|readFile|with\w*Parts|read\w*)\s*\(/;
function rawExports(spec, file) {
  if (!file || !/^\.\.?\//.test(spec)) return new Set();
  let text = ''; try { text = fs.readFileSync(path.resolve(path.dirname(file), spec), 'utf8'); } catch { return new Set(); }
  const out = new Set();
  for (const m of text.matchAll(/(^|\n)\s*export\s+(?:const|let|var)\s+([\w$]+)\s*=\s*([^\n;]*)/g)) if (RAW_EXPORT.test(m[3])) out.add(m[2]);
  return out;
}
function imports(src, readers = new Set(), file = null) {
  const names = new Set();
  const re = /(^|\n)\s*import\s+([^'";]*?)\s*from\s*['"]([^'"]+)['"]/g;
  for (const m of src.matchAll(re)) {
    const spec = m[3]; if (EXTERNAL_OK.test(spec) || isParts(spec)) continue;
    if (/^node:vm$|^vm$/.test(spec)) continue; // vm itself is matched by EXEC
    const raw = rawExports(spec, file);
    for (const part of m[2].replace(/[{}]/g, ',').split(',')) {
      const [orig, alias] = part.trim().replace(/^\*\s*as\s*/, '').split(/\s+as\s+/).map(x => x.trim());
      const nm = alias || orig;
      if (/^[\w$]+$/.test(nm)) (READER.test(nm) || raw.has(orig) ? readers : names).add(nm);
    }
  }
  return names;
}

function topStatements(code) { // rough top-level statements, split at depth-0 ';' or newline-before-keyword
  const out = []; let d = 0; let a = 0;
  for (let k = 0; k < code.length; k++) {
    const c = code[k];
    if (c === '{' || c === '(' || c === '[') d++; else if (c === '}' || c === ')' || c === ']') d--;
    else if (!d && (c === ';' || c === '\n')) { const t = code.slice(a, k).trim(); if (t) out.push(t); a = k + 1; }
  }
  const t = code.slice(a).trim(); if (t) out.push(t);
  return out;
}

function declarators(t) { // split `a = 1, { b, c } = f(x, y), d` at depth-0 commas
  const out = []; let d = 0; let a = 0;
  for (let k = 0; k < t.length; k++) {
    const c = t[k];
    if (c === '{' || c === '(' || c === '[') d++; else if (c === '}' || c === ')' || c === ']') d--;
    else if (!d && c === ',') { out.push(t.slice(a, k)); a = k + 1; }
  }
  out.push(t.slice(a));
  return out.map(x => x.trim()).filter(Boolean);
}

// Top-level declarations: name -> code text of the declaration.
function topDecls(code) {
  const decls = new Map(); let depth = 0;
  for (let k = 0; k < code.length; k++) {
    const c = code[k];
    if (c === '{' || c === '(' || c === '[') { depth++; continue; }
    if (c === '}' || c === ')' || c === ']') { depth--; continue; }
    if (depth) continue;
    const m = /^(?:export\s+)?(?:async\s+)?(?:function\s*\*?\s*([\w$]+)|class\s+([\w$]+)|(?:const|let|var)\s+)/.exec(code.slice(k, k + 200));
    if (!m || (k && /[\w$]/.test(code[k - 1]))) continue;
    // end: next top-level newline that starts a new statement
    let e = k + m[0].length; let d = 0;
    for (; e < code.length; e++) {
      const ch = code[e];
      if (ch === '{' || ch === '(' || ch === '[') d++; else if (ch === '}' || ch === ')' || ch === ']') d--;
      else if (!d && (ch === ';' || (ch === '\n' && /^\n(?:export\s|async\s|function\s|const\s|let\s|var\s|class\s|test\s*\(|it\s*\(|describe\s*\(|import\s)/.test(code.slice(e, e + 12))))) break;
    }
    const text = code.slice(k, e);
    if (m[1] || m[2]) decls.set(m[1] || m[2], text);
    else for (const one of declarators(text.slice(m[0].length))) { // `const a = x, b = read(...)`: each name gets its own text
      for (const nm of one.split('=')[0].matchAll(/[\w$]+/g)) decls.set(nm[0], one);
    }
    k = e;
  }
  return decls;
}

// `assert.deepEqual(src.match(/x/g) || [], [])`: nothing matched, an absence check
const EMPTY_EQ = (fn, arg) => /^deep(Strict)?Equal$/.test(fn) && /,\s*(\[\s*\]|\{\s*\})\s*(,[\s\S]*)?$/.test(arg);
const POSITIVE = /\bassert\s*\.\s*(match|ok|equal|strictEqual|deepEqual|deepStrictEqual|notEqual|notStrictEqual|throws|rejects)\s*\(|(^|[^\w$.])assert\s*\(/g;

export function classifyFile(src, file = null) {
  const code = codeOnly(src);
  const decls = topDecls(code);
  const importedReaders = new Set(), runs = new Set(imports(src, importedReaders, file));
  const ident = t => new Set([...t.matchAll(/(?<![\w$.])[A-Za-z_$][\w$]*/g)].map(x => x[0]));
  // top-level statements that run code (vm.runInNewContext(text, sandbox)) make the names they touch run code
  for (const stmt of topStatements(code)) if (!/^(?:export\s+)?(?:async\s+)?(?:function|class|const|let|var|import|test|it|describe)\b/.test(stmt) && EXEC.some(r => r.test(stmt))) for (const nm of ident(stmt)) if (decls.has(nm)) runs.add(nm);
  // `import '../web/core/x.js'` runs the module for its globals: a top-level name taken from globalThis / window runs code
  if (/(^|\n)\s*import\s*['"]\.\.?\/[^'"]+['"]/.test(src)) for (const [nm, text] of decls) if (/=\s*(globalThis|window)\.[\w$]+/.test(text)) runs.add(nm);
  const reads = new Set(importedReaders); // an imported reader / source string reads source text
  // Source text can also sit in a declaration inside a block (`for (...) { const css = read(...); test(...) }`): for
  // reading, every declaration at any depth counts (stricter: it can only turn 'other' into 'text' or 'absence').
  const anyDecls = new Map(decls);
  for (const m of code.matchAll(/(?<![\w$.])(?:const|let|var)\s+/g)) {
    let e = m.index + m[0].length; let d = 0;
    for (; e < code.length; e++) { const ch = code[e];
      if (ch === '{' || ch === '(' || ch === '[') d++; else if (ch === '}' || ch === ')' || ch === ']') { if (!d) break; d--; }
      else if (!d && (ch === ';' || ch === '\n')) break; }
    for (const one of declarators(code.slice(m.index + m[0].length, e))) for (const nm of one.split('=')[0].matchAll(/[\w$]+/g)) if (!anyDecls.has(nm[0])) anyDecls.set(nm[0], one);
  }
  const READ = /\b(readFileSync|readFile|readdirSync|readdir)\s*\(/;
  for (let changed = true; changed;) {
    changed = false;
    for (const [nm, text] of anyDecls) {
      if (reads.has(nm)) continue;
      if (READ.test(text) || [...reads].some(r => mentions(r, text.replace(/^[^=({]*/, '')))) { reads.add(nm); changed = true; }
    }
  }
  // Mark file-level helpers that run code, to a fixed point.
  for (let changed = true; changed;) {
    changed = false;
    for (const [nm, text] of decls) {
      if (runs.has(nm)) continue;
      if (EXEC.some(r => r.test(text)) || [...runs].some(r => mentions(r, text.replace(/^[^=({]*/, '')))) { runs.add(nm); changed = true; }
    }
  }
  // File-level helpers (not running code) that assert positively, to a fixed point through helpers they call.
  const positiveHelpers = new Set();
  const assertsPositively = text => { for (const a of text.matchAll(POSITIVE)) {
    const fn = a[1] || 'assert'; const o = text.indexOf('(', a.index + a[0].length - 1), arg = text.slice(o + 1, closeOf(text, o) - 1).trim();
    if ((fn === 'ok' || fn === 'assert') && /^\(?\s*!/.test(arg)) continue;
    if ((fn === 'equal' || fn === 'strictEqual') && /,\s*(-1|false|0|null|undefined)\s*(,|$)/.test(arg)) continue;
    if (fn === 'throws' || fn === 'rejects' || EMPTY_EQ(fn, arg)) continue;
    return true; } return false; };
  for (let changed = true; changed;) {
    changed = false;
    for (const [nm, text] of decls) {
      if (positiveHelpers.has(nm) || runs.has(nm)) continue;
      if (assertsPositively(text) || [...positiveHelpers].some(h => mentions(h, text.replace(/^[^=({]*/, '')))) { positiveHelpers.add(nm); changed = true; }
    }
  }
  // Source pins: what a name holds, resolved inside one test (its own declarations first, then the file's).
  // 'text' = source text or something cut / matched out of it; 'run' = the result of running code; null = neither.
  const IDS = t => new Set([...t.matchAll(/(?<![\w$.])[A-Za-z_$][\w$]*/g)].map(x => x[0]));
  const kindOf = (nm, local, seen = new Set()) => {
    if (seen.has(nm)) return null; seen.add(nm);
    if (!local.has(nm)) { if (runs.has(nm)) return 'run'; if (importedReaders.has(nm)) return 'text'; }
    const decl = local.get(nm) ?? decls.get(nm) ?? anyDecls.get(nm);
    if (!decl) return null;
    const rhs = decl.replace(/^[^=({]*/, '');
    if (EXEC.some(r => r.test(rhs))) return 'run';
    if (/\bJSON\.parse\s*\(/.test(rhs)) return null; // data (a catalog, a manifest), not source code
    if (READ.test(rhs)) return 'text';
    let text = false;
    for (const id of IDS(rhs)) { if (id === nm) continue; const k = kindOf(id, local, seen); if (k === 'run') return 'run'; if (k === 'text') text = true; }
    return text ? 'text' : null;
  };
  const tests = [];
  const re = /(^|[^\w$.])(test|it)(\s*\.\s*(only|skip|todo))?\s*\(/g;
  let m; let until = -1;
  while ((m = re.exec(code))) {
    const at = m.index + m[1].length; if (at < until) continue;
    const open = code.indexOf('(', at); const end = closeOf(code, open);
    const body = code.slice(open, end);
    const nameMatch = /^\(\s*(['"`])/.exec(src.slice(open, open + 4)) ? src.slice(open + 1).match(/^\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/) : null;
    const name = nameMatch ? nameMatch[2] : `(line ${src.slice(0, at).split('\n').length})`;
    const ran = EXEC.some(r => r.test(body)) || [...runs].some(r => mentions(r, body));
    let kind = 'runs';
    const touches = READ.test(body) || [...reads].some(r => mentions(r, body));
    const before = src.slice(0, at).split('\n').slice(-6, -1).reverse();
    let rule = false; for (const l of before) { if (/^\s*\/\/\s*static-rule:\s*\S/.test(l)) { rule = true; break; } if (!/^\s*\/\//.test(l)) break; }
    // source pins: positive assertions on source text, also inside a test that runs code (a harmless refactor of
    // the pinned line fails them, and they pass while the behaviour is broken)
    let pins = 0; const pinLines = [];
    if (!rule) {
      const local = new Map();
      for (const d of body.matchAll(/(?<![\w$.])(?:const|let|var)\s+/g)) {
        let e = d.index + d[0].length; let dd = 0;
        for (; e < body.length; e++) { const ch = body[e];
          if (ch === '{' || ch === '(' || ch === '[') dd++; else if (ch === '}' || ch === ')' || ch === ']') { if (!dd) break; dd--; }
          else if (!dd && (ch === ';' || ch === '\n')) break; }
        for (const one of declarators(body.slice(d.index + d[0].length, e))) for (const n of one.split('=')[0].matchAll(/[\w$]+/g)) if (!local.has(n[0])) local.set(n[0], one);
      }
      for (const a of body.matchAll(POSITIVE)) {
        const fn = a[1] || 'assert'; const argOpen = code.indexOf('(', open + a.index + a[0].length - 1);
        const argCode = code.slice(argOpen + 1, closeOf(code, argOpen) - 1);
        const arg = src.slice(argOpen + 1, closeOf(code, argOpen) - 1).trim();
        if ((fn === 'ok' || fn === 'assert') && /^\(?\s*!/.test(arg)) continue;
        if ((fn === 'equal' || fn === 'strictEqual') && /,\s*(-1|false|0|null|undefined|''|"")\s*(,|$)/.test(arg)) continue;
        if (fn === 'throws' || fn === 'rejects') continue;
        if (EMPTY_EQ(fn, arg)) continue;
        if (EXEC.some(r => r.test(argCode))) continue;
        let text = READ.test(argCode), run = false;
        for (const id of IDS(argCode)) { const k = kindOf(id, local); if (k === 'run') run = true; else if (k === 'text') text = true; }
        if (text && !run) { pins++; pinLines.push(src.slice(0, argOpen).split('\n').length); }
      }
    }
    if (!ran && rule) kind = 'rule';
    else if (!ran && !touches) kind = 'other';
    else if (!ran) {
      // a positive assertion is any assert call that is not a pure absence check
      let positive = false;
      for (const a of body.matchAll(POSITIVE)) {
        const fn = a[1] || 'assert'; const argOpen = code.indexOf('(', open + a.index + a[0].length - 1);
        const arg = src.slice(argOpen + 1, closeOf(code, argOpen) - 1).trim();
        if (fn === 'ok' || fn === 'assert') { if (!/^!/.test(arg) && !/^\(?\s*!/.test(arg)) positive = true; }
        else if (fn === 'equal' || fn === 'strictEqual') { if (!/,\s*(-1|false|0|null|undefined|''|"")\s*(,|$)/.test(arg)) positive = true; }
        else if (!EMPTY_EQ(fn, arg)) positive = true;
      }
      // a file-level helper the test calls that asserts positively counts as the test's own assertion
      if (!positive && [...positiveHelpers].some(h => mentions(h, body))) positive = true;
      kind = positive ? 'text' : 'absence';
    }
    tests.push({ name, kind, line: src.slice(0, at).split('\n').length, pins, pinLines });
    until = end;
  }
  return tests;
}

export function scan(dir = path.join(ROOT, 'tests')) {
  const files = {};
  for (const f of fs.readdirSync(dir).filter(f => /\.test\.mjs$/.test(f)).sort()) {
    files[f] = classifyFile(fs.readFileSync(path.join(dir, f), 'utf8'), path.join(dir, f));
  }
  return files;
}

export function summary(files) {
  const s = { files: 0, textOnlyFiles: 0, filesRunningCode: 0, tests: 0, text: 0, runs: 0, absence: 0, rule: 0, other: 0, pins: 0, filesWithPins: 0 };
  for (const t of Object.values(files)) {
    s.files++; s.tests += t.length;
    for (const x of t) { s[x.kind]++; s.pins += x.pins; }
    if (t.some(x => x.pins)) s.filesWithPins++;
    if (t.some(x => x.kind === 'runs')) s.filesRunningCode++;
    else if (t.some(x => x.kind === 'text')) s.textOnlyFiles++;
  }
  return s;
}

// The `text` tests, as { file: [name, ...] } (the shape of tests/fixtures/source-text-tests.json).
export function textTests(files) {
  const out = {};
  for (const [f, t] of Object.entries(files)) { const n = t.filter(x => x.kind === 'text').map(x => x.name); if (n.length) out[f] = n; }
  return out;
}

// Source pins per file, as { file: count } (the shape of tests/fixtures/source-pins.json).
export function pinCounts(files) {
  const out = {};
  for (const [f, t] of Object.entries(files)) { const n = t.reduce((a, x) => a + x.pins, 0); if (n) out[f] = n; }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2); const dir = args.find(a => !a.startsWith('--'));
  const files = scan(dir ? path.resolve(dir) : undefined);
  if (args.includes('--json')) console.log(JSON.stringify(textTests(files), null, 1));
  else if (args.includes('--pins')) console.log(JSON.stringify(pinCounts(files), null, 1));
  else if (args.includes('--pin-list')) { for (const [f, t] of Object.entries(files)) for (const x of t) for (const l of x.pinLines) console.log(`${f}:${l}\t${x.name}`); }
  else if (args.includes('--list')) { for (const [f, t] of Object.entries(files)) for (const x of t) if (x.kind === 'text') console.log(`${f}:${x.line}\t${x.name}`); }
  else console.log(JSON.stringify(summary(files)));
}
