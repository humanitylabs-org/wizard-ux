#!/usr/bin/env node
// Wizard OS PR agent review. One reviewer for every humanitylabs-org repo (called through
// .github/workflows/pr-agent-review.yml). It reads the PR's files and patches through the GitHub API,
// never checks out or runs PR code, and posts one COMMENT review per head commit.
//
// It flags four things the team agreed to catch before an admin merges (23 Oct 2026):
//   1. look/UX taste changed for everyone instead of in the contributor's own skin;
//   2. likely breaking changes (removed exports, routes, files, manifest fields, env vars, workflows);
//   3. secrets, personal paths and private hostnames;
//   4. docs/COMPONENTS.md REUSE / EXTEND / NEW problems and hand-rolled shared capabilities.
// It is advisory: approval and merge stay with a human admin who is not the author.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { checkReuse } from './reuse-check.mjs';

export const MARKER = '<!-- wizard-pr-agent-review';

// Split private identifiers so this file does not itself trip tests/portable-paths.test.mjs.
const PRIVATE = [
  { re: new RegExp('/home/' + 'telos(?:/|\\b)'), what: 'the owner\'s home directory' },
  { re: new RegExp('/Users/' + 'thales(?:/|\\b)'), what: 'the build Mac\'s home directory' },
  { re: new RegExp('/Volumes/' + 'ThalesMedia(?:/|\\b)'), what: 'the build Mac\'s media volume' },
  { re: /\b[a-z0-9-]+\.tail[0-9a-f]{4,}\.ts\.net\b|\btail[0-9a-f]{4,}\.ts\.net\b/i, what: 'a private tailnet hostname' },
  { re: /\b100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b/, what: 'a tailnet IP address' },
  { re: /\/home\/(?!runner\b|user\b|node\b|app\b|wizard\b|ubuntu\b)[a-z][a-z0-9_-]+\//, what: 'a personal home directory' },
  { re: /\/Users\/(?!runner\b|Shared\b|you\b|me\b|<)[A-Za-z][\w.-]+\//, what: 'a personal macOS home directory' },
];

const SECRETS = [
  { re: /AKIA[0-9A-Z]{16}/, what: 'AWS access key' },
  { re: /\bgh[pousr]_[A-Za-z0-9]{30,}/, what: 'GitHub token' },
  { re: /\bgithub_pat_[A-Za-z0-9_]{40,}/, what: 'GitHub token' },
  { re: /\bsk-ant-[A-Za-z0-9_-]{20,}/, what: 'Anthropic key' },
  { re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/, what: 'OpenAI-style key' },
  { re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/, what: 'Slack token' },
  { re: /\bAIza[0-9A-Za-z_-]{35}\b/, what: 'Google API key' },
  { re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY/, what: 'private key' },
  { re: /\bnsec1[02-9ac-hj-np-z]{50,}\b/, what: 'Nostr secret key' },
  { re: /\b\d{8,10}:AA[A-Za-z0-9_-]{30,}\b/, what: 'Telegram bot token' },
  { re: /(?:api[_-]?key|secret|token|password|passwd)["']?\s*[:=]\s*["'][A-Za-z0-9_\-+/=]{20,}["']/i, what: 'hard-coded credential' },
];
const SECRET_FILE = /(^|\/)(\.env(\.[\w-]+)?|id_(rsa|ed25519)|.*\.pem|.*\.p12|.*\.keystore|.*\.jks|credentials\.json|auth\.json)$/i;
const EXAMPLE_FILE = /\.(example|sample|template)$|(^|\/)\.env\.example$/i;

const TEST_PATH = /(^|\/)(tests?|__tests__|spec|fixtures|qa|evidence|docs\/evidence)\/|\.test\.|\.spec\.|_test\./i;
const CODE_PATH = /\.(m?js|cjs|ts|tsx|jsx|py|go|rs|sh|kt|java|swift)$/i;

// Removed definitions a caller elsewhere may still use.
const DEFINITIONS = [
  { re: /^\s*export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/, kind: 'export' },
  { re: /^\s*export\s+default\s+(?:async\s+)?(?:function|class)\s*([A-Za-z_$][\w$]*)?/, kind: 'default export' },
  { re: /^\s*module\.exports(?:\.([A-Za-z_$][\w$]*))?\s*=/, kind: 'export' },
  { re: /\b(?:app|router|server|fastify|api)\.(get|post|put|patch|delete|all|use)\(\s*['"`]([^'"`]+)['"`]/, kind: 'route', group: 2 },
  { re: /@(?:app|router|bp|api)\.(?:get|post|put|patch|delete|route)\(\s*['"]([^'"]+)['"]/, kind: 'route' },
  { re: /^(?:async\s+)?def\s+([a-zA-Z]\w*)\s*\(/, kind: 'Python function' },
  { re: /^\s*\.add_parser\(\s*['"]([\w-]+)['"]|add_parser\(\s*['"]([\w-]+)['"]/, kind: 'CLI command' },
  { re: /^\s*window\.(Wiz\w+|Wos\w+|WizardApp)\s*=/, kind: 'shell global' },
];
const ENV_USE = /process\.env\.([A-Z][A-Z0-9_]{2,})|os\.environ(?:\.get)?\(?\[?\s*['"]([A-Z][A-Z0-9_]{2,})['"]|getenv\(\s*['"]([A-Z][A-Z0-9_]{2,})['"]/g;

// Apps table in docs/COMPONENTS.md: things apps must not hand-roll.
const HAND_ROLLED = [
  { re: /\bgetUserMedia\s*\(|\bnew\s+MediaRecorder\b/, use: 'WizardApp.capture.start / pending / ack', need: 'Mic, camera, screen capture' },
  { re: /\bnavigator\.share\s*\(/, use: 'WizardApp.share.text / file', need: 'Share text or a file out' },
  { re: /\bserviceWorker\.register\s*\(/, use: 'WizardApp.update.hold', need: 'Protect unsaved work from updates' },
  { re: /\bnew\s+EventSource\s*\(|text\/event-stream/, use: 'WizardApp.nav.openThread(sessionId, {reply})', need: 'Talk to an agent about app content' },
  { re: /prefers-color-scheme|localStorage\.(?:get|set)Item\(\s*['"][^'"]*theme/i, use: 'WizardApp.theme.get / onChange and --wz-* roles', need: 'Skin, tokens, light/dark' },
  { re: /\bwindow\.open\s*\(/, use: 'WizLinks (web/core/links.js)', need: 'Links: in-app sheet' },
];

const OWNER_SKINS = ['nebula', 'grove', 'tide', 'ember', 'signal'];
const SHELL_LOOK = /^web\/(core\/)?(base|polish|styles|skins|chats|settings|desks|home-surfaces)\.css$|^web\/[^/]+\.css$/;

/** Parse a GitHub unified patch into added/removed lines. */
export function parsePatch(patch = '') {
  const added = []; const removed = [];
  let newLine = 0;
  for (const l of String(patch).split('\n')) {
    const h = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (h) { newLine = Number(h[1]); continue; }
    if (l.startsWith('+') && !l.startsWith('+++')) { added.push({ line: newLine, text: l.slice(1) }); newLine++; }
    else if (l.startsWith('-') && !l.startsWith('---')) removed.push(l.slice(1));
    else if (!l.startsWith('\\')) newLine++;
  }
  return { added, removed };
}

function defs(lines) {
  const out = new Map();
  for (const text of lines) {
    for (const d of DEFINITIONS) {
      const m = text.match(d.re);
      if (!m) continue;
      const name = d.group ? m[d.group] : (m[1] || m[2] || (d.kind === 'default export' ? 'default' : ''));
      if (name && !name.startsWith('_')) out.set(`${d.kind}:${name}`, { kind: d.kind, name });
    }
  }
  return out;
}

function envNames(lines) {
  const s = new Set();
  for (const t of lines) for (const m of t.matchAll(ENV_USE)) s.add(m[1] || m[2] || m[3]);
  return s;
}

function frontMatterKeys(lines) {
  return new Set(lines.map(t => t.match(/^([a-z][\w-]*):/i)?.[1]).filter(Boolean));
}

function tierOf(title = '', labels = []) {
  const l = labels.map(x => String(x).toLowerCase());
  if (l.includes('tier: opinionated') || /^opinionated/i.test(title)) return 'opinionated';
  if (l.includes('tier: strong suggestion') || /^strong suggestion/i.test(title)) return 'strong';
  if (l.includes('tier: recommended fix') || /^recommended fix/i.test(title)) return 'fix';
  if (l.includes('tier: maintenance') || /^maintenance/i.test(title)) return 'maintenance';
  return '';
}

/**
 * pr: { repo: 'owner/name', title, body, author, labels: [names] }
 * files: [{ filename, status, previous_filename?, patch? }] (GitHub pulls/files shape)
 * inventory: text of docs/COMPONENTS.md
 * Returns { findings: [{ area, severity: 'blocker'|'check'|'note', file?, line?, text }] }.
 */
export function reviewPR({ pr = {}, files = [], inventory = '' }) {
  const repoName = String(pr.repo || '').split('/').pop();
  const isUx = repoName === 'wizard-ux';
  const tier = tierOf(pr.title, pr.labels || []);
  const labels = (pr.labels || []).map(x => String(x).toLowerCase());
  const findings = [];
  const add = (area, severity, text, file, line) => findings.push({ area, severity, text, file, line });
  const parsed = files.map(f => ({ ...f, ...parsePatch(f.patch) }));

  // 3. Secrets and private paths (added lines only; tests and evidence included, they are public too).
  for (const f of parsed) {
    if (SECRET_FILE.test(f.filename) && !EXAMPLE_FILE.test(f.filename) && f.status !== 'removed') {
      add('secrets', 'blocker', `\`${f.filename}\` looks like a credential file. Keep it out of git and load it from the environment or a secret store.`, f.filename);
    }
    const seen = new Set();
    for (const { line, text } of f.added) {
      for (const s of SECRETS) {
        if (s.re.test(text) && !/example|placeholder|dummy|fake|xxxx|<[^>]+>|\$\{/i.test(text)) {
          add('secrets', 'blocker', `Possible ${s.what} added. Rotate it if it is real, then remove it and read it from the environment.`, f.filename, line);
          break;
        }
      }
      for (const p of PRIVATE) {
        if (p.re.test(text) && !seen.has(p.what)) {
          seen.add(p.what);
          add('private paths', 'blocker', `Adds ${p.what}. Machine-specific paths and hosts come from env vars or config (see AGENTS.md, Safety).`, f.filename, line);
        }
      }
    }
  }

  // 1. Taste for everyone instead of in your own skin (wizard-ux shell).
  if (isUx) {
    const ownSkinOnly = parsed.length > 0 && parsed.every(f => /^web\/skins\/[^/]+\//.test(f.filename) || f.filename === 'web/core/skins.js');
    for (const f of parsed) {
      const n = f.filename;
      if (n === 'tests/fixtures/owner-skins.json') {
        add('global look', 'blocker', 'Changes the fingerprint of James\'s skins. That needs James\'s explicit approval named in the commit message.', n);
      }
      if (n === 'web/core/skins.js') {
        const touched = [...f.added, ...f.removed.map(text => ({ text }))]
          .filter(({ text }) => OWNER_SKINS.some(id => new RegExp(`id:\\s*['"]${id}['"]`).test(text)));
        if (touched.length) add('global look', 'blocker', `Edits one of James's skins (${OWNER_SKINS.join(', ')}). Put the change in your own skin, or add \`needs: james review\` to make it the default for everyone.`, n, touched[0].line);
      }
      if (n === 'web/core/base.css') {
        add('global look', tier === 'fix' || tier === 'maintenance' ? 'check' : 'blocker', 'Changes the base shell look every skin inherits. Taste belongs in your own skin (`web/skins/<yours>/skin.css`) or in My skin; only a bug fix belongs here.', n);
      } else if (SHELL_LOOK.test(n) && f.added.length) {
        const literal = f.added.find(({ text }) => /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i.test(text) && !/var\(--/.test(text));
        const font = f.added.find(({ text }) => /font-family/i.test(text));
        if (font) add('global look', 'blocker', 'Adds a shell-wide font rule. Scope fonts to your own skin (`html[data-skin="<yours>"]`).', n, font.line);
        if (literal) add('global look', 'check', 'Adds a literal colour to shared shell CSS. Use the `--wz-*` / skin tokens so every skin keeps working.', n, literal.line);
        if (tier === 'opinionated' || tier === 'strong') {
          add('global look', tier === 'opinionated' ? 'blocker' : 'check', `Changes shared shell styling in a ${tier === 'opinionated' ? 'taste' : 'suggestion'} PR. That changes the look for every install: move it into your own skin, or add \`needs: james review\` if it should become the default.`, n);
        }
      }
      if (/^web\/(core\/)?[^/]+\.js$/.test(n) && n !== 'web/core/skins.js' && tier === 'opinionated') {
        const settings = f.added.find(({ text }) => /WosSettings\.register\s*\(/.test(text));
        add('global look', 'blocker', settings
          ? 'Adds a Settings toggle for a preference. One person\'s taste goes in their own skin (`skin.js` hooks), never a Settings toggle or core code.'
          : 'Changes shared shell code in an opinionated PR. Taste goes in your own skin (`web/skins/<yours>/skin.js`); core changes need `needs: james review`.', n, settings?.line);
      }
    }
    if (ownSkinOnly && parsed.some(f => f.filename.startsWith('web/skins/'))) {
      add('global look', 'note', 'Touches only a contributor skin package. Good: this is the lane for taste.');
    }
  }

  // 2. Breaking changes.
  const addedByFile = new Map(parsed.map(f => [f.filename, f.added.map(a => a.text)]));
  const allAdded = parsed.flatMap(f => f.added.map(a => a.text));
  const addedDefs = defs(allAdded);
  for (const f of parsed) {
    const n = f.filename;
    if (f.status === 'removed' && !TEST_PATH.test(n) && !/\.(md|txt|png|jpe?g|webp|gif|svg)$/i.test(n)) {
      add('breaking', 'check', `Deletes \`${n}\`. Check nothing still imports, loads or links it (other repos and installed boxes included).`, n);
    }
    if (f.status === 'renamed' && f.previous_filename && CODE_PATH.test(n) && !TEST_PATH.test(n)) {
      add('breaking', 'check', `Renames \`${f.previous_filename}\` to \`${n}\`. Update every import and loader, or keep a shim for one release.`, n);
    }
    if (TEST_PATH.test(n)) continue;
    if (CODE_PATH.test(n)) {
      const gone = [...defs(f.removed)].filter(([k]) => !addedDefs.has(k));
      for (const [, d] of gone.slice(0, 6)) {
        add('breaking', 'check', `Removes ${d.kind} \`${d.name}\`. If another module, repo, app or box calls it, keep it (or a compatible alias) for one release.`, n);
      }
      const envGone = [...envNames(f.removed)].filter(e => !envNames(allAdded).has(e));
      if (envGone.length) add('breaking', 'check', `Stops reading env var${envGone.length > 1 ? 's' : ''} ${envGone.map(e => `\`${e}\``).join(', ')}. Existing installs that set it lose that setting silently.`, n);
    }
    if (/(^|\/)wizard\.md$/.test(n)) {
      const keysGone = [...frontMatterKeys(f.removed)].filter(k => !frontMatterKeys(addedByFile.get(n) || []).has(k));
      if (keysGone.length) add('breaking', 'check', `Removes manifest field${keysGone.length > 1 ? 's' : ''} ${keysGone.map(k => `\`${k}\``).join(', ')} from wizard.md. The App Manager and the index read these.`, n);
    }
    if (/(^|\/)(migrations?|schema)(\/|\.)|\.sql$/i.test(n)) {
      add('breaking', 'check', 'Changes a schema or migration. Confirm existing data upgrades in place and a rollback path exists.', n);
    }
    if (/^spec\//.test(n) && repoName === 'wizard-os') {
      add('breaking', 'check', 'Changes a contract in `spec/` that other repos depend on. Per the team rules this needs a decision and matching PRs in the dependent repos.', n);
    }
    if (n === 'docs/DECISIONS.md' && f.removed.some(t => /^\|\s*\d+\s*\|/.test(t))) {
      add('breaking', 'check', 'Edits or removes an existing decision row. Reversing a locked decision needs `needs: james review`.', n);
    }
    if (/^\.github\/workflows\//.test(n)) {
      const publish = f.added.some(({ text }) => /docker\/build-push-action|ghcr\.io|gh release|npm publish|push:\s*true/.test(text));
      add('breaking', publish ? 'check' : 'note', publish
        ? 'Changes a workflow that publishes. Merging can push an image or release that every install sees.'
        : 'Changes CI. Make sure the required checks still run and keep their names.', n);
    }
    if (/(^|\/)(package\.json|pyproject\.toml|Cargo\.toml)$/.test(n)) {
      const before = f.removed.map(t => t.match(/"?version"?\s*[:=]\s*"(\d+)\./)?.[1]).find(Boolean);
      const after = f.added.map(({ text }) => text.match(/"?version"?\s*[:=]\s*"(\d+)\./)?.[1]).find(Boolean);
      if (before && after && Number(after) > Number(before)) add('breaking', 'check', `Major version bump (${before} → ${after}). Say in the PR what breaks for callers.`, n);
    }
  }

  // 4. COMPONENTS.md reuse.
  if (isUx && inventory) {
    const flat = parsed.map(f => ({ path: f.filename, added: f.added.map(a => a.text) }));
    for (const problem of checkReuse({ body: pr.body || '', files: flat, inventory })) add('reuse', 'blocker', problem);
  }
  for (const f of parsed) {
    const n = f.filename;
    if (TEST_PATH.test(n) || !/\.(m?js|ts|tsx|jsx|html|vue|svelte|css)$/i.test(n)) continue;
    if (isUx && /^(web\/core\/|web\/[^/]+\.js$|web\/motion\/|android\/|ios\/|tools\/|scripts\/|qa)/.test(n)) continue; // the shell implements these
    if (!isUx && /^(?:src\/|lib\/)?(?:server|api|bin)\//.test(n)) continue;
    for (const h of HAND_ROLLED) {
      const hit = f.added.find(({ text }) => h.re.test(text));
      if (hit) add('reuse', 'check', `Hand-rolls "${h.need}". docs/COMPONENTS.md says use \`${h.use}\` (REUSE), or EXTEND it if it lacks something.`, n, hit.line);
    }
  }

  if (labels.includes('preview only')) add('process', 'note', 'Labelled `preview only`: this PR must not be merged.');
  if (!tier) add('process', 'note', 'No tier. Add one label and title prefix: Recommended fix / Strong suggestion / Opinionated — feel free to drop / Maintenance.');

  const order = { blocker: 0, check: 1, note: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  return { findings };
}

const AREA_TITLE = {
  'global look': 'Taste changed for everyone (should be in your own skin)',
  breaking: 'Possible breaking changes',
  secrets: 'Secrets',
  'private paths': 'Personal paths and private hosts',
  reuse: 'Reuse before build (docs/COMPONENTS.md)',
  process: 'Process',
};

export function renderReview({ pr = {}, headSha = '', findings = [], filesCount = 0, truncated = false }) {
  const blockers = findings.filter(f => f.severity === 'blocker').length;
  const checks = findings.filter(f => f.severity === 'check').length;
  const verdict = blockers
    ? `**${blockers} must-fix** before an admin approves${checks ? `, plus ${checks} to check` : ''}.`
    : checks ? `**No must-fix.** ${checks} thing${checks > 1 ? 's' : ''} for the approving admin to check.` : '**No problems found** in the four areas this agent checks.';
  const lines = [
    `${MARKER} sha=${headSha} -->`,
    '### Agent review',
    '',
    verdict,
    '',
  ];
  const areas = [...new Set(findings.map(f => f.area))];
  for (const area of areas) {
    lines.push(`**${AREA_TITLE[area] || area}**`);
    for (const f of findings.filter(x => x.area === area)) {
      const icon = f.severity === 'blocker' ? '🔴' : f.severity === 'check' ? '🟡' : '⚪';
      const where = f.file ? ` \`${f.file}${f.line ? `:${f.line}` : ''}\`` : '';
      lines.push(`- ${icon}${where} ${f.text}`);
    }
    lines.push('');
  }
  lines.push(`<sub>Checked ${filesCount} file${filesCount === 1 ? '' : 's'} at ${headSha.slice(0, 7)}${truncated ? ' (patch too large for some files; those were checked by name only)' : ''}: skin scope, breaking changes, secrets and private paths, COMPONENTS.md reuse. This review is advisory. Merging needs an approving review from an admin other than @${pr.author || 'the author'}. Reviewer: \`humanitylabs-org/wizard-ux/tools/pr-agent-review.mjs\`.</sub>`);
  return lines.join('\n');
}

// ---------- GitHub runner (CI) ----------
async function gh(path, { method = 'GET', body } = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function main() {
  const repo = process.env.PR_REPO || process.env.GITHUB_REPOSITORY;
  const number = Number(process.env.PR_NUMBER);
  if (!repo || !number) throw new Error('PR_REPO and PR_NUMBER are required');
  const pull = await gh(`/repos/${repo}/pulls/${number}`);
  const headSha = pull.head.sha;
  const reviews = [];
  for (let page = 1; page < 20; page++) {
    const batch = await gh(`/repos/${repo}/pulls/${number}/reviews?per_page=100&page=${page}`);
    reviews.push(...batch);
    if (batch.length < 100) break;
  }
  if (reviews.some(r => String(r.body || '').includes(`${MARKER} sha=${headSha} `))) {
    console.log(`already reviewed ${headSha}`);
    return;
  }
  const files = [];
  for (let page = 1; page <= 30; page++) {
    const batch = await gh(`/repos/${repo}/pulls/${number}/files?per_page=100&page=${page}`);
    files.push(...batch);
    if (batch.length < 100) break;
  }
  let inventory = '';
  try { inventory = readFileSync(process.env.COMPONENTS_MD || new URL('../docs/COMPONENTS.md', import.meta.url), 'utf8'); } catch {}
  const pr = { repo, title: pull.title, body: pull.body || '', author: pull.user?.login, labels: (pull.labels || []).map(l => l.name) };
  const { findings } = reviewPR({ pr, files, inventory });
  const body = renderReview({ pr, headSha, findings, filesCount: files.length, truncated: files.some(f => f.patch === undefined && f.status !== 'removed') });
  if (process.env.DRY_RUN) { console.log(body); return; }
  await gh(`/repos/${repo}/pulls/${number}/reviews`, { method: 'POST', body: { commit_id: headSha, event: 'COMMENT', body } });
  console.log(`posted review on ${repo}#${number} at ${headSha}: ${findings.length} findings`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(err => { console.error(err.message || err); process.exit(1); });
}
