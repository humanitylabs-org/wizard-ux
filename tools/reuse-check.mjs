#!/usr/bin/env node
// PR-body reuse check (docs/COMPONENTS.md). CI: PR_BODY=<body> BASE=<base sha> node tools/reuse-check.mjs
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const UI = /^(web|android)\//;
const VISUAL_FILE = /^web\/.*\.(png|jpe?g|webp|gif|svg)$/i;
const VISUAL_LINE = /<canvas\b|getContext\(\s*['"](webgl2?|2d)|@keyframes\b/;

/** files: [{ path, added: [lines] }]. Returns a list of problems (empty = pass). */
export function checkReuse({ body = '', files = [], inventory = '' }) {
  const problems = [];
  // Drop HTML comments (the template's examples) without a regex: an unclosed comment drops the rest.
  const text = String(body).replace(/\r/g, '').split('<!--')
    .map((part, i) => { if (!i) return part; const end = part.indexOf('-->'); return end < 0 ? '' : part.slice(end + 3); }).join('');
  const ui = files.some(f => UI.test(f.path));
  const touchedInventory = files.some(f => f.path === 'docs/COMPONENTS.md');
  const head = text.match(/^[ \t]*\**Reuse:?\**:?[ \t]*(.*)$/im);
  if (!head) return ['PR body has no "Reuse:" block. See docs/COMPONENTS.md.'];
  if (/^n\/?a\b/i.test(head[1].trim())) {
    if (ui) problems.push('"Reuse: n/a" is only for PRs that change nothing under web/ or android/.');
    return problems;
  }
  const after = text.slice(head.index + head[0].length).split('\n');
  const lines = [];
  for (const l of after) {
    if (/^\s*[-*]\s+/.test(l)) lines.push(l); else if (l.trim() && lines.length) break;
  }
  const decl = lines.map(l => l.match(/\b(REUSE|EXTEND|NEW)\b\s*`?([^\s`(]*)/)).filter(Boolean);
  if (!decl.length) problems.push('"Reuse:" needs at least one "- <capability>: REUSE|EXTEND|NEW <entry point>" line.');
  if (lines.length !== decl.length) problems.push('Every Reuse line needs REUSE, EXTEND or NEW.');
  for (const [, kind, name] of decl) {
    if (kind === 'NEW') {
      if (!touchedInventory) problems.push('NEW needs a row added to docs/COMPONENTS.md in this PR.');
      continue;
    }
    const root = name.split(/[.(]/)[0];
    const known = new Set([...inventory.replace(/```[\s\S]*?```/g, '').matchAll(/`([^`]+)`/g)].flatMap(m => m[1].split(/[\s,;()/]+/)).map(t => t.split('.')[0]));
    if (!root || !known.has(root)) problems.push(`${kind} ${name || '(missing)'}: not an entry point in docs/COMPONENTS.md.`);
    if (kind === 'EXTEND' && !touchedInventory) problems.push(`EXTEND ${name}: update its docs/COMPONENTS.md row in this PR.`);
  }
  const visual = files.some(f => VISUAL_FILE.test(f.path) || (/^web\//.test(f.path) && f.added.some(l => VISUAL_LINE.test(l))));
  if (visual && !/^[ \t]*\**Visual:?\**:?[ \t]*\S/im.test(text)) {
    problems.push('This PR adds a drawn or animated element under web/: add "Visual:" with a side-by-side screenshot of the existing element and yours.');
  }
  return [...new Set(problems)];
}

function diffFiles(base) {
  const out = execFileSync('git', ['diff', '--unified=0', '--no-color', `${base}...HEAD`], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const files = []; let cur = null;
  for (const l of out.split('\n')) {
    const m = l.match(/^\+\+\+ b\/(.*)$/);
    if (m) { cur = { path: m[1], added: [] }; files.push(cur); continue; }
    if (cur && l.startsWith('+') && !l.startsWith('+++')) cur.added.push(l.slice(1));
  }
  return files;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const problems = checkReuse({
    body: process.env.PR_BODY || '',
    files: diffFiles(process.env.BASE || 'origin/main'),
    inventory: readFileSync(new URL('../docs/COMPONENTS.md', import.meta.url), 'utf8'),
  });
  if (problems.length) { for (const p of problems) console.error('✗ ' + p); process.exit(1); }
  console.log('✓ Reuse block OK');
}
