#!/usr/bin/env node
// Trusted, dependency-free app gate: inspect git data, never execute app code.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const INVENTORY_URL = 'https://github.com/humanitylabs-org/wizard-ux/blob/main/docs/COMPONENTS.md';
const SOURCE = /\.(?:[cm]?[jt]sx?|html?|vue|svelte|css|scss|py|java|kt|swift)$/i;
const rules = [
  { id: 'voice', row: 'Mic, camera, screen capture', api: 'WizardApp.capture.start / pending / ack; WizardApp.voice.transcribe; WizardApp.voiceInput.register',
    pattern: /\bgetUserMedia\s*\(|\bnew\s+(?:(?:window|globalThis)\s*\.\s*)?MediaRecorder\b|\bcreateMediaStreamSource\s*\(|\b(?:mic|capture)\w*\s*=\s*new\s+(?:(?:window|globalThis)\.)?(?:webkit)?AudioContext\b/i },
  { id: 'chat', row: 'Talk to an agent: composer, Stop/retry/outbox, models, dictation, attachments', api: 'WizardApp.nav.openThread(sessionId, {reply})',
    pattern: /\b(?:chat[-_]?composer|chat[-_]?transcript|app-chat|renderChat(?:Messages|Transcript)?|streamChat|sendChatMessage)\b|\b(?:class|function)\s+(?:ChatComposer|ChatTranscript|ChatClient)\b|(?:fetch|EventSource)\s*\([^\n]*(?:\/chat\/completions|\/api\/chat\b)|\bstream\s*:\s*true\b|<textarea\b[^>]*(?:chat|message[-_]?input)|(?:class|id)\s*=\s*["'][^"']*(?:chat[-_](?:messages|input)|message[-_]list)/i },
  { id: 'orb', row: 'The orb, any size', api: 'Orb.create(canvas, fallback, {R})',
    pattern: /\b(?:function|class)\s+(?:renderOrb|drawOrb|OrbRenderer)\b|\b(?:renderOrb|drawOrb)\s*[:=]|<(?:canvas|svg|img)\b[^>]*\borb\b|\borb\b[^\n]*(?:getContext\s*\(|lottie\b)|(?:@keyframes|animation\s*:)\s*[^\n]*orb|\.orb\b[^\n]*\{/i },
  { id: 'scroll', row: 'Reading place in an app document', api: 'WizAppReadingPosition (automatic shell-owned reading place)',
    pattern: /\b(?:localStorage|sessionStorage)\s*(?:\?\.)?\s*\.?(?:setItem|\[)\s*\(?[^\n]*(?:scroll|reading[-_]?position)|\b(?:saveScrollPosition|storeScrollPosition|persistScrollPosition|scrollPositionStore|readingPositionStore)\b|\b(?:localStorage|sessionStorage)\s*\[[^\n]*(?:scroll|reading)/i },
];

export function parseAddedDiff(diff) {
  const files = []; let file, line = 0;
  for (const text of diff.split('\n')) {
    if (text.startsWith('diff --git ')) { file = null; continue; }
    if (text.startsWith('+++ b/')) { file = { path: text.slice(6), added: [] }; files.push(file); continue; }
    const hunk = text.match(/^@@ .* \+(\d+)(?:,\d+)? @@/);
    if (hunk) { line = Number(hunk[1]); continue; }
    if (file && text.startsWith('+')) file.added.push({ line: line++, text: text.slice(1) });
    else if (text.startsWith(' ')) line++;
  }
  return files;
}

function withoutComments(body) { return String(body).replace(/<!--[\s\S]*?(?:-->|$)/g, ''); }
function rows(inventory) { return inventory.split('\n').filter(l => /^\|[^|]+\|/.test(l)).map(l => ({ name: l.split('|')[1].trim(), text: l })); }

export function checkAppReuse({ body = '', files = [], inventory = '' }) {
  const text = withoutComments(body);
  const problems = [];
  const declarations = [...text.matchAll(/^\s*(?:[-*]\s+)?(?:[^\n:]+:\s*)?(REUSE|EXTEND|NEW):?\s+([^\n]+)$/gm)];
  if (!/^\s*\**Reuse:?\**:?\s*$/im.test(text) || !declarations.length) {
    problems.push('PR body needs a Reuse: block with REUSE / EXTEND / NEW lines, including CI-only PRs.');
  }
  const inventoryRows = rows(inventory);
  const addedRows = files.filter(f => f.path === 'docs/COMPONENTS.md').flatMap(f => rows(f.added.map(l => l.text).join('\n')));
  const newRows = new Set();
  for (const [declaration, kind, value] of declarations) {
    if (kind === 'NEW') {
      // Deliberate, review-visible exception, not a generic "NEW because" bypass.
      const name = value.replace(/^`|`$/g, '').trim();
      if (!addedRows.some(r => r.name === name) || inventoryRows.some(r => r.name === name)) {
        problems.push(`NEW: ${name}: name the exact NEW row added to docs/COMPONENTS.md in this PR (not an existing shared row).`);
      } else {
        for (const rule of rules) if (new RegExp(`^\\s*[-*]?\\s*${rule.id}:\\s*NEW:`, 'i').test(declaration)) newRows.add(rule.id);
      }
    } else {
      const api = value.replace(/^`/, '').split(/[\s`(]/)[0];
      if (!api || !inventoryRows.some(r => r.text.includes(api))) problems.push(`${kind} ${api || '(missing)'} is not an entry point in wizard-ux main's docs/COMPONENTS.md.`);
    }
  }
  for (const file of files.filter(f => SOURCE.test(f.path))) {
    // Join adjacent added lines only: formatting across new lines cannot evade
    // capture checks, and unchanged/context code never becomes a new finding.
    const chunks = [];
    for (const added of file.added) {
      const last = chunks.at(-1);
      if (last && last.end + 1 === added.line) { last.text += '\n' + added.text; last.end = added.line; }
      else chunks.push({ line: added.line, end: added.line, text: added.text });
    }
    const sharedOrb = file.added.some(l => /\bOrb\s*\.\s*create\s*\(/.test(l.text));
    for (const chunk of chunks) {
      for (const rule of rules) {
        // A canvas is a valid Orb.create host, not an orb implementation itself.
        const candidate = rule.id === 'orb' && sharedOrb
          ? chunk.text.replace(/<(?:canvas|svg|img)\b[^>]*\borb\b[^>]*>/gi, m => m.replace(/[^\n]/g, ' ')) : chunk.text;
        const match = rule.pattern.exec(candidate);
        if (!match || newRows.has(rule.id)) continue;
        const line = chunk.line + chunk.text.slice(0, match.index).split('\n').length - 1;
        problems.push(`${file.path}:${line}: duplicate ${rule.id} implementation. COMPONENTS row "${rule.row}": use ${rule.api}. Only an explicit NEW: <new row title> plus that added docs/COMPONENTS.md row can waive this finding.`);
      }
    }
  }
  return [...new Set(problems)].map(p => `${p}\n  ${INVENTORY_URL}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  if (!event.pull_request) throw new Error('App reuse gate requires a pull_request event');
  const diff = execFileSync('git', ['-c', 'core.quotePath=false', 'diff', '--no-ext-diff', '--no-textconv', '--unified=0', '--no-color', `${event.pull_request.base.sha}...${event.pull_request.head.sha}`], { cwd: process.env.APP_REPO, encoding: 'utf8', maxBuffer: 128 << 20 });
  const problems = checkAppReuse({ body: event.pull_request.body || '', files: parseAddedDiff(diff), inventory: readFileSync(new URL('../docs/COMPONENTS.md', import.meta.url), 'utf8') });
  if (problems.length) { for (const p of problems) console.error('✗ ' + p); process.exit(1); }
  console.log('✓ App reuse declarations and added-line duplicate checks passed (existing code not scanned).');
}
