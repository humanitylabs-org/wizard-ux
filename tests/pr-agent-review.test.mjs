import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reviewPR, renderReview, parsePatch, MARKER } from '../tools/pr-agent-review.mjs';

const inventory = readFileSync(new URL('../docs/COMPONENTS.md', import.meta.url), 'utf8');
const patch = (added = [], removed = []) => ['@@ -1,1 +1,1 @@', ...removed.map(l => '-' + l), ...added.map(l => '+' + l)].join('\n');
const okBody = 'Reuse: n/a (no UI)';
const run = (repo, files, extra = {}) => reviewPR({ pr: { repo: `humanitylabs-org/${repo}`, title: 'Recommended fix: x', body: okBody, author: 'someone', labels: ['tier: recommended fix'], ...extra }, files, inventory }).findings;
const has = (findings, area, severity, re) => findings.some(f => f.area === area && (!severity || f.severity === severity) && (!re || re.test(f.text)));

test('parsePatch tracks new-file line numbers', () => {
  const p = parsePatch('@@ -10,2 +20,3 @@\n context\n-old\n+new\n+newer');
  assert.deepEqual(p.added, [{ line: 21, text: 'new' }, { line: 22, text: 'newer' }]);
  assert.deepEqual(p.removed, ['old']);
});

test('flags secrets and personal paths on added lines only', () => {
  const home = '/home/' + 'telos/.hermes';
  const key = 'gh' + 'p_' + 'a'.repeat(36);
  const f = run('wizard-agent-service', [{ filename: 'src/x.js', status: 'modified', patch: patch([`const p = '${home}';`, `const t = '${key}';`], [`const q = '${home}';`]) }]);
  assert.ok(has(f, 'private paths', 'blocker', /home directory/));
  assert.ok(has(f, 'secrets', 'blocker', /GitHub token/));
  const removedOnly = run('wizard-agent-service', [{ filename: 'src/x.js', status: 'modified', patch: patch([], [`const q = '${home}';`]) }]);
  assert.ok(!has(removedOnly, 'private paths'));
  const env = run('wizard-app-manager', [{ filename: 'deploy/.env', status: 'added', patch: patch(['A=1']) }]);
  assert.ok(has(env, 'secrets', 'blocker', /credential file/));
  assert.ok(!has(run('wizard-app-manager', [{ filename: '.env.example', status: 'added', patch: patch(['A=']) }]), 'secrets'));
});

test('flags taste changes to everyone instead of own skin', () => {
  const nebula = run('wizard-ux', [{ filename: 'web/core/skins.js', status: 'modified', patch: patch(["    { id: 'nebula', name: 'Nebula 2' },"], ["    { id: 'nebula', name: 'Nebula' },"]) }]);
  assert.ok(has(nebula, 'global look', 'blocker', /James's skins/));
  const base = run('wizard-ux', [{ filename: 'web/core/base.css', status: 'modified', patch: patch(['body { font-family: Comic Sans; }']) }], { title: 'Opinionated — feel free to drop: rounder', labels: ['tier: opinionated'] });
  assert.ok(has(base, 'global look', 'blocker', /base shell look/));
  const toggle = run('wizard-ux', [{ filename: 'web/core/settings.js', status: 'modified', patch: patch(["WosSettings.register({ id: 'my-pref' })"]) }], { title: 'Opinionated — feel free to drop: x', labels: ['tier: opinionated'] });
  assert.ok(has(toggle, 'global look', 'blocker', /Settings toggle/));
  const own = run('wizard-ux', [{ filename: 'web/skins/mine/skin.css', status: 'added', patch: patch(['html[data-skin="mine"] body { color: red }']) }], { title: 'Opinionated — feel free to drop: x', labels: ['tier: opinionated'] });
  assert.ok(!own.some(f => f.area === 'global look' && f.severity !== 'note'));
});

test('flags likely breaking changes', () => {
  const f = run('wizard-agent-service', [
    { filename: 'src/api.js', status: 'modified', patch: patch(['// gone'], ["export function listThreads() {}", "app.get('/wizard/v1/threads', h)", 'const x = process.env.WIZARD_OLD_FLAG;']) },
    { filename: 'src/old.js', status: 'removed', patch: '' },
    { filename: 'wizard.md', status: 'modified', patch: patch(['name: x'], ['name: x', 'recommends: opus']) },
  ]);
  assert.ok(has(f, 'breaking', 'check', /export `listThreads`/));
  assert.ok(has(f, 'breaking', 'check', /route `\/wizard\/v1\/threads`/));
  assert.ok(has(f, 'breaking', 'check', /WIZARD_OLD_FLAG/));
  assert.ok(has(f, 'breaking', 'check', /Deletes `src\/old.js`/));
  assert.ok(has(f, 'breaking', 'check', /`recommends`/));
  const moved = run('wizard-agent-service', [
    { filename: 'src/a.js', status: 'modified', patch: patch([], ['export function keep() {}']) },
    { filename: 'src/b.js', status: 'added', patch: patch(['export function keep() {}']) },
  ]);
  assert.ok(!has(moved, 'breaking', null, /keep/), 'a definition moved to another file is not a removal');
});

test('reuses the COMPONENTS.md reuse check and catches hand-rolled capabilities', () => {
  const noBlock = run('wizard-ux', [{ filename: 'web/core/x.js', status: 'modified', patch: patch(['x()']) }], { body: 'What and why: stuff' });
  assert.ok(has(noBlock, 'reuse', 'blocker', /no "Reuse:" block/));
  const app = run('wizard-calendar', [{ filename: 'web/app.js', status: 'modified', patch: patch(['const s = await navigator.mediaDevices.getUserMedia({audio:true})']) }]);
  assert.ok(has(app, 'reuse', 'check', /WizardApp\.capture/));
  const shell = run('wizard-ux', [{ filename: 'web/core/mic.js', status: 'modified', patch: patch(['navigator.mediaDevices.getUserMedia({audio:true})']) }], { body: 'Reuse:\n- mic: EXTEND WosMic\n' });
  assert.ok(!has(shell, 'reuse', 'check', /WizardApp\.capture/), 'the shell is where capture is implemented');
});

test('renders one marked review with a verdict', () => {
  const findings = run('wizard-ux', [{ filename: 'web/core/base.css', status: 'modified', patch: patch(['a{}']) }], { title: 'Opinionated — feel free to drop: x', labels: ['tier: opinionated'] });
  const body = renderReview({ pr: { author: 'oscar' }, headSha: 'abcdef1234567', findings, filesCount: 1 });
  assert.ok(body.startsWith(`${MARKER} sha=abcdef1234567 -->`));
  assert.match(body, /must-fix/);
  assert.match(body, /admin other than @oscar/);
  const clean = renderReview({ pr: { author: 'a' }, headSha: 'f'.repeat(40), findings: [], filesCount: 2 });
  assert.match(clean, /No problems found/);
});
