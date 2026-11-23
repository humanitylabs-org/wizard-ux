import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { withShellParts } from './fixtures/shell-parts.mjs';
import { between, runRecording } from './fixtures/source-slice.mjs';
import { desktopPart } from './fixtures/q1-desktop-boot.mjs';
const source = withShellParts(fs.readFileSync(new URL('../web/desktop/desktop.js', import.meta.url), 'utf8'));
function setup() {
 const W = { chat: { id: 'chat', app: 'chats', thread: 'original' }, other: { id: 'other' } };
 const ws = [{ focus: 'chat' }]; let opened = null, focused = null;
 const ctx = vm.createContext({ window: {}, URL, location: { origin: 'https://wizard.example', href: 'https://wizard.example/wizard-os-home/' },
  APP: { troubleshooter: { id: 'troubleshooter', kind: 'wizard', url: '/troubleshoot/' } }, W, ws, cur: 0,
  appAt: rel => rel.startsWith('/troubleshoot/') ? { id: 'troubleshooter' } : null,
  openApp: app => { opened = { root: app.id }; return true; },
  newWin: data => { opened = W.repair = { id: 'repair', ...data }; return opened; },
  closeWin: id => { delete W[id]; }, focusWin: id => { focused = id; } });
 const start = source.indexOf('  const hostedOpenable =');
 const end = source.indexOf('  // Only trusted system windows', start);
 vm.runInContext(source.slice(start, end), ctx);
 return { ctx, W, open: (...args) => ctx.window.WizOpenApp(...args), opened: () => opened, focused: () => focused };
}
test('desktop sole Sign in action preserves provider and run deep link', () => {
 const t = setup(); const url = '/troubleshoot/?provider=claude&run=held-run';
 assert.equal(t.open('troubleshooter', url), true);
 assert.equal(t.opened().url, url); assert.equal(t.opened().workflow, true); assert.equal(t.opened().returnWid, 'chat');
 assert.equal(t.ctx.closeWorkflow(t.opened()), true); assert.equal(t.focused(), 'chat');
 assert.equal(t.W.chat.thread, 'original'); assert.equal(t.W.repair, undefined);
 // the app's own Back (WizardApp.nav.back through the frame's services) and Esc both close the workflow
 const fr = frameBack({ workflow: true }); assert.deepEqual(fr.closed, [['workflow', 'repair']], 'nav.back closes the workflow');
 const esc = escBack({ id: 'repair', app: 'frame', workflow: true }, true); assert.equal(esc.r, 'workflow'); assert.deepEqual(esc.closed, [['workflow', 'repair']]);
});
// The real watchFrame (desktop/desktop-frames.js): the Back it hands an app frame's services.
function frameBack(win, { workflowCloses = true } = {}) {
 const closed = []; let opts = null; const w = { id: 'repair', app: 'frame', appId: 'troubleshooter', ...win };
 const P = desktopPart('frames', { APP: { troubleshooter: { id: 'troubleshooter', url: '/troubleshoot/' } }, desktopVars: { W: { repair: w }, ws: [{ focus: 'repair' }], cur: 0, homeOpen: false },
  closeWorkflow: x => (closed.push(['workflow', x.id]), workflowCloses && !!x.workflow), closePreview: x => (closed.push(['preview', x.id]), !!x.preview) },
  { WizAppServices: { attach: (f, o) => { opts = o; return () => {}; } } });
 P.watchFrame({ addEventListener() {} }, { dataset: { win: 'repair' } });
 opts.back();
 return { closed };
}
// Esc / ⌥Z on a frame window (desktop/desktop-keys.js desktopBack's frame branch), the app at its root.
function escBack(f, workflowCloses) {
 const keys = withShellParts(fs.readFileSync(new URL('../web/desktop/desktop-keys.js', import.meta.url), 'utf8')), closed = [];
 const E = runRecording(`this.f = f => {\n${between(keys, "    if (f?.app === 'frame') {", "\n    }")}\n    }\n};`, { window: { WizAppServices: { back: () => '' } }, desktopVars: { ws: [{ mono: false }], cur: 0 },
  closeWorkflow: x => (closed.push(['workflow', x.id]), workflowCloses), closeWin: id => closed.push(['close', id]) });
 return { r: E.f(f), closed };
}
test('desktop repair deep link rejects another origin or app path', () => {
 const t = setup();
 for (const url of ['https://attacker.example/troubleshoot/?run=held-run', '/other/?run=held-run']) assert.equal(t.open('troubleshooter', url), false);
 assert.equal(t.opened(), null);
 assert.equal(t.open('troubleshooter'), true); assert.equal(t.opened().root, 'troubleshooter');
});
test('Back cannot close an ordinary window or a stale workflow', () => {
 const t = setup(); assert.equal(t.ctx.closeWorkflow(t.W.chat), false);
 assert.equal(t.ctx.closeWorkflow({ id: 'gone', workflow: true }), false);
 assert.ok(t.W.chat);
});
test('an app in a link preview window that says it is done (nav.back) closes the preview, as Esc does (Reader hand-off, 7 Nov 2026)', () => {
 // Gate 7 Nov: Reader handed a bot-walled page to a new tab, then called WizardApp.nav.back(); desktop answered only for
 // sign-in workflows, so the Reader preview stayed open beside the chat showing "This site does not let Reader in".
 const t = setup(); t.W.reader = { id: 'reader', app: 'frame', appId: 'browser', preview: true };
 assert.equal(t.ctx.closePreview(t.W.reader), true); assert.equal(t.W.reader, undefined); assert.ok(t.W.chat);
 assert.equal(t.ctx.closePreview(t.W.chat), false, 'an ordinary window is never closed by an app'); assert.ok(t.W.chat);
 assert.equal(t.ctx.closePreview({ id: 'gone', preview: true }), false, 'a stale preview is ignored');
 // the app's own Back: not a workflow, so the preview closes
 assert.deepEqual(frameBack({ preview: true }).closed, [['workflow', 'repair'], ['preview', 'repair']]);
 assert.deepEqual(frameBack({ workflow: true, preview: true }).closed, [['workflow', 'repair']], 'a workflow closes first, once');
});
