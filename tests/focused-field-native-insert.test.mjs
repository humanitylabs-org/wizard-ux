// Dictation into a contenteditable uses the native editing pipeline (James's Notes on Android pasted dictation twice).
// Browser proof: tests/qa-focused-field-native-insert.cjs (runs when QA_PLAYWRIGHT points at a playwright module;
// QA_CM_DIR adds the real Notes CodeMirror 6 editor). Otherwise this static guard keeps the wiring in place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const src = readFileSync(new URL('../web/core/focused-field.js', import.meta.url), 'utf8');
test('contenteditable insert tries execCommand insertText before any manual DOM edit', () => {
  const body = src.slice(src.indexOf('function insert('), src.indexOf('bind(topDoc);'));
  const native = body.indexOf("execCommand('insertText'"), manual = body.indexOf('r.insertNode(node)');
  assert.ok(native > 0 && manual > native);
  assert.match(body, /if \(native\) \{ refresh\(\); return true; \}/);
  assert.match(body, /el\.setRangeText\(t, start, end, 'end'\)/); // plain fields keep their own path
});
test('browser regression (native pipeline, one input event, fallback)', { skip: !process.env.QA_PLAYWRIGHT }, () => {
  const r = spawnSync(process.execPath, [new URL('./qa-focused-field-native-insert.cjs', import.meta.url).pathname], { encoding: 'utf8', env: process.env });
  assert.equal(r.status, 0, r.stdout.slice(-3000) + r.stderr.slice(-1000));
});
