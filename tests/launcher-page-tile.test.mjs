import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { between } from './fixtures/source-slice.mjs';

// A launcher link (launcher.json) whose URL is one of the agent's Pages must open in the Pages window. In a plain app
// frame the sandboxed, opaque-origin page is unreadable, so the frame watcher showed "can't show in a window".
// Both shells' real openApp runs here, up to its page route (wizard-ux issue 1674: tests run the code).
const read = f => readFileSync(new URL(f, import.meta.url), 'utf8');
const SHELLS = [
  ['desktop', '../web/desktop/desktop-resize.js', 'function openApp(a, opts = {}) {', '    // a layout placing the shell'],
  ['phone', '../web/app-search.js', 'function openApp(a, extra = {}, opts = {}) {', "    if (a.id !== 'troubleshooter' && a.kind === 'wizard'"],
];
for (const [shell, file, head, stop] of SHELLS) {
  test(`${shell}: a launcher tile pointing at /pages/<slug>/ opens the Pages window`, () => {
    const made = [], placed = [], ctx = { made, placed,
      window: { WosPages: { match: url => (/^\/pages\/([^/]+)\//.exec(url) || [])[1] || null } },
      findWin: () => null, focusWin() {}, newWin: (w, o) => made.push(w), closeSheets() {}, openingEnd() {},
      placeApp: (find, w) => placed.push({ w, mine: find({ app: 'pages', pageSlug: w.pageSlug }), other: find({ app: 'pages', pageSlug: 'x' }) }) };
    vm.createContext(ctx);
    vm.runInContext(`${between(read(file), head, stop)}    return 'not a page'; }\nthis.openApp = openApp;`, ctx);
    assert.equal(ctx.openApp({ id: 'tile', url: '/pages/trip-plan/', kind: 'wizard' }), true);
    const opened = shell === 'desktop' ? made : placed.map(p => p.w);
    assert.deepEqual(JSON.parse(JSON.stringify(opened)), [{ app: 'pages', appId: 'pages', pageSlug: 'trip-plan' }]);
    if (shell === 'phone') assert.deepEqual([placed[0].mine, placed[0].other], [true, false], 'reuses the Pages window showing that page');
    assert.equal(ctx.openApp({ id: 'cal', url: '/calendar/', kind: 'wizard' }), 'not a page', 'other apps go on to their own frame');
  });
}
