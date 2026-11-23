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

test('every local script and stylesheet in both shells carries the release token', t => {
  const d = stamped(t);
  for (const page of ['index.html', 'desktop.html']) {
    const h = inTree(d, page), v = tokenOf(h);
    assert.match(v || '', RE, `${page} has its release meta`);
    const refs = [...h.matchAll(/(?:src|href)="((?:\/wizard-os-home\/)?[A-Za-z0-9._][A-Za-z0-9._/-]*\.(?:js|css))(?:\?v=([0-9a-f]+))?"/g)];
    assert.ok(refs.length > 40, `${page} has its links`);
    for (const [, ref, got] of refs) {
      if (/(^|\/)(data|summaries)\.js$/.test(ref)) { assert.equal(got, undefined, `${ref} stays unstamped`); continue; }
      assert.equal(got, v, `${page}: ${ref} carries the release token`);
    }
  }
});

test('module imports carry the token too, so a changed dependency gets a new URL (Codex, #428)', t => {
  const d = stamped(t), v = tokenOf(inTree(d, 'index.html'));
  const swipe = inTree(d, 'core/thread-swipe-back.js');
  assert.ok(swipe.includes(`from './swipe-intent.js?v=${v}'`), 'thread-swipe-back imports a stamped swipe-intent');
  const store = inTree(d, 'store/store.js');
  assert.ok(store.includes(`from './store-status.js?v=${v}'`));
  const obs = inTree(d, 'skins/obsidian/skin.js');
  assert.ok(obs.includes(`from './intro.js?v=${v}'`));
  const land = inTree(d, 'skins/landscapes/skin.js');
  assert.ok(land.includes(`from '../obsidian/intro.js?v=${v}'`));
});

// Live box, 18 Nov 2026: kit/controls.css came back as a 304 on every open because phone-connect.css @imports it
// unstamped, so it never got the year-long cache the stamped files get (wizard-ux#1583).
test('relative CSS @imports carry the token; other origins and absolute paths stay plain', t => {
  const d = stamped(t), v = tokenOf(inTree(d, 'index.html'));
  assert.ok(inTree(d, 'core/phone-connect.css').includes(`@import url("../kit/controls.css?v=${v}");`));
  writeFileSync(join(d, 'probe.css'), '@import url("https://x.org/a.css");\n@import "/abs.css";\n@import \'./b.css\';\n');
  execFileSync('sh', [STAMP, d]);
  const w = tokenOf(inTree(d, 'index.html')), css = inTree(d, 'probe.css');
  assert.ok(css.includes('@import url("https://x.org/a.css");') && css.includes('@import "/abs.css";'));
  assert.ok(css.includes(`@import './b.css?v=${w}';`));
  const pc = inTree(d, 'core/phone-connect.css');
  assert.ok(pc.includes(`controls.css?v=${w}"`) && !/\?v=[0-9a-f]+\?v=/.test(pc), 'a restamp swaps the token, never adds a second');
});
