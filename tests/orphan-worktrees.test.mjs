// tools/orphan-worktrees.mjs checks the live checkout and orphaned worktree folders read-only (wizard-ux#1223).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as ow from '../tools/orphan-worktrees.mjs';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid',
  '-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const commit = (cwd, name, text) => { writeFileSync(join(cwd, name), text); git(cwd, 'add', name); git(cwd, 'commit', '-q', '-m', name); };

function walk(dir) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...walk(p)); else out.push(p);
  }
  return out.sort();
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'orphan-worktrees-'));
  const o = join(root, 'origin');
  const live = join(root, 'live');
  const wts = join(root, 'worktrees');
  mkdirSync(o);
  mkdirSync(wts);
  git(o, 'init', '-q');
  writeFileSync(join(o, '.gitignore'), 'node_modules/\n');
  git(o, 'add', '.gitignore');
  commit(o, 'base', 'base\n');
  git(o, 'checkout', '-q', '-b', 'feature/pushed');
  commit(o, 'p', 'pushed\n');
  git(o, 'checkout', '-q', 'main');
  execFileSync('git', ['clone', '-q', o, live]);
  // the live checkout falls behind: two more commits land on main
  commit(o, 'm1', 'm1\n');
  commit(o, 'm2', 'm2\n');
  git(live, 'fetch', '-q', 'origin');
  // worktrees of the live checkout's store
  git(live, 'worktree', 'add', '-q', '--detach', join(wts, 'old-main'), 'HEAD');
  mkdirSync(join(wts, 'old-main', 'node_modules'));
  writeFileSync(join(wts, 'old-main', 'node_modules', 'x'), 'ignored\n'); // ignored: still on main
  git(live, 'worktree', 'add', '-q', '--detach', join(wts, 'on-pushed'), 'refs/remotes/origin/feature/pushed');
  git(live, 'worktree', 'add', '-q', '--detach', join(wts, 'edited'), 'HEAD');
  writeFileSync(join(wts, 'edited', 'base'), 'changed but never committed\n');
  writeFileSync(join(wts, 'edited', 'new-file'), 'never committed\n');
  git(live, 'worktree', 'add', '-q', '--detach', join(wts, 'still-linked'), 'HEAD');
  // a folder that is its own repo and a plain folder are not this store's worktrees
  mkdirSync(join(wts, 'other-repo'));
  git(join(wts, 'other-repo'), 'init', '-q');
  mkdirSync(join(wts, 'plain'));
  // the metadata of three worktrees is gone
  for (const n of ['old-main', 'on-pushed', 'edited']) rmSync(join(live, '.git', 'worktrees', n), { recursive: true, force: true });
  return { root, live, wts };
}

const silent = { out: () => {}, err: () => {} };

test('orphan worktrees: live checkout behind main and dirty is reported', () => {
  const { root, live } = fixture();
  try {
    let s = ow.liveStatus(live);
    assert.equal(s.behind, 2);
    assert.equal(s.ahead, 0);
    assert.equal(s.dirty, 0);
    assert.equal(s.branch, 'main');
    writeFileSync(join(live, 'stray'), 'x\n');
    s = ow.liveStatus(live);
    assert.equal(s.dirty, 1);
    rmSync(join(live, 'stray'));
    git(live, 'merge', '-q', '--ff-only', 'refs/remotes/origin/main');
    s = ow.liveStatus(live);
    assert.equal(s.behind, 0);
    assert.equal(ow.main(['--checkout', live], silent), 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('orphan worktrees: a detached HEAD or another branch at main still needs a person', () => {
  const { root, live } = fixture();
  try {
    git(live, 'merge', '-q', '--ff-only', 'refs/remotes/origin/main');
    assert.equal(ow.main(['--checkout', live], silent), 0);
    git(live, 'checkout', '-q', '--detach', 'HEAD');
    let text = '';
    assert.equal(ow.main(['--checkout', live], { out: (t) => { text = t; }, err: () => {} }), 1);
    assert.match(text, /on \(detached\): on origin\/main\n {2}Not on branch main/);
    git(live, 'checkout', '-q', '-b', 'other');
    assert.equal(ow.main(['--checkout', live], silent), 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('orphan worktrees: classifies on-main, pushed and unmatched folders, skips linked and foreign ones', () => {
  const { root, live, wts } = fixture();
  try {
    const r = ow.report({ checkout: live, root: wts, files: true });
    assert.equal(r.linked, 1);
    const by = Object.fromEntries(r.orphans.map((o) => [o.name, o]));
    assert.deepEqual(Object.keys(by).sort(), ['edited', 'old-main', 'on-pushed']);
    assert.equal(by['old-main'].status, 'on-main');
    assert.equal(by['on-pushed'].status, 'pushed');
    assert.deepEqual(by['on-pushed'].branches, ['feature/pushed']);
    assert.equal(by.edited.status, 'unmatched');
    // vs main's tip: base edited, new-file added, m1 and m2 missing
    assert.deepEqual(by.edited.files, ['base', 'm1', 'm2', 'new-file']);
    // only the never-committed contents exist nowhere else; m1 and m2 are deletions
    assert.deepEqual(by.edited.only_here_files, ['base', 'new-file']);
    assert.equal(by.edited.only_here, 2);
    const text = ow.render(r);
    assert.match(text, /2 behind, 0 ahead of origin\/main/);
    assert.match(text, /Orphaned worktree folders: 3/);
    assert.match(text, /On no remote branch, turn into a PR or discard with sign-off: 1\n {4}edited {2}4 paths differ from main, 2 with content found nowhere else\n {6}only here: base/);
    assert.equal(ow.main(['--checkout', live, '--root', wts], silent), 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('orphan worktrees: never writes to the checkout store, index or the folders', () => {
  const { root, live, wts } = fixture();
  try {
    const before = walk(join(live, '.git')).map((p) => [p, readFileSync(p, 'latin1')]);
    const folders = walk(wts).map((p) => [p, readFileSync(p, 'latin1')]);
    ow.report({ checkout: live, root: wts });
    assert.deepEqual(walk(join(live, '.git')).map((p) => [p, readFileSync(p, 'latin1')]), before);
    assert.deepEqual(walk(wts).map((p) => [p, readFileSync(p, 'latin1')]), folders);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('orphan worktrees: a missing remote, main or bad usage is an error, not clean', () => {
  const { root, live, wts } = fixture();
  try {
    assert.equal(ow.main(['--checkout', live, '--remote', 'nosuch'], silent), 2);
    assert.equal(ow.main(['--checkout', live, '--main', 'nosuch'], silent), 2);
    assert.equal(ow.main(['--checkout', live, '--root', join(wts, 'nosuch')], silent), 2);
    assert.equal(ow.main(['--root', wts], silent), 2);
    assert.equal(ow.main(['--bogus'], silent), 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('orphan worktrees: a local branch named origin/main cannot shadow the remote ref', () => {
  const { root, live } = fixture();
  try {
    git(live, 'branch', 'origin/main', 'HEAD');
    assert.equal(ow.liveStatus(live).behind, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('orphan worktrees: admits only existing ignored files tracked in remote history', () => {
  const { root, live, wts } = fixture();
  try {
    git(join(root, 'origin'), 'checkout', '-q', '--detach');
    git(live, 'merge', '-q', '--ff-only', 'refs/remotes/origin/main');
    writeFileSync(join(live, '.gitignore'), 'node_modules/\ncache/\n*.ignored\n');
    writeFileSync(join(live, 'kept.ignored'), 'tracked and ignored\n');
    writeFileSync(join(live, 'removed.ignored'), 'historical bytes\n');
    git(live, 'add', '.gitignore');
    git(live, 'add', '-f', '--', 'kept.ignored', 'removed.ignored');
    git(live, 'commit', '-q', '-m', 'track ignored files');
    git(live, 'push', '-q', 'origin', 'main');
    const old = git(live, 'rev-parse', 'HEAD').trim();
    const names = ['history-unchanged', 'history-edited', 'history-missing', 'tracked-edited', 'tracked-missing'];
    for (const name of names) git(live, 'worktree', 'add', '-q', '--detach', join(wts, name), old);
    git(live, 'rm', '-q', '--', 'removed.ignored');
    git(live, 'commit', '-q', '-m', 'remove ignored file');
    git(live, 'push', '-q', 'origin', 'main');
    for (const name of names) {
      const folder = join(wts, name);
      if (!name.startsWith('history-') || name === 'history-missing') rmSync(join(folder, 'removed.ignored'));
      if (name === 'history-edited') writeFileSync(join(folder, 'removed.ignored'), 'UNIQUE NEVER COMMITTED CONTENT\n');
      if (name === 'tracked-edited') writeFileSync(join(folder, 'kept.ignored'), 'unique tracked edit\n');
      if (name === 'tracked-missing') rmSync(join(folder, 'kept.ignored'));
      mkdirSync(join(folder, 'node_modules'));
      writeFileSync(join(folder, 'node_modules', 'dependency'), 'never tracked dependency\n');
      mkdirSync(join(folder, 'cache'));
      writeFileSync(join(folder, 'cache', 'fresh'), 'never tracked cache\n');
      rmSync(join(live, '.git', 'worktrees', name), { recursive: true, force: true });
    }
    const before = walk(join(live, '.git')).map((p) => [p, readFileSync(p, 'latin1')]);
    const folders = walk(wts).map((p) => [p, readFileSync(p, 'latin1')]);
    const r = ow.report({ checkout: live, root: wts, files: true });
    const by = Object.fromEntries(r.orphans.map((o) => [o.name, o]));
    assert.equal(by['history-edited'].status, 'unmatched');
    assert.deepEqual(by['history-edited'].files, ['removed.ignored']);
    assert.deepEqual(by['history-edited'].only_here_files, ['removed.ignored']);
    assert.equal(by['history-unchanged'].status, 'on-main');
    assert.equal(by['history-unchanged'].commit, old);
    assert.equal(by['history-missing'].status, 'on-main');
    assert.equal(by['history-missing'].commit, git(live, 'rev-parse', 'HEAD').trim());
    assert.equal(by['tracked-edited'].status, 'unmatched');
    assert.deepEqual(by['tracked-edited'].only_here_files, ['kept.ignored']);
    assert.equal(by['tracked-missing'].status, 'unmatched');
    assert.deepEqual(by['tracked-missing'].files, ['kept.ignored']);
    assert.deepEqual(by['tracked-missing'].only_here_files, []);
    assert.equal(ow.needsPerson(r), true);
    assert.deepEqual(walk(join(live, '.git')).map((p) => [p, readFileSync(p, 'latin1')]), before);
    assert.deepEqual(walk(wts).map((p) => [p, readFileSync(p, 'latin1')]), folders);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('orphan worktrees: the tool has no command that changes a repo', () => {
  const src = readFileSync(new URL('../tools/orphan-worktrees.mjs', import.meta.url), 'utf8');
  for (const word of ["'push'", "'fetch'", "'checkout'", "'reset'", "'merge'", "'worktree'", 'update-ref', "'commit'", "'gc'", "'prune'"]) {
    assert.ok(!src.includes(word), word);
  }
});
