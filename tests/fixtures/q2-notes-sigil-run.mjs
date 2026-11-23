// Run the real tests/qa-notes-sigil.cjs (a Playwright canary) in node:vm against a fake Chromium (wizard-ux issue
// 1674: tests run the code). The script's own fixture HTTP server really starts; the fake pages answer each
// page/frame evaluate by what the function reads, record every key press and locator, and can be told to misbehave:
//   stopAtPalette: the desktop palette never opens (the run stops there, so a test can read what it pressed/waited on)
//   writes: [[method, path]] the fake page sends to the script's own server while it loads (a shell write attempt)
//   pageError: a browser page error is reported on the first page
//   legacy: candidate pages paint the old opaque logo (what the baseline run must find)
// Returns { presses, locators, contexts, exitCode, report, errors, served }.
import vm from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const TESTS = new URL('../', import.meta.url).pathname;
const SRC = fs.readFileSync(path.join(TESTS, 'qa-notes-sigil.cjs'), 'utf8');
const realRequire = createRequire(path.join(TESTS, 'x.cjs'));

export async function runNotesSigil({ baseline = false, stopAtPalette = false, writes = [], pageError = false, legacy = false } = {}) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'q2-notes-sigil-'));
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'q2-notes-fixture-'));
  const baselineFile = path.join(fixture, 'baseline-sigils.js'); fs.writeFileSync(baselineFile, '/* baseline sigils */');
  const presses = [], locators = [], contexts = [], errors = [], served = [];
  let origin = '', done, pageErrorSent = false;
  const finished = new Promise(r => { done = r; });
  const never = new Promise(() => {});
  const fetchFrom = async (p, method = 'GET') => { const r = await fetch(origin + p, { method }); const t = await r.text(); served.push({ method, path: p, status: r.status, body: t }); };
  const style = (version) => (version === 'baseline' || legacy)
    ? { child: 'sglogo', logo: 'url(/wizard-os-home/store-data/app-logo/notes?v=0123456789abcdef)', mask: 'none', shadow: 'none' }
    : { child: 'sgi sg-notes', logo: '', mask: 'url(notes-mask.svg)', shadow: 'rgba(225, 214, 255, 0.8) 0px 0px 0px 2px, rgba(0, 0, 0, 0.4) 0px 4px 12px 0px' };
  function makePage(ctx) {
    let skin = 'obsidian';
    const handlers = {};
    const locator = (sel, opts) => {
      locators.push(opts?.hasText ? [sel, String(opts.hasText)] : [sel]);
      const loc = {
        sel, opts,
        first: () => loc,
        filter: f => { locators.push(['filter', sel, f.has?.sel, String(f.has?.opts?.hasText || '')]); return loc; },
        waitFor: async () => { if (stopAtPalette && sel === '#palette:not([hidden])') return never; },
        getAttribute: async () => 'pal-o3',
        hover: async () => {}, click: async () => {},
        evaluate: async fn => { const t = String(fn); if (t.includes("classList.contains('sel')")) return true; return style(ctx.version); },
      };
      return loc;
    };
    const frame = {
      url: () => origin + '/notes/',
      waitForSelector: async () => {}, waitForFunction: async () => {},
      evaluate: async fn => {
        const t = String(fn);
        if (t.includes('__qaDocument===document')) return true;
        if (t.includes('colorScheme')) return { skin, scheme: skin === 'obsidian-light' ? 'light' : 'dark', base: '#000' };
        return undefined;
      },
    };
    const page = {
      on: (n, f) => { handlers[n] = f; },
      setDefaultTimeout() {},
      route: async () => {},
      goto: async url => {
        ctx.urls.push(url);
        for (const [m, p] of writes) await fetchFrom(p, m);
        await fetchFrom('/wizard-os-home/core/sigils.js');
        if (pageError && !pageErrorSent && handlers.pageerror) { pageErrorSent = true; handlers.pageerror(new Error('synthetic page error')); }
      },
      waitForFunction: async () => {}, waitForSelector: async () => {},
      evaluate: async (fn, arg) => {
        const t = String(fn);
        if (t.includes('dataset.shell') && !t.includes('openSheet')) return ctx.shell;
        if (t.includes('WosSkin.set')) { skin = arg; return undefined; }
        if (t.includes('colorScheme')) return { scheme: 'dark', base: '#000', body: 'rgb(0, 0, 0)' };
        return undefined;
      },
      keyboard: { press: async k => { presses.push([ctx.shell, k]); } },
      locator, frames: () => [frame], screenshot: async () => {},
    };
    return page;
  }
  const browser = {
    async newContext(o) {
      const shell = o.isMobile ? 'phone' : 'desktop';
      const ctx = { shell, version: null, urls: [], pages: [] };
      contexts.push(ctx);
      return { route: async () => {}, addInitScript: async () => {}, newPage: async () => { ctx.version = currentVersion(); const p = makePage(ctx); ctx.pages.push(p); return p; }, pages: () => ctx.pages, close: async () => {} };
    },
    async newPage() { return makePage({ shell: 'phone', version: 'candidate', urls: [], pages: [] }); },
    contexts: () => [],
    async close() { setTimeout(done, 20); },
  };
  // the script's `version` is a module-level let: read it through the served sigils.js (baseline file vs real one)
  let lastVersion = 'candidate'; const currentVersion = () => lastVersion;
  const http = realRequire('node:http');
  const servers = [];
  const fakeHttp = { ...http, createServer: handler => { const s = http.createServer(handler); servers.push(s); const listen = s.listen.bind(s); s.listen = (...a) => { const cb = a.at(-1); return listen(0, '127.0.0.1', () => { origin = `http://127.0.0.1:${s.address().port}`; cb(); }); }; return s; } };
  const req = id => id === '../tools/qa-playwright.cjs' ? { chromium: { launch: async () => browser } } : id === 'node:http' ? fakeHttp : realRequire(id);
  const env = { QA_OUT: out, QA_FIXTURE: fixture, ...(baseline ? { NOTES_BASELINE: baselineFile } : {}) };
  const proc = { env, exitCode: undefined };
  const con = { log() {}, error: e => errors.push(e?.message || String(e)) };
  // track the version loop: newContext order is candidate phone, candidate desktop, then baseline phone, desktop
  const origNew = browser.newContext; browser.newContext = async o => { lastVersion = baseline && contexts.length >= 2 ? 'baseline' : 'candidate'; return origNew(o); };
  const fn = vm.compileFunction(SRC, ['require', '__dirname', 'process', 'console'], { filename: 'qa-notes-sigil.cjs' });
  fn(req, TESTS.replace(/\/$/, ''), proc, con);
  let timer; await Promise.race([finished, new Promise(r => { timer = setTimeout(r, stopAtPalette ? 400 : 8000); })]); clearTimeout(timer);
  await new Promise(r => setTimeout(r, 30));
  for (const s of servers) { s.closeAllConnections?.(); s.close(); }
  let report = null; try { report = JSON.parse(fs.readFileSync(path.join(out, 'report.json'), 'utf8')); } catch (_) {}
  const result = { presses, locators, contexts: contexts.map(c => ({ shell: c.shell, version: c.version })), exitCode: proc.exitCode, report, errors, served, baselineFile };
  fs.rmSync(out, { recursive: true, force: true }); fs.rmSync(fixture, { recursive: true, force: true });
  return result;
}
