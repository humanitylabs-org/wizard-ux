// Run the real tools/qa-opaque-overlays.cjs (a Playwright QA script) in node:vm against a fake Chromium (wizard-ux
// issue 1674: tests run the code). page.setContent parses the fixture page the script builds into the mini DOM
// (tests/fixtures/mini-dom.mjs), so a test can see its markup and its own <style>; screenshots return bytes that
// depend on whether #behind is visible (`seeThrough`), boundingBox returns `box`, and `throwOnShot` makes the
// screenshot fail. Returns what the run did: pages set, whether the browser closed, the logs, exit code and result.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createDocument } from './mini-dom.mjs';

const TOOLS = new URL('../../tools/', import.meta.url).pathname;
const SRC = fs.readFileSync(path.join(TOOLS, 'qa-opaque-overlays.cjs'), 'utf8');
const require = createRequire(path.join(TOOLS, 'x.cjs'));

export async function runOpaque({ filter = 'share-option', seeThrough = false, box = { x: 16, y: 220, width: 358, height: 240 }, throwOnShot = false } = {}) {
  const pages = [], logs = [], errors = [];
  let closed = 0, doc = null;
  const page = {
    async setContent(html) {
      doc = createDocument();
      doc.documentElement.innerHTML = html.replace(/^<!doctype html>/i, '').replace(/^<html([^>]*)>/i, '').replace(/<\/html>$/i, '');
      const open = /^<html([^>]*)>/i.exec(html.replace(/^<!doctype html>/i, ''))?.[1] || '';
      for (const m of open.matchAll(/([\w-]+)="([^"]*)"/g)) doc.documentElement.setAttribute(m[1], m[2]);
      pages.push({ html, doc });
    },
    locator: () => ({ evaluate: async fn => String(fn).includes('getComputedStyle(e).backgroundColor') ? { color: 'rgb(1, 2, 3)', image: 'none', opacity: '1' } : undefined, boundingBox: async () => box }),
    async evaluate(fn) { if (/#behind/.test(String(fn))) doc.querySelector('#behind').setAttribute('data-hidden', ''); },
    async screenshot() {
      if (throwOnShot) throw new Error('r8A: screenshot failed');
      return Buffer.from(seeThrough && !doc.querySelector('#behind').hasAttribute('data-hidden') ? 'panel over loud text' : 'panel');
    },
  };
  const chromium = { launch: async () => ({ newPage: async () => page, newContext: async () => { throw new Error('r8A: real shell not run'); }, close: async () => { closed++; } }) };
  const proc = { env: { QA_FILTER: filter }, exitCode: undefined };
  const ctx = { require: n => n === 'playwright' ? { chromium } : require(n), process: proc, __dirname: TOOLS.replace(/\/$/, ''), Buffer, JSON,
    console: { log: s => logs.push(String(s)), error: e => errors.push(e) } };
  vm.runInNewContext(SRC, ctx, { filename: 'qa-opaque-overlays.cjs' });
  for (let i = 0; i < 200 && proc.exitCode === undefined && !logs.some(l => /PASS opaque overlays/.test(l)); i++) await new Promise(r => setImmediate(r));
  const result = logs.map(l => { try { return JSON.parse(l); } catch { return null; } }).find(r => r && 'checked' in r) || null;
  return { pages, closed, logs, errors, exitCode: proc.exitCode, result };
}
