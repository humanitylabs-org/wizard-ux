// Split from versioned-assets.test.mjs so the halves run in parallel (suite time, wizard-ux#1674).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { withSkinHostParts } from './fixtures/skin-host-parts.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';

// Robert's iPhone (24 Oct 2026) started a new shell against a cached old notif-bell.js and died at boot.
// The image build stamps every local script/stylesheet with its file hash so a release only ever loads its own files.
const STAMP = new URL('../tools/stamp-assets.sh', import.meta.url).pathname;
const WEB = new URL('../web', import.meta.url).pathname;
function stamped(t, edit = () => {}) { // (edit: a change to the copy before the stamp runs)
  const d = mkdtempSync(join(tmpdir(), 'stamp-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  cpSync(WEB, d, { recursive: true }); edit(d);
  execFileSync('sh', [STAMP, d]); return d;
}

// a file of a tree the stamp (or the image build) just wrote: its output, not source
const inTree = (dir, f) => readFileSync(join(dir, f), 'utf8');

const RE = /^[0-9a-f]{12}$/;
const tokenOf = h => h.match(/<meta name="wos-release" content="([0-9a-f]+)">/)?.[1];

test('any change anywhere in web/ moves the token; rerunning the stamp is a no-op', t => {
  const a = stamped(t);
  const b = stamped(t, d => writeFileSync(join(d, 'core/swipe-intent.js'), inTree(d, 'core/swipe-intent.js') + '\n// next release\n'));
  const once = inTree(b, 'index.html'), onceImp = inTree(b, 'core/thread-swipe-back.js');
  execFileSync('sh', [STAMP, b]);
  assert.notEqual(tokenOf(inTree(a, 'index.html')), tokenOf(once), 'a dependency-only change still moves the token');
  assert.equal(inTree(b, 'core/thread-swipe-back.js'), onceImp, 'imports are not stamped twice');
  assert.doesNotMatch(inTree(b, 'index.html'), /\?v=[0-9a-f]+\?v=/, 'links are not stamped twice');
  assert.equal((inTree(b, 'index.html').match(/name="wos-release"/g) || []).length, 1);
});

test('a layered hotfix restamps an already-stamped tree with one new release token', t => {
  const d = stamped(t);
  const before = tokenOf(inTree(d, 'index.html'));
  writeFileSync(join(d, 'core/agents.js'), inTree(d, 'core/agents.js') + '\n// layered hotfix\n');
  execFileSync('sh', [STAMP, d]);
  const index = inTree(d, 'index.html'), after = tokenOf(index);
  assert.notEqual(after, before, 'the layered change moves the release token');
  for (const page of ['index.html', 'desktop.html']) {
    const html = inTree(d, page);
    assert.equal(tokenOf(html), after, `${page} carries the new release meta`);
    assert.doesNotMatch(html, new RegExp(`\\?v=${before}(?:["'])`), `${page} has no previous release URL`);
  }
  assert.match(inTree(d, 'core/thread-swipe-back.js'), new RegExp(`from './swipe-intent\\.js\\?v=${after}'`));
});
