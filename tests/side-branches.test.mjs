// tools/side-branches.mjs reports leftover live/integration branches read-only (wizard-ux#1224).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as sb from '../tools/side-branches.mjs';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid',
  '-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const commit = (cwd, name, text) => { writeFileSync(join(cwd, name), text); git(cwd, 'add', name); git(cwd, 'commit', '-q', '-m', name); };

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'side-branches-'));
  const o = join(root, 'origin');
  const clone = join(root, 'clone');
  execFileSync('mkdir', [o]);
  git(o, 'init', '-q');
  commit(o, 'base', 'base\n');
  // merged: its only commit is on main too
  git(o, 'checkout', '-q', '-b', 'integration/merged');
  commit(o, 'a', 'a\n');
  git(o, 'checkout', '-q', 'main');
  git(o, 'merge', '-q', '--ff-only', 'integration/merged');
  // cherry-picked onto main with a different sha: same patch id, counts as landed
  git(o, 'checkout', '-q', '-b', 'live/picked');
  commit(o, 'b', 'b\n');
  git(o, 'checkout', '-q', 'main');
  commit(o, 'c', 'c\n');
  git(o, 'cherry-pick', 'live/picked');
  // two commits not on main
  git(o, 'checkout', '-q', '-b', 'live-unique', 'main');
  commit(o, 'd', 'd\n');
  commit(o, 'e', 'e\n');
  // one commit not on main, on a livefix/ branch (the issue's table lists one)
  git(o, 'checkout', '-q', '-b', 'livefix/one', 'main');
  commit(o, 'lf', 'lf\n');
  // landed commits, but the merge itself staged content that never reached main
  git(o, 'checkout', '-q', '-b', 'tmp-side', 'main');
  commit(o, 'f', 'side\n');
  git(o, 'checkout', '-q', '-b', 'integration/resolved', 'main');
  commit(o, 'g', 'other\n');
  git(o, 'merge', '-q', '--no-ff', '--no-commit', 'tmp-side');
  writeFileSync(join(o, 'h'), 'only in the merge\n');
  git(o, 'add', 'h');
  git(o, 'commit', '-q', '--no-edit');
  git(o, 'checkout', '-q', 'main');
  git(o, 'cherry-pick', 'tmp-side');
  git(o, 'cherry-pick', 'integration/resolved^1');
  // a clean merge of main into a landed branch adds nothing
  git(o, 'checkout', '-q', '-b', 'integration/clean-merge', 'main~1');
  git(o, 'merge', '-q', '--no-ff', '--no-edit', 'main');
  // never matched
  git(o, 'checkout', '-q', 'main');
  git(o, 'checkout', '-q', '-b', 'owner-snapshot/keep', 'live-unique');
  git(o, 'checkout', '-q', '-b', 'feature/other', 'live-unique');
  git(o, 'checkout', '-q', '-b', 'lively/not-a-side-branch', 'live-unique');
  git(o, 'checkout', '-q', 'main');
  execFileSync('git', ['clone', '-q', o, clone]);
  return { root, clone };
}

const silent = (cwd) => ({ cwd, out: () => {}, err: () => {} });

test('side branches: matches only integration/, live/, live- and livefix/', () => {
  const { root, clone } = fixture();
  try {
    assert.deepEqual(sb.sideBranches('origin', clone), [
      'integration/clean-merge', 'integration/merged', 'integration/resolved', 'live-unique', 'live/picked', 'livefix/one',
    ]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('side branches: counts unique commits by patch id and merges with own content', () => {
  const { root, clone } = fixture();
  try {
    const rows = Object.fromEntries(sb.report({ cwd: clone }).map((r) => [r.branch, r.unique_commits]));
    assert.equal(rows['integration/merged'], 0);
    assert.equal(rows['live/picked'], 0);
    assert.equal(rows['live-unique'], 2);
    assert.equal(rows['livefix/one'], 1);
    assert.equal(rows['integration/clean-merge'], 0);
    assert.ok(rows['integration/resolved'] >= 1, 'a merge that staged its own file is not safe to delete');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('side branches: render splits safe from needs-a-decision and flags open PRs', () => {
  const { root, clone } = fixture();
  try {
    const text = sb.render(sb.report({ cwd: clone, openPrs: new Map([['live/picked', [930]]]) }));
    assert.match(text, /Side branches left: 6/);
    assert.match(text, /No unique commits \(safe to delete\): 3/);
    assert.match(text, /Unique commits, need a decision: 3/);
    assert.match(text, /live\/picked .*open PR #930: leave until it closes/);
    assert.doesNotMatch(text, /owner-snapshot|feature\/other|lively/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('side branches: a missing remote or main is an error, not clean', () => {
  const { root, clone } = fixture();
  try {
    assert.equal(sb.main(['--remote', 'nosuch'], silent(clone)), 2);
    assert.equal(sb.main(['--main', 'nosuch'], silent(clone)), 2);
    assert.equal(sb.main(['--bogus'], silent(clone)), 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('side branches: exit 0 only when none are left', () => {
  const { root, clone } = fixture();
  try {
    let printed = '';
    assert.equal(sb.main(['--json'], { cwd: clone, out: (s) => { printed = s; }, err: () => {} }), 1);
    assert.equal(JSON.parse(printed).length, 6);
    for (const b of sb.sideBranches('origin', clone)) git(clone, 'update-ref', '-d', `refs/remotes/origin/${b}`);
    assert.equal(sb.main([], silent(clone)), 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('side branches: the tool never writes to the remote or deletes refs', () => {
  const src = readFileSync(new URL('../tools/side-branches.mjs', import.meta.url), 'utf8');
  for (const word of ["'push'", "'-D'", "'-d'", 'update-ref', "'--delete'", "'delete'"]) assert.ok(!src.includes(word), word);
});

test('side branches: a local branch named origin/... cannot shadow the remote refs', () => {
  const { root, clone } = fixture();
  try {
    // local refs/heads/origin/main at the unique branch tip would make it look landed
    git(clone, 'branch', 'origin/main', 'refs/remotes/origin/live-unique');
    git(clone, 'branch', 'origin/live-unique', 'refs/remotes/origin/main');
    const rows = Object.fromEntries(sb.report({ cwd: clone }).map((r) => [r.branch, r.unique_commits]));
    assert.equal(rows['live-unique'], 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
