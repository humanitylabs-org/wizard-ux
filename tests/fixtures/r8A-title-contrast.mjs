// Run the real tools/qa-app-window-title-contrast.cjs (a Playwright QA script) in node:vm against a fake Chromium
// (wizard-ux issue 1674: tests run the code). Every window the script opens reports a title whose text paints `text`
// over pixels `behind` (both [r, g, b]); env adds to the script's environment (QA_SKINS, QA_SHELLS, QA_MIN_CONTRAST).
// Returns { exitCode, opened: { shell: [app ids] }, results (results.json), logs, errors }.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const TOOLS = new URL('../../tools/', import.meta.url).pathname;
const SRC = fs.readFileSync(path.join(TOOLS, 'qa-app-window-title-contrast.cjs'), 'utf8');
const require = createRequire(path.join(TOOLS, 'x.cjs'));

export async function runTitleContrast({ text = [255, 255, 255], behind = [5, 3, 12], env = {} } = {}) {
  const out = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'r8A-title-'));
  const opened = {}, logs = [], errors = [];
  const newPage = async shell => {
    const mine = [];
    const page = {
      goto: async u => { shell = /shell=phone/.test(u) ? 'phone' : 'desktop'; (opened[shell] ||= []); },
      waitForFunction: async () => {}, addStyleTag: async () => {}, keyboard: { press: async () => {} }, waitForTimeout: async () => {},
      getByText: () => ({ click: async () => { throw new Error('no Skip'); } }),
      screenshot: async () => Buffer.from('png'),
      evaluate: async (fn, arg) => {
        const f = String(fn);
        if (/openWin|newWin/.test(f)) { mine.push(arg[0]); opened[shell].push(arg[0]); return; }
        if (/querySelectorAll\('\.win'\)\]\.filter/.test(f)) return mine.map(id => ({ app: `/${id}/`, text: `rgb(${text.join(', ')})`, focus: false, box: { x: 10, y: 10, w: 120, h: 18 }, label: id }));
        if (/new Image\(\)/.test(f)) return behind;
        if (/fillStyle = colour/.test(f)) return text;
        if (/edge-light/.test(f)) return false;
        return undefined; // hide / show the title text
      },
    };
    return page;
  };
  const browser = { newContext: async () => ({ route: async () => {}, addInitScript: async () => {}, newPage: () => newPage(), close: async () => {} }), close: async () => {} };
  const proc = { env: { OUT: out, ...env }, exitCode: undefined };
  const ctx = { require: n => n === './qa-playwright.cjs' ? { chromium: { launch: async () => browser } } : require(n), process: proc, __dirname: TOOLS.replace(/\/$/, ''), Buffer, URL,
    console: { log: s => logs.push(String(s)), error: e => errors.push(e) } };
  vm.runInNewContext(SRC, ctx, { filename: 'qa-app-window-title-contrast.cjs' });
  for (let i = 0; i < 500 && proc.exitCode === undefined; i++) await new Promise(r => setImmediate(r));
  const file = path.join(out, 'results.json'), results = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  fs.rmSync(out, { recursive: true, force: true });
  return { exitCode: proc.exitCode, opened, results, logs, errors };
}
