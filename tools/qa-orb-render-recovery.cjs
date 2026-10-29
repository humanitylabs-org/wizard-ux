// Synthetic native-page WebGL acceptance; no owner data, network, microphone or API calls.
// QA_ORB_PUBLISHED=.../assist QA_ORB_BASELINE=.../assist QA_ORB_CANDIDATE=.../assist QA_OUT=... node tools/qa-orb-render-recovery.cjs
'use strict';
const { chromium } = require('./qa-playwright.cjs');
const { installRafProbe, frozenIdle } = require('./qa-orb-idle-probe.cjs');
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const out = path.resolve(process.env.QA_OUT || 'qa-orb-render-recovery');
const variants = ['published', 'baseline', 'candidate'];
const modes = ['idle', 'listen', 'paused', 'think', 'type', 'typing', 'command', 'done'];
const receipt = { scope: 'synthetic actual bundled Everywhere page; not handset/driver or signed-APK proof', cases: [], idleObservations: [], errors: [] };
const pixels = new Map();
const save = () => fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(receipt, null, 2));
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.QA_CHROME || undefined,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    for (const size of [64, 76]) for (const variant of variants) {
      const root = fs.realpathSync(process.env[`QA_ORB_${variant.toUpperCase()}`]);
      const context = await browser.newContext({ viewport: { width: size, height: size }, deviceScaleFactor: 2, serviceWorkers: 'block' });
      const errors = [], blocked = [];
      try {
        await context.route('**/*', route => {
          const url = new URL(route.request().url());
          if (url.origin !== 'http://orb.test' || route.request().method() !== 'GET') { blocked.push(url.origin); return route.abort(); }
          const rel = decodeURIComponent(url.pathname).slice(1) || 'everywhere.html', file = path.resolve(root, rel);
          if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: '' });
          return route.fulfill({ body: fs.readFileSync(file), contentType: ({ '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream' });
        });
        await context.addInitScript(installRafProbe);
        await context.addInitScript(() => {
          window.EverywhereNative = { log() {} };
          window.__draws = 0; window.__events = [];
          const proto = WebGLRenderingContext.prototype, locations = new WeakMap();
          const location = proto.getUniformLocation, uniform = proto.uniform1f, draw = proto.drawArrays;
          proto.getUniformLocation = function (p, name) { const loc = location.call(this, p, name); if (loc) locations.set(loc, name); return loc; };
          proto.uniform1f = function (loc, value) { return uniform.call(this, loc, locations.get(loc) === 't' ? 8 : value); };
          proto.drawArrays = function (...args) {
            const result = draw.apply(this, args); window.__draws++;
            if (window.__capture) {
              const w = this.drawingBufferWidth, h = this.drawingBufferHeight, data = new Uint8Array(w * h * 4);
              this.readPixels(0, 0, w, h, this.RGBA, this.UNSIGNED_BYTE, data);
              window.__sample = { w, h, data: Array.from(data), error: this.getError() };
            }
            return result;
          };
          document.addEventListener('DOMContentLoaded', () => {
            const c = document.getElementById('orb');
            for (const name of ['webglcontextlost', 'webglcontextrestored']) c.addEventListener(name, () => window.__events.push(name));
          });
        });
        const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
        await page.goto('http://orb.test/everywhere.html', { waitUntil: 'load' });
        await page.waitForFunction(() => window.Orb?.webgl && window.E && document.getElementById('orb').width > 0);
        for (const mode of modes) {
          await page.evaluate(mode => { window.__capture = true; E.state({ mode }); E.level(mode === 'paused' || mode === 'idle' ? 0 : .3); }, mode);
          await page.waitForTimeout(1500);
          const sample = await page.evaluate(() => { window.__capture = false; return window.__sample; });
          assert.equal(sample.error, 0, `${variant}/${size}/${mode}: GL error`);
          let inner = 0, white = 0; const colors = new Set();
          for (let y = 0; y < sample.h; y++) for (let x = 0; x < sample.w; x++) {
            if (Math.hypot((x + .5) * 2 / sample.w - 1, (y + .5) * 2 / sample.h - 1) >= .5) continue;
            const i = (y * sample.w + x) * 4, rgb = sample.data.slice(i, i + 3);
            inner++; if (rgb.every(v => v > 235)) white++; colors.add(rgb.join(','));
          }
          assert.ok(colors.size > 100 && white / inner < .25, `${variant}/${size}/${mode}: galaxy collapsed to flat white`);
          const key = `${size}/${mode}`; let meanDelta = null;
          if (variant === 'baseline') pixels.set(key, sample.data);
          if (variant === 'candidate') {
            const baseline = pixels.get(key); assert.equal(sample.data.length, baseline.length);
            meanDelta = sample.data.reduce((sum, value, i) => sum + Math.abs(value - baseline[i]), 0) / sample.data.length;
            assert.ok(meanDelta < 3, `intended appearance changed: ${key}, mean channel delta ${meanDelta}`);
          }
          if (['idle', 'typing'].includes(mode)) await page.screenshot({ path: path.join(out, `${variant}-${size}-${mode}.png`) });
          receipt.cases.push({ variant, size, mode, colors: colors.size, whiteFraction: white / inner, meanDelta }); save();
        }
        await page.evaluate(() => { E.state({ mode: 'idle' }); E.level(0); });
        async function checkIdle(phase) {
          const observation = await page.evaluate(frozenIdle);
          receipt.idleObservations.push({ variant, size, phase, ...observation }); save();
          assert.equal(observation.pass, true, observation.error);
        }
        // Orb.wake() owns a 1600-ms settling interval. Observe its rAF queue
        // draining, then demand zero further draws for the full 300-ms window.
        await checkIdle('before-context-loss');
        for (const cycle of [1, 2]) {
          await page.evaluate(() => {
            const c = document.getElementById('orb'); window.__lose = c.getContext('webgl').getExtension('WEBGL_lose_context');
            if (!window.__lose) throw new Error('WEBGL_lose_context unavailable'); window.__lose.loseContext();
          });
          await page.waitForFunction(() => window.__events.filter(e => e === 'webglcontextlost').length > window.__events.filter(e => e === 'webglcontextrestored').length);
          const loss = await page.evaluate(() => ({ canvas: document.getElementById('orb').hidden, fallback: document.getElementById('orbFallback').hidden, webgl: Orb.webgl }));
          assert.equal(loss.canvas, true); assert.equal(loss.fallback, false);
          if (variant === 'candidate') assert.equal(loss.webgl, false);
          await page.waitForTimeout(200);
          await page.evaluate(() => window.__lose.restoreContext());
          await page.waitForFunction(cycle => window.__events.filter(e => e === 'webglcontextrestored').length === cycle, cycle);
          if (variant === 'candidate') await page.waitForFunction(() => Orb.webgl && !document.getElementById('orb').hidden && document.getElementById('orbFallback').hidden);
          else {
            assert.equal(await page.evaluate(() => document.getElementById('orb').hidden), true, 'negative control must exhibit exact old restoration failure');
          }
          const state = await page.evaluate(() => ({ webgl: Orb.webgl, canvasHidden: document.getElementById('orb').hidden, fallbackHidden: document.getElementById('orbFallback').hidden, mode: Orb.mode }));
          assert.equal(state.mode, 'idle');
          receipt.cases.push({ variant, size, cycle, restore: state, oldFailureReproduced: variant !== 'candidate' }); save();
        }
        if (variant === 'candidate') {
          await page.evaluate(() => { Orb.sleep(true); window.__lose.loseContext(); });
          await page.waitForFunction(() => !Orb.webgl); const before = await page.evaluate(() => window.__draws);
          await page.waitForTimeout(200); await page.evaluate(() => window.__lose.restoreContext());
          await page.waitForFunction(() => Orb.webgl); await page.waitForTimeout(200);
          assert.equal(await page.evaluate(() => window.__draws), before, 'restoration must honor host sleep');
          await page.evaluate(() => { Orb.sleep(false); }); await page.waitForFunction(before => window.__draws > before, before);
          await checkIdle('after-sleep-restore');
          await page.screenshot({ path: path.join(out, `candidate-${size}-restored.png`) });
          receipt.cases.push({ variant, size, sleepRestored: true, idleFrozen: true }); save();
        }
        assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
      } finally { await context.close(); }
    }
    assert.equal(receipt.cases.length, 62, '48 paint cases + 12 restoration cases + 2 sleep/freeze cases');
    receipt.pass = true; save(); console.log(JSON.stringify({ pass: true, cases: receipt.cases.length, out }));
  } finally { await browser.close(); }
})().catch(error => { receipt.pass = false; receipt.errors.push(error.stack); save(); console.error(error); process.exitCode = 1; });
