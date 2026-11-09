#!/usr/bin/env node
// Read-only check of the live shell checkout and its orphaned worktree folders (wizard-ux#1223).
//
// Live == main: the live shell checkout should sit on the remote's main with a
// clean tree. This reports how far its HEAD is behind or ahead of main and how
// many entries `git status` shows.
//
// It also walks a folder of old worktrees (`--root`). A folder is orphaned when
// its `.git` file points into this checkout's `worktrees/<name>` metadata and
// that metadata is gone, so git no longer knows the folder. For each orphan it
// snapshots the folder's files (including ignored paths tracked in remote history)
// into a temporary index and object folder, and compares that tree with every commit on the
// remote's branches:
//   on-main    the tree equals a commit on main: nothing to keep
//   pushed     the tree equals a commit on another remote branch (named)
//   unmatched  no commit on any remote branch has this tree: turn it into a PR
//              or discard it with sign-off. `changed_vs_main` counts the paths
//              that differ from main's tip; `only_here` counts the files whose
//              content no object in the store has, so they exist nowhere else
//              (--files lists both)
//   error      the folder could not be read
//
// It never writes to the checkout: no fetch, no checkout, no object or ref is
// written to its store (new objects go to a temporary folder that is removed).
// People act on the list. Run `git -C <checkout> fetch --prune <remote>` first
// so the remote refs are current.
//
// Usage: node tools/orphan-worktrees.mjs --checkout <live checkout> [--root <worktrees folder>]
//          [--remote origin] [--main main] [--json] [--files]
// e.g.   node tools/orphan-worktrees.mjs --checkout "$HOME/apps/wizard-os-home" --root "$HOME/worktrees"
// Exit 0 when the checkout is on branch main at the remote's main, clean, and no orphan is unmatched or
// unreadable; 1 when something needs a person; 2 on a git error or bad usage
// (including a remote or main tracking ref that does not exist).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Fully qualified, so a local branch named like `origin/main` cannot shadow the
// remote-tracking ref being compared against.
const ref = (remote, name) => `refs/remotes/${remote}/${name}`;

// Drop inherited GIT_* variables so only the ones set here steer git.
function cleanEnv(extra = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) env[k] = v;
  // No opportunistic index refresh from `git status`: the checkout stays untouched.
  return { ...env, GIT_OPTIONAL_LOCKS: '0', ...extra };
}

function git(args, cwd, env) {
  return execFileSync('git', args, {
    cwd, env: env || cleanEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 << 20,
  });
}

const lines = (s) => s.split('\n').filter(Boolean);

export function commonDir(checkout) {
  return resolve(checkout, git(['rev-parse', '--git-common-dir'], checkout).trim());
}

export function liveStatus(checkout, remote = 'origin', main = 'main') {
  // A missing main must be an error, never "clean".
  git(['rev-parse', '--verify', '--quiet', `${ref(remote, main)}^{commit}`], checkout);
  const head = git(['rev-parse', 'HEAD'], checkout).trim();
  let branch = '';
  try { branch = git(['symbolic-ref', '--short', '-q', 'HEAD'], checkout).trim(); } catch { branch = ''; }
  const count = (range) => Number(git(['rev-list', '--count', range], checkout).trim());
  return {
    checkout,
    head,
    branch: branch || null,
    expected_branch: main,
    behind: count(`HEAD..${ref(remote, main)}`),
    ahead: count(`${ref(remote, main)}..HEAD`),
    dirty: lines(git(['status', '--porcelain', '--untracked-files=normal'], checkout)).length,
  };
}

// The worktree metadata folder a `.git` file points to, or null when the folder
// is not a linked worktree (no `.git` file, a full repo, or an unreadable file).
export function pointerTarget(folder) {
  const dotgit = join(folder, '.git');
  try {
    if (!statSync(dotgit).isFile()) return null;
  } catch { return null; }
  const m = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(dotgit, 'utf8'));
  if (!m) return null;
  return isAbsolute(m[1]) ? m[1] : resolve(folder, m[1]);
}

// Folders under root whose `.git` points into this store's worktrees/ folder.
// `orphaned` is true when that metadata is gone.
export function worktreeFolders(root, store) {
  const prefix = join(store, 'worktrees') + '/';
  const out = [];
  for (const name of readdirSync(root).sort()) {
    const folder = join(root, name);
    try { if (!statSync(folder).isDirectory()) continue; } catch { continue; }
    const target = pointerTarget(folder);
    if (!target || !resolve(target).startsWith(prefix)) continue;
    out.push({ name, folder, orphaned: !existsSync(join(target, 'gitdir')) });
  }
  return out;
}

// Tree id of the folder's files as `git add -A` would stage them on top of base. The index and
// every new object go to a temporary folder; the store is only read.
export function snapshotTree(folder, store, scratch, base, remote = 'origin') {
  const index = join(scratch, 'index');
  const objects = join(scratch, 'objects');
  rmSync(index, { force: true });
  mkdirSync(objects, { recursive: true });
  const env = cleanEnv({
    GIT_DIR: store,
    GIT_WORK_TREE: folder,
    GIT_INDEX_FILE: index,
    GIT_OBJECT_DIRECTORY: objects,
    GIT_ALTERNATE_OBJECT_DIRECTORIES: join(store, 'objects'),
  });
  // Start from main's tree so files main tracks are compared even where a
  // .gitignore rule would skip them for a fresh index.
  git(['read-tree', base], folder, env);
  git(['-c', 'core.bare=false', '-c', 'gc.auto=0', '-c', 'core.fsmonitor=false', 'add', '-A', '--', '.'], folder, env);
  // Main may have removed an ignored file that still holds orphan-only edits.
  // Admit exact existing ignored paths only if reachable remote history tracked
  // them. NUL parsing and literal pathspecs keep unusual names from widening add.
  const ignored = git(['ls-files', '--others', '--ignored', '--exclude-standard', '-z'], folder, env).split('\0').filter(Boolean);
  if (ignored.length) {
    const refs = lines(git(['for-each-ref', '--format=%(refname)', `refs/remotes/${remote}/`], folder, env));
    if (!refs.length) throw new Error('No remote history available for ignored-file admission');
    const historical = new Set(git(['log', '--format=', '--name-only', '-z', '--full-history',
      '--no-renames', '-m', '--root', ...refs, '--'], folder, env).split('\0').filter(Boolean));
    for (const path of ignored.filter((p) => historical.has(p))) {
      git(['--literal-pathspecs', '-c', 'core.bare=false', '-c', 'gc.auto=0', '-c', 'core.fsmonitor=false',
        'add', '-f', '--', path], folder, env);
    }
  }
  return { tree: git(['write-tree'], folder, env).trim(), env };
}

// tree id -> first commit (newest first) on any remote branch with that tree.
export function remoteTrees(checkout, remote = 'origin') {
  const refs = lines(git(['for-each-ref', '--format=%(refname)', `refs/remotes/${remote}/`], checkout))
    .filter((r) => r !== `refs/remotes/${remote}/HEAD`);
  const map = new Map();
  if (!refs.length) return map;
  for (const l of lines(git(['log', '--format=%T %H', ...refs], checkout))) {
    const [tree, sha] = l.split(' ');
    if (!map.has(tree)) map.set(tree, sha);
  }
  return map;
}

function isAncestor(checkout, sha, target) {
  try { git(['merge-base', '--is-ancestor', sha, target], checkout); return true; } catch { return false; }
}

export function classify(folder, { checkout, store, remote, main, trees, scratch, files = false }) {
  let snap;
  try {
    snap = snapshotTree(folder, store, scratch, `${ref(remote, main)}^{tree}`, remote);
  } catch (e) {
    return { status: 'error', error: String(e.stderr || e.message || e).trim().split('\n')[0] };
  }
  const { tree, env } = snap;
  const sha = trees.get(tree);
  if (sha && isAncestor(checkout, sha, ref(remote, main))) return { status: 'on-main', tree, commit: sha };
  if (sha) {
    const branches = lines(git(['for-each-ref', '--format=%(refname)', '--contains', sha, `refs/remotes/${remote}/`], checkout))
      .map((r) => r.slice(`refs/remotes/${remote}/`.length))
      .filter((n) => n !== 'HEAD');
    return { status: 'pushed', tree, commit: sha, branches };
  }
  // Raw -z output alternates metadata and an untouched NUL-terminated path.
  // Disable rename detection explicitly: each record has exactly one pathname,
  // including when inherited git configuration would otherwise enable renames.
  const fields = git(['diff-tree', '--no-renames', '-r', '-z', `${ref(remote, main)}^{tree}`, tree], folder, env).split('\0');
  const diff = [];
  for (let i = 0; i < fields.length - 1; i += 2) {
    const [oldMode, newMode, oldBlob, blob, status] = fields[i].slice(1).split(' ');
    diff.push({ oldMode, newMode, oldBlob, blob, status, path: fields[i + 1] });
  }
  const changed = diff.map((d) => d.path);
  // File contents that no object in the store has: they exist only in this folder.
  const blobs = diff.filter((d) => !/^0+$/.test(d.blob));
  const missing = new Set(blobs.length
    ? lines(execFileSync('git', ['cat-file', '--batch-check=%(objectname) %(objecttype)'], {
      cwd: folder, env: cleanEnv({ GIT_DIR: store }), input: blobs.map((d) => d.blob).join('\n') + '\n', encoding: 'utf8', maxBuffer: 256 << 20,
    })).filter((l) => l.endsWith(' missing')).map((l) => l.split(' ')[0])
    : []);
  const onlyHere = blobs.filter((d) => missing.has(d.blob)).map((d) => d.path);
  const row = { status: 'unmatched', tree, changed_vs_main: changed.length, only_here: onlyHere.length };
  if (files) { row.files = changed; row.only_here_files = onlyHere; }
  return row;
}

export function report({ checkout, root, remote = 'origin', main = 'main', files = false } = {}) {
  const live = liveStatus(checkout, remote, main);
  const store = commonDir(checkout);
  const result = { live, linked: 0, orphans: [] };
  if (!root) return result;
  const folders = worktreeFolders(root, store);
  result.linked = folders.filter((f) => !f.orphaned).length;
  const trees = remoteTrees(checkout, remote);
  const scratch = mkdtempSync(join(tmpdir(), 'orphan-worktrees-'));
  try {
    for (const f of folders.filter((x) => x.orphaned)) {
      result.orphans.push({ name: f.name, folder: f.folder, ...classify(f.folder, { checkout, store, remote, main, trees, scratch, files }) });
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return result;
}

export function needsPerson(r) {
  const l = r.live;
  return l.branch !== l.expected_branch || l.behind > 0 || l.ahead > 0 || l.dirty > 0 || r.orphans.some((o) => o.status === 'unmatched' || o.status === 'error');
}

export function render(r, { remote = 'origin', main = 'main' } = {}) {
  const l = r.live;
  const on = l.behind === 0 && l.ahead === 0;
  const out = [
    `Live checkout: ${l.checkout}`,
    `  HEAD ${l.head.slice(0, 9)} on ${l.branch || '(detached)'}: ${on ? `on ${remote}/${main}` : `${l.behind} behind, ${l.ahead} ahead of ${remote}/${main}`}`,
    ...(l.branch === l.expected_branch ? [] : [`  Not on branch ${l.expected_branch}: switch the live checkout back to it`]),
    `  Working tree: ${l.dirty ? `${l.dirty} changed or untracked entries` : 'clean'}`,
  ];
  if (!r.orphans.length && !r.linked) return out.join('\n');
  const by = (s) => r.orphans.filter((o) => o.status === s);
  out.push(`Worktree folders still linked: ${r.linked}`, `Orphaned worktree folders: ${r.orphans.length}`);
  out.push(`  Same as a commit on ${main} (nothing to keep): ${by('on-main').length}`);
  for (const o of by('on-main')) out.push(`    ${o.name}  (${o.commit.slice(0, 9)})`);
  out.push(`  Same as a commit on a pushed branch: ${by('pushed').length}`);
  for (const o of by('pushed')) out.push(`    ${o.name}  (${o.commit.slice(0, 9)} on ${o.branches.join(', ') || 'a remote branch'})`);
  const un = by('unmatched').sort((a, b) => b.only_here - a.only_here || b.changed_vs_main - a.changed_vs_main);
  out.push(`  On no remote branch, turn into a PR or discard with sign-off: ${un.length}`);
  for (const o of un) {
    out.push(`    ${o.name}  ${o.changed_vs_main} paths differ from ${main}, ${o.only_here} with content found nowhere else`);
    // Quote control characters only for display; report/JSON retain exact names.
    const displayPath = (f) => /[\x00-\x1f\x7f]/.test(f) ? JSON.stringify(f) : f;
    for (const f of o.only_here_files || []) out.push(`      only here: ${displayPath(f)}`);
    for (const f of (o.files || []).filter((x) => !(o.only_here_files || []).includes(x))) out.push(`      differs:   ${displayPath(f)}`);
  }
  out.push(`  Could not be read: ${by('error').length}`);
  for (const o of by('error')) out.push(`    ${o.name}  ${o.error}`);
  return out.join('\n');
}

const USAGE = 'usage: node tools/orphan-worktrees.mjs --checkout <dir> [--root <dir>] [--remote origin] [--main main] [--json] [--files]';

export function main(argv = process.argv.slice(2), { out = console.log, err = console.error } = {}) {
  const opt = { remote: 'origin', main: 'main', json: false, files: false, checkout: '', root: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') opt.json = true;
    else if (a === '--files') opt.files = true;
    else if (['--remote', '--main', '--checkout', '--root'].includes(a) && i + 1 < argv.length) opt[a.slice(2)] = argv[++i];
    else { err(USAGE); return 2; }
  }
  if (!opt.checkout) { err(USAGE); return 2; }
  if (opt.root && !existsSync(opt.root)) { err(`no such folder: ${opt.root}`); return 2; }
  let r;
  try {
    r = report({ checkout: resolve(opt.checkout), root: opt.root ? resolve(opt.root) : '', remote: opt.remote, main: opt.main, files: opt.files });
  } catch (e) {
    const detail = String(e.stderr || '').trim() || e.message || 'ref not found';
    err(`${e.path || 'git'} failed: ${(e.spawnargs || []).join(' ')}: ${detail}`);
    return 2;
  }
  out(opt.json ? JSON.stringify(r, null, 2) : render(r, opt));
  return needsPerson(r) ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exitCode = main();
