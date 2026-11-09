#!/usr/bin/env node
// Read-only report of leftover live/integration side branches (wizard-ux#1224).
//
// Live == main: `integration/*`, `live/*`, `live-*` and `livefix/*` branches on
// the remote are left over from live-first integration. This lists each one and
// says whether it still carries commits that are not on main, compared by patch
// id (`git cherry`), so a cherry-picked or squash-equivalent commit counts as
// landed. Merge commits not on main count too, unless they are a clean re-merge
// of their parents. With --prs it also marks branches that an open PR uses
// (read through `gh`), which must not be touched until that PR closes.
//
// It never deletes or pushes anything. People with push rights act on the list.
// `owner-snapshot/*` and every other prefix are never matched.
//
// Usage: node tools/side-branches.mjs [--remote origin] [--main main] [--json] [--prs]
// Exit 0 when no side branches are left, 1 when some are, 2 on a git or gh
// error (including a remote or main tracking ref that does not exist).
// Run `git fetch --prune <remote>` first so the remote refs are current.
// Same logic as wizard-app-manager tools/side_branches.py (WAM#559).
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const PATTERNS = ['integration/', 'live/', 'live-', 'livefix/'];

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 });
}

export function isSideBranch(name) {
  return PATTERNS.some((p) => name.startsWith(p));
}

export function sideBranches(remote = 'origin', cwd, main = 'main') {
  // An empty list must mean "clean", never "wrong remote": fail when main is missing.
  git(['rev-parse', '--verify', '--quiet', `refs/remotes/${remote}/${main}^{commit}`], cwd);
  const prefix = `refs/remotes/${remote}/`;
  return git(['for-each-ref', '--format=%(refname)', prefix], cwd)
    .split('\n')
    .filter((l) => l.startsWith(prefix))
    .map((l) => l.slice(prefix.length))
    .filter((n) => n !== 'HEAD' && isSideBranch(n))
    .sort();
}

export function uniqueCommits(remote, main, branch, cwd) {
  // Commits on the branch whose patch is not on main (`git cherry` '+' lines).
  return git(['cherry', `${remote}/${main}`, `${remote}/${branch}`], cwd)
    .split('\n').filter((l) => l.startsWith('+')).length;
}

export function uniqueMerges(remote, main, branch, cwd) {
  // `git cherry` skips merges, so a conflict resolution or an extra staged change
  // would be invisible. A two-parent merge whose tree equals a clean re-merge of
  // its parents adds nothing; anything else (conflicts, edits, octopus) counts.
  const shas = git(['rev-list', '--merges', `${remote}/${main}..${remote}/${branch}`], cwd).split(/\s+/).filter(Boolean);
  let count = 0;
  for (const sha of shas) {
    const parents = git(['rev-list', '--parents', '-n', '1', sha], cwd).trim().split(/\s+/).slice(1);
    if (parents.length !== 2) { count += 1; continue; }
    let remerged;
    try {
      remerged = git(['merge-tree', '--write-tree', ...parents], cwd).split(/\s+/)[0];
    } catch {
      count += 1; // conflicted: the resolution is the merge's own content
      continue;
    }
    if (remerged !== git(['rev-parse', `${sha}^{tree}`], cwd).trim()) count += 1;
  }
  return count;
}

export function lastCommitDate(remote, branch, cwd) {
  return git(['log', '-1', '--format=%cs', `${remote}/${branch}`], cwd).trim();
}

// Head branch names of open PRs, read-only through `gh`.
export function openPrBranches(cwd) {
  const out = execFileSync('gh', ['pr', 'list', '--state', 'open', '--limit', '1000', '--json', 'number,headRefName'],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const map = new Map();
  for (const pr of JSON.parse(out)) map.set(pr.headRefName, [...(map.get(pr.headRefName) || []), pr.number]);
  return map;
}

export function report({ remote = 'origin', main = 'main', cwd, openPrs } = {}) {
  return sideBranches(remote, cwd, main).map((branch) => {
    const row = {
      branch,
      last: lastCommitDate(remote, branch, cwd),
      unique_commits: uniqueCommits(remote, main, branch, cwd) + uniqueMerges(remote, main, branch, cwd),
    };
    if (openPrs) row.open_prs = openPrs.get(branch) || [];
    return row;
  });
}

export function render(rows) {
  const pr = (r) => (r.open_prs && r.open_prs.length ? `  open PR ${r.open_prs.map((n) => `#${n}`).join(', ')}: leave until it closes` : '');
  const safe = rows.filter((r) => r.unique_commits === 0);
  const keep = rows.filter((r) => r.unique_commits).sort((a, b) => b.unique_commits - a.unique_commits);
  return [
    `Side branches left: ${rows.length}`,
    `No unique commits (safe to delete): ${safe.length}`,
    ...safe.map((r) => `  ${r.branch}  (last ${r.last})${pr(r)}`),
    `Unique commits, need a decision: ${keep.length}`,
    ...keep.map((r) => `  ${r.branch}  ${r.unique_commits} unique  (last ${r.last})${pr(r)}`),
  ].join('\n');
}

export function main(argv = process.argv.slice(2), { cwd, out = console.log, err = console.error } = {}) {
  const opt = { remote: 'origin', main: 'main', json: false, prs: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') opt.json = true;
    else if (a === '--prs') opt.prs = true;
    else if ((a === '--remote' || a === '--main') && i + 1 < argv.length) opt[a.slice(2)] = argv[++i];
    else { err(`usage: node tools/side-branches.mjs [--remote origin] [--main main] [--json] [--prs]`); return 2; }
  }
  let rows;
  try {
    rows = report({ remote: opt.remote, main: opt.main, cwd, openPrs: opt.prs ? openPrBranches(cwd) : undefined });
  } catch (e) {
    const detail = String(e.stderr || '').trim() || 'ref not found';
    err(`${e.path || 'git'} failed: ${(e.spawnargs || []).join(' ')}: ${detail}`);
    return 2;
  }
  out(opt.json ? JSON.stringify(rows, null, 2) : render(rows));
  return rows.length ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exitCode = main();
