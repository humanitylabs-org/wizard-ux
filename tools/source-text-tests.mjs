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
// Usage: node tools/source-text-tests.mjs [--json] [--list] [dir]
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

function imports(src, readers = new Set()) {
  const names = new Set();
  const re = /(^|\n)\s*import\s+([^'";]*?)\s*from\s*['"]([^'"]+)['"]/g;
  for (const m of src.matchAll(re)) {
    const spec = m[3]; if (EXTERNAL_OK.test(spec) || isParts(spec)) continue;
    if (/^node:vm$|^vm$/.test(spec)) continue; // vm itself is matched by EXEC
    for (const part of m[2].replace(/[{}]/g, ',').split(',')) {
      const nm = part.trim().split(/\s+as\s+/).pop().replace(/^\*\s*as\s*/, '').trim();
      if (/^[\w$]+$/.test(nm)) (READER.test(nm) ? readers : names).add(nm);
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

const POSITIVE = /\bassert\s*\.\s*(match|ok|equal|strictEqual|deepEqual|deepStrictEqual|notEqual|notStrictEqual|throws|rejects)\s*\(|(^|[^\w$.])assert\s*\(/g;

export function classifyFile(src) {
  const code = codeOnly(src);
  const decls = topDecls(code);
  const importedReaders = new Set(), runs = new Set(imports(src, importedReaders));
  const ident = t => new Set([...t.matchAll(/(?<![\w$.])[A-Za-z_$][\w$]*/g)].map(x => x[0]));
  // top-level statements that run code (vm.runInNewContext(text, sandbox)) make the names they touch run code
  for (const stmt of topStatements(code)) if (!/^(?:export\s+)?(?:async\s+)?(?:function|class|const|let|var|import|test|it|describe)\b/.test(stmt) && EXEC.some(r => r.test(stmt))) for (const nm of ident(stmt)) if (decls.has(nm)) runs.add(nm);
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
        else positive = true;
      }
      kind = positive ? 'text' : 'absence';
    }
    tests.push({ name, kind, line: src.slice(0, at).split('\n').length });
    until = end;
  }
  return tests;
}

export function scan(dir = path.join(ROOT, 'tests')) {
  const files = {};
  for (const f of fs.readdirSync(dir).filter(f => /\.test\.mjs$/.test(f)).sort()) {
    files[f] = classifyFile(fs.readFileSync(path.join(dir, f), 'utf8'));
  }
  return files;
}

export function summary(files) {
  const s = { files: 0, textOnlyFiles: 0, filesRunningCode: 0, tests: 0, text: 0, runs: 0, absence: 0, rule: 0, other: 0 };
  for (const t of Object.values(files)) {
    s.files++; s.tests += t.length;
    for (const x of t) s[x.kind]++;
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

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2); const dir = args.find(a => !a.startsWith('--'));
  const files = scan(dir ? path.resolve(dir) : undefined);
  if (args.includes('--json')) console.log(JSON.stringify(textTests(files), null, 1));
  else if (args.includes('--list')) { for (const [f, t] of Object.entries(files)) for (const x of t) if (x.kind === 'text') console.log(`${f}:${x.line}\t${x.name}`); }
  else console.log(JSON.stringify(summary(files)));
}
