import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkAppReuse, parseAddedDiff } from '../tools/reuse-check-app.mjs';
const inventory = readFileSync(new URL('../docs/COMPONENTS.md', import.meta.url), 'utf8');
const body = 'Reuse:\n- voice: REUSE WizardApp.capture.start\n- chat: REUSE WizardApp.nav.openThread\n- orb: REUSE Orb.create\n- scroll: REUSE WizAppReadingPosition';
const file = (text, path = 'src/app.js') => ({ path, added: [{ line: 7, text }] });
const check = (files, b = body) => checkAppReuse({ body: b, files, inventory });

test('all app PRs declare reuse against canonical inventory, even CI', () => {
  assert.deepEqual(check([file('jobs:', '.github/workflows/check.yml')]), []);
  for (const b of ['', 'Reuse: n/a (CI only)', '<!--' + body + '-->', 'Reuse:\n- chat: REUSE MyChat']) assert.ok(check([], b).length);
  assert.deepEqual(check([], 'Reuse:\n- capture: EXTEND WizardApp.capture.start'), []);
});

for (const [id, snippets, api] of [
  ['voice', ['navigator.mediaDevices.getUserMedia({audio:true})', 'new MediaRecorder(stream)', 'new window.MediaRecorder(stream)', 'ctx.createMediaStreamSource(stream)', 'micContext = new AudioContext()'], 'WizardApp.capture'],
  ['chat', ['const chatComposer = el()', '<textarea id="chat-input"></textarea>', 'function renderChat() {}', 'fetch("/v1/chat/completions", opts)', 'new EventSource("/api/chat/stream")', 'stream: true'], 'WizardApp.nav.openThread'],
  ['orb', ['function drawOrb() {}', '<canvas id="orb"></canvas>', '<svg class="orb"></svg>', '@keyframes orb-spin {', '.orb { background: red; }'], 'Orb.create'],
  ['scroll', ['localStorage.setItem("scroll-position", top)', 'sessionStorage.setItem("readingPosition", position)', 'function saveScrollPosition() {}'], 'WizAppReadingPosition'],
]) test(`added ${id} forks fail with file, line and shared row/API`, () => {
  for (const source of snippets) {
    const result = check([file(source)]).join('\n');
    assert.ok(result.includes('src/app.js:7:'), source);
    assert.ok(result.includes(`duplicate ${id}`), source);
    assert.ok(result.includes(api), source);
    assert.ok(result.includes('docs/COMPONENTS.md'), source);
  }
});

test('shared entry points and playback-only AudioContext are allowed', () => {
  for (const source of ['WizardApp.capture.start({kind:"audio"})', 'WizardApp.voice.transcribe(file)', 'WizardApp.voiceInput.register(handler)', 'WizardApp.nav.openThread(id)', 'Orb.create(canvas, null, {R:20})', 'const audio = new AudioContext()', 'window.WizAppReadingPosition']) assert.deepEqual(check([file(source)]), []);
});

test('deleted/context lines and old code are not scanned; line numbers survive multiple hunks/files', () => {
  const files = parseAddedDiff('diff --git a/a.js b/a.js\n--- a/a.js\n+++ b/a.js\n@@ -3,2 +3,2 @@\n-old = new MediaRecorder(s);\n+WizardApp.capture.start({});\n old = new MediaRecorder(s);\n@@ -18,0 +19,1 @@\n+// hello\ndiff --git a/b.js b/b.js\n--- a/b.js\n+++ b/b.js\n@@ -0,0 +1 @@\n+new MediaRecorder(s);');
  assert.equal(files[0].added[1].line, 19);
  assert.deepEqual(check(files.slice(0, 1)), []);
  assert.match(check(files).join(), /b.js:1: duplicate voice/);
  assert.deepEqual(check([file('new MediaRecorder(s)', 'README.md')]), []);
});

test('NEW requires an exact newly added inventory row and only waives its named capability', () => {
  const source = file('new MediaRecorder(s)');
  const row = file('| Staged capture adapter | `SharedCapture` | app recorder |', 'docs/COMPONENTS.md');
  const b = 'Reuse:\n- voice: NEW: Staged capture adapter';
  assert.deepEqual(check([source, row], b), []);
  assert.ok(check([source], b).length);
  assert.ok(check([source, row], 'Reuse:\n- voice: NEW: Other row').length);
  assert.ok(check([source, row], 'Reuse:\n- x: NEW: Staged capture adapter').length);
  assert.ok(check([source, row, file('function renderChat() {}')], b).join().includes('duplicate chat'));
  assert.ok(check([source, file('| Mic, camera, screen capture | `WizardApp.capture.start` | x |', 'docs/COMPONENTS.md')], 'Reuse:\n- voice: NEW: Mic, camera, screen capture').length);
  assert.ok(check([source], 'Reuse:\n- voice: REUSE WizardApp.capture.start\n<!-- NEW: capture -->').length);
});
