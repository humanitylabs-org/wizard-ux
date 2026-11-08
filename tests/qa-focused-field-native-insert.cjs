// SYNTHETIC QA ONLY: no network, no owner data. Dictation into a contenteditable goes through the native editing pipeline
// (execCommand insertText), so an attached Android IME / CodeMirror sees ONE real beforeinput + input, never a
// hand-made DOM edit plus a synthetic input event (suspected cause of dictation pasted twice in Notes on Android).
// QA_PLAYWRIGHT=<playwright module> node tests/qa-focused-field-native-insert.cjs
// FF_JS=<focused-field.js to test> (default web/core/focused-field.js; point at origin/main's copy for the baseline)
// QA_CM_DIR=<dir with index.html + live-preview.js, the real Notes CodeMirror 6 editor> optional extra case.
const { chromium } = require('../tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path'), http = require('http');
const FF = process.env.FF_JS || path.join(__dirname, '../web/core/focused-field.js');
const checks = [], WORDS = 'hello world';
const ok = (v, name, extra) => { checks.push({ name, pass: !!v }); console.log(v ? 'PASS' : 'FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); };
const count = (s, w) => s.split(w).length - 1;
// Listeners record beforeinput/input per element; `trusted` is true only for browser-generated events.
const PAGE = `<!doctype html><body>
<div id="ce" contenteditable="true">abc</div>
<div id="cm" contenteditable="true"><div class="cm-line">first line</div><div class="cm-line">second</div></div>
<textarea id="ta">abc</textarea><input id="in" value="abc"><button id="away">away</button>
<script>
window.log = {};
for (const id of ['ce','cm','ta','in']) {
  const el = document.getElementById(id), l = log[id] = { before: 0, input: 0, trusted: 0 };
  el.addEventListener('beforeinput', () => l.before++);
  el.addEventListener('input', e => { l.input++; if (e.isTrusted) l.trusted++; });
}
// CodeMirror-style model: the doc is whatever the DOM says after every mutation/input batch, one update per batch.
window.cmDoc = () => [...document.querySelectorAll('#cm .cm-line')].map(n => n.textContent).join('\\n');
</script>`;
async function run(page, id, mode) {
  return page.evaluate(({ id, mode, WORDS }) => {
    const el = document.getElementById(id), ff = WizCore.focusedField.create({ document });
    el.focus();
    if (el.isContentEditable) {
      const target = id === 'cm' ? el.querySelector('.cm-line').firstChild : el.firstChild, s = getSelection(), r = document.createRange();
      r.setStart(target, target.length); r.collapse(true); s.removeAllRanges(); s.addRange(r);
    } else el.setSelectionRange(el.value.length, el.value.length);
    for (const k of Object.keys(log[id])) log[id][k] = 0;
    const seal = ff.capture();
    if (mode === 'blurred') el.blur();
    if (mode === 'switched') document.getElementById(id === 'ce' ? 'in' : 'ta').focus();
    if (mode === 'false') document.execCommand = () => false;
    if (mode === 'throw') document.execCommand = () => { throw new Error('boom'); };
    const result = ff.insert(seal, WORDS);
    return { result, text: el.isContentEditable ? (id === 'cm' ? cmDoc() : el.textContent) : el.value, log: { ...log[id] }, focused: document.activeElement === el, activeId: document.activeElement.id };
  }, { id, mode, WORDS });
}
async function fresh(browser) {
  const page = await browser.newPage(); await page.setContent(PAGE); await page.addScriptTag({ path: FF }); return page;
}
(async () => {
  const browser = await chromium.launch(), pages = [];
  const t = async (id, mode) => { const p = await fresh(browser); pages.push(p); return run(p, id, mode); };
  for (const id of ['ce', 'cm']) {
    const r = await t(id, 'native');
    ok(r.result === true && count(r.text, WORDS) === 1, `${id}: words land exactly once`, r.text);
    ok(r.text.includes('abc ' + WORDS) || r.text.includes('first line ' + WORDS), `${id}: neighbour space added (as plain fields do)`, r.text);
    ok(r.log.input === 1, `${id}: exactly one input event`, r.log);
    ok(r.log.before <= 1, `${id}: at most one beforeinput`, r.log);
    // Chromium's execCommand fires a trusted input (and, on some engines, a beforeinput); the fallback fires only an untrusted one.
    ok(r.log.trusted === 1 && r.log.input === r.log.trusted, `${id}: native pipeline (the one input event is browser-made, no synthetic event)`, r.log);
    const b = await t(id, 'blurred');
    ok(b.result === true && count(b.text, WORDS) === 1 && b.log.input === 1, `${id}: sealed field not focused at insert still receives it once`, { text: b.text, log: b.log });
    const sw = await t(id, 'switched'), other = id === 'ce' ? 'in' : 'ta';
    ok(sw.result === true && count(sw.text, WORDS) === 1 && sw.log.input === 1 && sw.activeId === other, `${id}: user moved to another field during the take: words land once, focus stays on the new field`, { text: sw.text, log: sw.log, active: sw.activeId });
    for (const mode of ['false', 'throw']) {
      const f = await t(id, mode);
      ok(f.result === true && count(f.text, WORDS) === 1 && f.log.input === 1 && f.log.before === 0 && f.log.trusted === 0, `${id}: fallback (execCommand ${mode === 'false' ? 'returns false' : 'throws'}) inserts once with one synthetic input`, { text: f.text, log: f.log });
    }
  }
  for (const id of ['ta', 'in']) {
    const r = await t(id, 'native');
    ok(r.result === true && r.text === 'abc ' + WORDS && r.log.input === 1 && r.log.before === 0, `${id}: plain field unchanged (once, one input)`, r);
  }
  if (process.env.QA_CM_DIR) {
    const dir = process.env.QA_CM_DIR;
    const srv = http.createServer((q, r) => {
      const name = q.url === '/' ? 'index.html' : q.url.slice(1), f = name === 'focused-field.js' ? FF : path.join(dir, name);
      try { r.writeHead(200, { 'content-type': f.endsWith('.js') ? 'application/javascript' : 'text/html' }); r.end(fs.readFileSync(f)); } catch { r.writeHead(404); r.end(); }
    }).listen(0);
    for (const mode of ['native', 'false']) {
      const page = await browser.newPage(); await page.goto(`http://localhost:${srv.address().port}/`); await page.waitForFunction(() => window.ready);
      const r = await page.evaluate(async ({ mode, WORDS }) => {
        ed.setValue('one two three'); ed.select(13);
        const c = document.querySelector('.cm-content'), l = { before: 0, input: 0 };
        c.addEventListener('beforeinput', () => l.before++); c.addEventListener('input', () => l.input++);
        if (mode === 'false') document.execCommand = () => false;
        const seal = WizCore.focusedField.create({ document }).capture(), result = seal ? WizCore.focusedField.create({ document }).insert(seal, WORDS) : 'no seal';
        await new Promise(r => setTimeout(r, 300));
        return { result, doc: ed.view.state.doc.toString(), dom: c.textContent, l };
      }, { mode, WORDS });
      ok((mode === 'false' ? r.doc.replace(/\s+/g, '') === 'onetwothree' + WORDS.replace(/\s+/g, '') : r.doc === 'one two three ' + WORDS) && count(r.dom, WORDS) === 1, `real Notes CodeMirror 6 (${mode}): once in document and DOM`, r);
      ok(r.l.input === 1 && r.l.before <= 1, `real Notes CodeMirror 6 (${mode}): one input event, at most one beforeinput`, r.l);
    }
    srv.close();
  }
  await browser.close();
  const failed = checks.filter(c => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
