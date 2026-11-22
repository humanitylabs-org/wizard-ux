// Run a GitHub Actions workflow file the way Actions reads it (wizard-ux issue 1674: tests run the code, they do not
// read it as text). parseYaml() reads the block-style YAML subset our workflows use (mappings, lists, `|` scalars,
// quoted and plain scalars, comments); expr() evaluates a `${{ }}` expression (==, !=, ||, &&, !, fromJSON, property
// paths, string literals); jobsFor(wf, ctx) lists the jobs whose `if:` passes; runStep() runs a step's `run:` script in
// bash with the step's env expanded from the context, so a test can watch what the real script does.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const strip = line => { // drop a trailing comment outside quotes
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { if (i === 0 || /[\s:\-[,{]/.test(line[i - 1])) q = c; continue; }
    if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i).replace(/\s+$/, '');
  }
  return line.replace(/\s+$/, '');
};

function scalar(t) {
  t = t.trim();
  if (t === '' || t === '~' || t === 'null') return null;
  if (t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
  if (t.startsWith('"') && t.endsWith('"')) return JSON.parse(t);
  if (t === 'true') return true; if (t === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (t.startsWith('[') && t.endsWith(']')) return t.slice(1, -1).split(',').map(s => scalar(s)).filter(v => v !== null);
  return t;
}

export function parseYaml(src) {
  const raw = src.split('\n');
  const lines = []; // { indent, text, n }
  for (let n = 0; n < raw.length; n++) lines.push({ n, raw: raw[n] });
  let i = 0;
  const sig = () => { // next significant line
    while (i < lines.length) { const t = strip(lines[i].raw); if (t.trim()) return { indent: t.length - t.trimStart().length, text: t.trim() }; i++; }
    return null;
  };
  function blockScalar(parentIndent) {
    const out = []; let ind = null;
    while (i < lines.length) {
      const r = lines[i].raw;
      if (!r.trim()) { out.push(''); i++; continue; }
      const k = r.length - r.trimStart().length;
      if (k <= parentIndent) break;
      if (ind === null) ind = k;
      out.push(r.slice(ind)); i++;
    }
    while (out.length && out[out.length - 1] === '') out.pop();
    return out.join('\n') + '\n';
  }
  function value(rest, indent) { // after "key:" or "- "
    if (rest === '|' || rest === '|-') { i++; const s = blockScalar(indent); return rest === '|-' ? s.replace(/\n$/, '') : s; }
    if (rest !== '') { i++; return scalar(rest); }
    i++; const nx = sig();
    if (!nx || nx.indent < indent || (nx.indent === indent && !nx.text.startsWith('- '))) return null;
    return node(nx.indent);
  }
  function node(indent) {
    const first = sig();
    if (first.text.startsWith('- ') || first.text === '-') {
      const arr = [];
      for (let l = sig(); l && l.indent === indent && (l.text.startsWith('- ') || l.text === '-'); l = sig()) {
        const rest = l.text.slice(2).trim();
        const m = /^([\w.-]+|"[^"]*"|'[^']*'):(\s+|$)(.*)$/.exec(rest);
        if (m) { // a mapping inside a list item: re-read this line as a key at the item's inner indent
          const inner = indent + 2;
          lines[i] = { n: lines[i].n, raw: ' '.repeat(inner) + rest };
          arr.push(map(inner));
        } else arr.push(value(rest, indent));
      }
      return arr;
    }
    return map(indent);
  }
  function map(indent) {
    const obj = {};
    for (let l = sig(); l && l.indent === indent && !l.text.startsWith('- '); l = sig()) {
      const m = /^([\w.$/-]+|"[^"]*"|'[^']*'):(?:\s+(.*))?$/.exec(l.text);
      if (!m) throw new Error(`yaml: cannot read line ${lines[i].n + 1}: ${l.text}`);
      obj[scalar(m[1])] = value((m[2] || '').trim(), indent);
    }
    return obj;
  }
  sig();
  return node(0);
}

export const readWorkflow = url => parseYaml(readFileSync(url, 'utf8'));

// A `${{ }}` expression (or a bare `if:` condition) against a context like { github: {...}, inputs: {...} }.
export function expr(text, ctx) {
  const src = String(text).replace(/^\s*\$\{\{\s*|\s*\}\}\s*$/g, '');
  const toks = [...src.matchAll(/\s*('(?:[^']|'')*'|==|!=|\|\||&&|!|\(|\)|,|[\w.-]+)/g)].map(m => m[1]);
  let p = 0;
  const peek = () => toks[p], eat = t => { if (toks[p] !== t) throw new Error(`expr: expected ${t} in ${src}`); p++; };
  const path = name => name.split('.').reduce((o, k) => (o == null ? undefined : o[k]), ctx);
  const funcs = { fromJSON: s => JSON.parse(s), toJSON: v => JSON.stringify(v), contains: (a, b) => (Array.isArray(a) ? a.includes(b) : String(a).includes(b)) };
  function atom() {
    const t = toks[p++];
    if (t === '(') { const v = or(); eat(')'); return v; }
    if (t === '!') return !atom();
    if (t.startsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
    if (t === 'true') return true; if (t === 'false') return false; if (t === 'null') return null;
    if (/^\d/.test(t)) return Number(t);
    if (peek() === '(') { eat('('); const args = []; while (peek() !== ')') { args.push(or()); if (peek() === ',') p++; } eat(')'); return funcs[t](...args); }
    return path(t);
  }
  function cmp() { let v = atom(); while (peek() === '==' || peek() === '!=') { const op = toks[p++]; const w = atom(); v = op === '==' ? v === w : v !== w; } return v; }
  function and() { let v = cmp(); while (peek() === '&&') { p++; const w = cmp(); v = v && w; } return v; }
  function or() { let v = and(); while (peek() === '||') { p++; const w = and(); v = v || w; } return v; }
  const v = or(); if (p !== toks.length) throw new Error(`expr: trailing tokens in ${src}`);
  return v;
}

// Replace every ${{ }} inside a string value.
export const interpolate = (s, ctx) => String(s).replace(/\$\{\{([^}]*)\}\}/g, (_, e) => { const v = expr(e, ctx); return v == null ? '' : String(v); });

export const jobsFor = (wf, ctx) => Object.keys(wf.jobs).filter(name => wf.jobs[name].if == null || expr(wf.jobs[name].if, ctx));

export function runsOn(job, ctx) { const r = job['runs-on']; return /\$\{\{/.test(r) ? expr(r, ctx) : r; }

export const step = (job, name) => {
  const s = job.steps.find(st => st.name === name || st.uses === name);
  if (!s) throw new Error(`no step ${name}`);
  return s;
};

// Run step.run in bash, cwd `cwd`, with the workflow env, the step env (expanded from ctx) and `env` on top.
export function runStep(wf, s, { ctx = {}, cwd, env = {} } = {}) {
  const stepEnv = {};
  for (const [k, v] of Object.entries({ ...(wf.env || {}), ...(s.env || {}) })) stepEnv[k] = interpolate(v, ctx);
  return spawnSync('bash', ['-e', '-c', s.run], { cwd, env: { PATH: process.env.PATH, HOME: process.env.HOME, ...stepEnv, ...env }, encoding: 'utf8' });
}
