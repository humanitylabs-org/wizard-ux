// Required `gitleaks` check judges only the change in front of it (wizard-ux#887 rule 2). Before this, the job
// scanned every fetched branch's full history, so one key-like line on an unrelated branch turned every PR red
// (main froze 1–3 Nov 2026). tools/secret-scan-range.sh picks the range; these tests run it on a real throwaway repo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { readWorkflow, jobsFor, step, runStep } from './fixtures/w1-workflow.mjs';

const root = new URL('..', import.meta.url).pathname;
const script = join(root, 'tools/secret-scan-range.sh');
const workflow = readWorkflow(join(root, '.github/workflows/secret-scan.yml'));

test('the required gitleaks job runs on pushes and PRs; the full-history audit only on schedule or by hand', () => {
  for (const event_name of ['push', 'pull_request']) assert.deepEqual(jobsFor(workflow, { github: { event_name } }), ['gitleaks'], event_name);
  for (const event_name of ['schedule', 'workflow_dispatch']) assert.deepEqual(jobsFor(workflow, { github: { event_name } }), ['history-audit'], event_name);
});

test('the install step refuses a download whose checksum does not match, before unpacking it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scan-install-'));
  try {
    writeFileSync(join(dir, 'curl'), '#!/bin/sh\nwhile [ "$1" != "-o" ]; do shift; done\nprintf tampered > "$2"\n', { mode: 0o755 });
    writeFileSync(join(dir, 'tar'), `#!/bin/sh\ntouch "${dir}/unpacked"\n`, { mode: 0o755 });
    for (const name of ['gitleaks', 'history-audit']) {
      const install = step(workflow.jobs[name], 'install gitleaks');
      const out = runStep(workflow, install, { cwd: dir, env: { PATH: `${dir}:${process.env.PATH}` } });
      assert.notEqual(out.status, 0, `${name}: a bad download fails the step`);
      assert.ok(!existsSync(join(dir, 'unpacked')), `${name}: nothing is unpacked`);
    }
    // control: the same download checked against its own digest is unpacked, so the pinned GITLEAKS_SHA256 is what decides
    const digest = createHash('sha256').update('tampered').digest('hex');
    for (const name of ['gitleaks', 'history-audit']) {
      rmSync(join(dir, 'unpacked'), { force: true });
      const out = runStep(workflow, step(workflow.jobs[name], 'install gitleaks'), { cwd: dir, env: { PATH: `${dir}:${process.env.PATH}`, GITLEAKS_SHA256: digest } });
      assert.ok(existsSync(join(dir, 'unpacked')), `${name}: a download matching GITLEAKS_SHA256 is unpacked (${out.stderr.trim().split('\n').pop()})`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'scan-range-'));
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const git = (...a) => execFileSync('git', a, { cwd: dir, env, encoding: 'utf8' }).trim();
  const commit = (file, text) => { writeFileSync(join(dir, file), text); git('add', file); git('commit', '-qm', file); return git('rev-parse', 'HEAD'); };
  git('init', '-q', '-b', 'main');
  const m1 = commit('a.txt', 'one\n');
  git('checkout', '-qb', 'someone-else');                  // another thread's branch with a key-like line
  const leak = commit('leak.txt', 'api_key = "not-ours"\n');
  git('checkout', '-q', 'main');
  const m2 = commit('b.txt', 'two\n');
  git('checkout', '-qb', 'my-pr');
  const p1 = commit('c.txt', 'mine\n');
  const p2 = commit('d.txt', 'mine too\n');
  git('update-ref', 'refs/remotes/origin/main', m2);      // what actions/checkout leaves behind
  git('update-ref', 'refs/remotes/origin/someone-else', leak);
  const run = vars => spawnSync('sh', [script], { cwd: dir, env: { PATH: process.env.PATH, ...vars }, encoding: 'utf8' });
  const commits = range => (range ? git('rev-list', range).split('\n').filter(Boolean) : []);
  return { dir, git, run, commits, m1, m2, leak, p1, p2, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test('pull_request: exactly the PR\'s own commits, not another branch\'s', () => {
  const r = repo();
  try {
    const out = r.run({ EVENT: 'pull_request', PR_BASE: r.m2, PR_HEAD: r.p2 });
    assert.equal(out.status, 0, out.stderr);
    const got = r.commits(out.stdout.trim());
    assert.deepEqual(new Set(got), new Set([r.p1, r.p2]));
    assert.ok(!got.includes(r.leak) && !got.includes(r.m1));
  } finally { r.done(); }
});

test('the required job hands gitleaks only the computed range; the audit scans every branch', () => {
  const r = repo();
  try {
    r.git('remote', 'add', 'origin', r.dir);
    r.git('config', 'user.name', 't'); r.git('config', 'user.email', 't@t');
    mkdirSync(join(r.dir, 'tools')); copyFileSync(script, join(r.dir, 'tools/secret-scan-range.sh'));
    // the fake gitleaks prints the arguments it was given (and leaves a mark that it ran)
    writeFileSync(join(r.dir, 'gitleaks'), '#!/bin/sh\nprintf "%s\\n" "$@" | tee gitleaks.args | sed "s/^/ARG /"\n', { mode: 0o755 });
    const argsOf = run => run.stdout.split('\n').filter(l => l.startsWith('ARG ')).map(l => l.slice(4));
    const env = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
    const scan = step(workflow.jobs.gitleaks, "gitleaks (this change's commits)");
    const github = { event_name: 'pull_request', ref: 'refs/pull/1/merge', event: { pull_request: { base: { sha: r.m2 }, head: { sha: r.p2 } }, repository: { default_branch: 'main' } } };
    let out = runStep(workflow, scan, { ctx: { github }, cwd: r.dir, env });
    assert.equal(out.status, 0, out.stderr);
    const opts = argsOf(out).filter(a => a.startsWith('--log-opts='));
    assert.equal(opts.length, 1);
    assert.deepEqual(new Set(r.commits(opts[0].slice('--log-opts='.length))), new Set([r.p1, r.p2]), 'only the PR\'s own commits');
    // a deleted ref scans nothing and passes
    rmSync(join(r.dir, 'gitleaks.args'));
    out = runStep(workflow, scan, { ctx: { github: { event_name: 'push', ref: 'refs/heads/my-pr', event: { after: '0'.repeat(40), repository: { default_branch: 'main' } } } }, cwd: r.dir, env });
    assert.equal(out.status, 0, out.stderr);
    assert.ok(!existsSync(join(r.dir, 'gitleaks.args')), 'gitleaks never ran');
    const audit = step(workflow.jobs['history-audit'], 'gitleaks (every branch, full history)');
    out = runStep(workflow, audit, { cwd: r.dir, env });
    assert.equal(out.status, 0, out.stderr);
    assert.ok(argsOf(out).includes('--log-opts=--all'));
  } finally { r.done(); }
});

test('push: main scans main\'s history; another branch scans what main lacks; a delete scans nothing', () => {
  const r = repo();
  try {
    let out = r.run({ EVENT: 'push', PUSH_REF: 'refs/heads/main', PUSH_AFTER: r.m2, DEFAULT_BRANCH: 'main' });
    assert.equal(out.status, 0, out.stderr);
    assert.deepEqual(new Set(r.commits(out.stdout.trim())), new Set([r.m1, r.m2]));
    out = r.run({ EVENT: 'push', PUSH_REF: 'refs/heads/my-pr', PUSH_AFTER: r.p2, DEFAULT_BRANCH: 'main' });
    assert.equal(out.status, 0, out.stderr);
    assert.deepEqual(new Set(r.commits(out.stdout.trim())), new Set([r.p1, r.p2]));
    out = r.run({ EVENT: 'push', PUSH_REF: 'refs/heads/someone-else', PUSH_AFTER: r.leak, DEFAULT_BRANCH: 'main' });
    assert.deepEqual(r.commits(out.stdout.trim()), [r.leak], 'that branch\'s own push still catches its own line');
    out = r.run({ EVENT: 'push', PUSH_REF: 'refs/heads/my-pr', PUSH_AFTER: '0'.repeat(40), DEFAULT_BRANCH: 'main' });
    assert.equal(out.status, 0);
    assert.equal(out.stdout, '');
  } finally { r.done(); }
});

test('a malformed or missing commit fails the check instead of scanning nothing', () => {
  const r = repo();
  try {
    for (const vars of [
      { EVENT: 'pull_request', PR_BASE: 'main; echo hi', PR_HEAD: r.p2 },
      { EVENT: 'pull_request', PR_BASE: r.m2, PR_HEAD: 'f'.repeat(40) },
      { EVENT: 'pull_request', PR_BASE: '', PR_HEAD: r.p2 },
      { EVENT: 'push', PUSH_REF: 'refs/heads/x', PUSH_AFTER: '', DEFAULT_BRANCH: 'main' },
      { EVENT: 'schedule' },
    ]) {
      const out = r.run(vars);
      assert.notEqual(out.status, 0, JSON.stringify(vars));
      assert.equal(out.stdout, '');
    }
  } finally { r.done(); }
});
