// The shared reuse gate a caller app runs (reuse-check-app.yml): the workflow is read the way Actions reads it and its
// runner expression, checkout steps and run scripts are evaluated (tests/fixtures/w1-workflow.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readWorkflow, runsOn, runStep } from './fixtures/w1-workflow.mjs';

const workflow = readWorkflow(new URL('../.github/workflows/reuse-check-app.yml', import.meta.url));
const input = workflow.on.workflow_call.inputs.runner;
const job = workflow.jobs.reuse;

// Run the workflow's steps in order with the stub programs in `cwd`; each stub appends what it was started with to
// cwd/ran (the run's own output).
function runSteps(steps, opts) {
  const outs = steps.map(st => runStep(workflow, st, opts));
  return { outs, ran: readFileSync(join(opts.cwd, 'ran'), 'utf8').trim().split('\n') };
}

// static-rule: the workflow's declared input (parsed YAML, as Actions reads it) is config; runsOn below evaluates it
test('public app callers retain the GitHub-hosted default', () => {
  assert.equal(input.type, 'string');
  assert.equal(input.required, false);
  assert.equal(runsOn(job, { inputs: { runner: input.default } }), 'ubuntu-latest');
});

test('private app callers can select a self-hosted label array', () => {
  const labels = runsOn(job, { inputs: { runner: '["self-hosted","linux","forum","reuse-check"]' } });
  assert.deepEqual(labels, ['self-hosted', 'linux', 'forum', 'reuse-check']);
});

// static-rule: the declared permissions and checkouts (parsed YAML) are config; the run steps below are executed
test('runner selection preserves trusted, read-only gate execution', () => {
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.equal(workflow.on.pull_request_target, undefined);
  const checkouts = job.steps.filter(s => /^actions\/checkout@/.test(s.uses || ''));
  assert.equal(checkouts.length, 2);
  for (const c of checkouts) assert.equal(c.with['persist-credentials'], false, c.name);
  const gate = checkouts.find(c => c.with.path === 'wizard-shared');
  assert.equal(gate.with.repository, 'humanitylabs-org/wizard-ux');
  assert.equal(gate.with.ref, 'main');
  // The run steps execute only the trusted checkout's tools: watch which programs they start, with what.
  const dir = mkdtempSync(join(tmpdir(), 'reuse-gate-'));
  try {
    for (const prog of ['node', 'python3', 'npm', 'pnpm', 'npx']) writeFileSync(join(dir, prog), `#!/bin/bash\necho "${prog} $*" >> "${dir}/ran"\n`, { mode: 0o755 });
    const ctx = { github: { workspace: '/w', event: { pull_request: { base: { sha: 'b'.repeat(40) }, head: { sha: 'h'.repeat(40) } } } } };
    for (const s of job.steps.filter(s => s.run)) assert.equal(s.secrets, undefined, s.name);
    const { outs, ran } = runSteps(job.steps.filter(s => s.run), { ctx, cwd: dir, env: { PATH: `${dir}:/usr/bin:/bin` } });
    for (const out of outs) assert.equal(out.status, 0, out.stderr);
    assert.deepEqual(ran, [
      'node wizard-shared/tools/reuse-check-app.mjs',
      `python3 wizard-shared/tools/style/check_style.py app --policy wizard-shared/tools/style/style-policy.json --base ${'b'.repeat(40)}`,
    ]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
