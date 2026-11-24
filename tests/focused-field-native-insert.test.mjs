// Dictation into a contenteditable uses the native editing pipeline (James's Notes on Android pasted dictation twice).
// Browser proof: tests/qa-focused-field-native-insert.cjs (runs when QA_PLAYWRIGHT points at a playwright module;
// QA_CM_DIR adds the real Notes CodeMirror 6 editor). Otherwise this static guard keeps the wiring in place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
const src = readFileSync(new URL('../web/core/focused-field.js', import.meta.url), 'utf8');
// The real insert() from focused-field.js, run in node:vm on a fake editable and a fake document (issue 1674).
function field({ plain = false, native = true } = {}) {
  const log = [], text = { nodeType: 3, data: 'Hello', childNodes: [] };
  const range = { startContainer: text, endContainer: text, startOffset: 5, deleteContents: () => log.push('delete'), insertNode: n => log.push('insertNode:' + n.data), setStartAfter() {}, collapse() {} };
  const doc = { body: {}, activeElement: null, createTextNode: data => ({ data }),
    execCommand: (cmd, ui, t) => { log.push(`exec:${cmd}:${t}`); return native; },
    defaultView: { getSelection: () => ({ removeAllRanges() {}, addRange() {} }), InputEvent: class { constructor(type, o) { this.type = type; this.data = o.data; } } } };
  const el = { value: 'Hello', innerHTML: 'Hello', selectionStart: 5, selectionEnd: 5, matches: () => plain, contains: () => true, focus() { doc.activeElement = el; },
    setRangeText: (t, a, b) => log.push(`setRangeText:${t}:${a}:${b}`), dispatchEvent: e => log.push('event:' + e.type) };
  const seal = { el, doc, range, value: 'Hello', start: 5, end: 5, changed: false, release: () => log.push('release'), observer: { takeRecords: () => [] } };
  const ctx = { insertRemote: () => false, validContext: () => true, refresh: () => log.push('refresh') };
  vm.createContext(ctx);
  vm.runInContext(`${src.slice(src.indexOf('    function insert(seal, text) {'), src.indexOf('    bind(topDoc);'))}\nthis.insert = insert;`, ctx);
  return { log, run: t => ctx.insert(seal, t) };
}

test('contenteditable insert tries execCommand insertText before any manual DOM edit', () => {
  const nat = field({ native: true });
  assert.equal(nat.run('world'), true);
  assert.deepEqual(nat.log, ['release', 'exec:insertText: world', 'refresh'], 'the native input event is the only one: no manual edit, no second event');
  const fallback = field({ native: false });
  assert.equal(fallback.run('world'), true);
  assert.deepEqual(fallback.log, ['release', 'exec:insertText: world', 'delete', 'insertNode:world', 'event:input', 'refresh'], 'manual insertion only after the native path refused');
  const plain = field({ plain: true }); // plain fields keep their own path
  assert.equal(plain.run('world'), true);
  assert.deepEqual(plain.log, ['release', 'setRangeText: world:5:5', 'event:input', 'refresh']);
});
test('browser regression (native pipeline, one input event, fallback)', { skip: !process.env.QA_PLAYWRIGHT }, () => {
  const r = spawnSync(process.execPath, [new URL('./qa-focused-field-native-insert.cjs', import.meta.url).pathname], { encoding: 'utf8', env: process.env });
  assert.equal(r.status, 0, r.stdout.slice(-3000) + r.stderr.slice(-1000));
});
