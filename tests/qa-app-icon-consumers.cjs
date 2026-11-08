#!/usr/bin/env node
// Synthetic raster-only fixture. Never load the shell, owner APIs or native pin bridge.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..'), OUT = process.env.QA_OUT;
assert.ok(OUT, 'QA_OUT required'); fs.mkdirSync(OUT, { recursive: true });
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const pin = fs.readFileSync(path.join(ROOT, 'web/core/home-screen-apps.js'), 'utf8');
assert.ok(process.env.PIN_BASE_SOURCE, 'PIN_BASE_SOURCE required');
const baseline = fs.readFileSync(process.env.PIN_BASE_SOURCE, 'utf8');
const extract = s => s.slice(s.indexOf('  async function iconPNG('), s.indexOf('  async function show('));
const assets = ['core/sigils.js', 'core/sigils.css', 'brand/wizard-mark-white.png', 'brand/apps/hermes.svg', 'skins/obsidian/skin.css'];
const served = [], rejected = [], pageErrors = [], cases = [];
let raster, browser, server;
const main = async () => {
  const pw = require(process.env.QA_PLAYWRIGHT || 'playwright');
  server = http.createServer((req, res) => {
    if (req.url === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/wizard-os-home/core/sigils.css"><link rel="stylesheet" href="/wizard-os-home/skins/obsidian/skin.css"><script src="/wizard-os-home/core/sigils.js"></script><main></main>'); return; }
    if (req.url === '/fixture/wide.png' && raster) { served.push({ url: req.url, sha256: hash(raster) }); res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(raster); return; }
    const relative = req.url.startsWith('/wizard-os-home/') ? req.url.slice('/wizard-os-home/'.length) : '';
    if (!assets.includes(relative)) { rejected.push(req.url); res.writeHead(404); res.end(); return; }
    const bytes = fs.readFileSync(path.join(ROOT, 'web', relative)); served.push({ url: req.url, sha256: hash(bytes) });
    res.writeHead(200, { 'Content-Type': relative.endsWith('.css') ? 'text/css' : relative.endsWith('.js') ? 'text/javascript' : relative.endsWith('.png') ? 'image/png' : 'image/svg+xml' }); res.end(bytes);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await pw.chromium.launch({ headless: true, executablePath: process.env.QA_CHROME || undefined, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin !== origin) { rejected.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  await page.goto(origin); await page.waitForFunction(() => !!window.WizSigil);
  raster = Buffer.from(await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 80; c.height = 40;
    const t = c.getContext('2d'); t.fillStyle = '#fff'; t.fillRect(10, 5, 60, 30); return c.toDataURL('image/png').split(',')[1];
  }), 'base64');
  await page.evaluate(({ candidate, old }) => {
    window.pinCandidate = (0, eval)(`(${candidate.trim()})`);
    window.pinBaseline = (0, eval)(`(${old.trim()})`);
    // Logo is deliberately present; canonical/custom identities must suppress it.
    window.WizCore = { appLogo: id => `/wizard-os-home/store-data/app-logo/${id}?v=0123456789abcdef` };
  }, { candidate: extract(pin), old: extract(baseline) });
  for (const skin of ['obsidian', 'obsidian-light']) {
    for (const id of ['hermes-agent', 'hermes-frontend-3', 'wizard-cloudflare', 'wizard-claude', 'wizard-chatgpt', 'wizard-tinfoil', 'raster-fixture']) {
      const result = await page.evaluate(async ({ skin, id }) => {
        document.documentElement.dataset.skin = skin;
        const a = { id, name: id, ...(id === 'raster-fixture' ? { icon: '/fixture/wide.png' } : {}) };
        const header = document.createElement('header'); header.innerHTML = WizSigil.box('span', '', a); document.querySelector('main').replaceChildren(header);
        const sigil = WizSigil.of(a), glyph = header.querySelector('.sgi');
        const property = !sigil.glyph && glyph.classList.contains('sgb') ? '--sgb' : '--sg';
        const mask = getComputedStyle(glyph).getPropertyValue(property).trim();
        const png = await window.pinCandidate(a, header);
        async function pixels(url) {
          const image = new Image(); image.src = url; await image.decode();
          const c = document.createElement('canvas'); c.width = c.height = 192; const t = c.getContext('2d'); t.drawImage(image, 0, 0); return { c, data: t.getImageData(0, 0, 192, 192).data, image };
        }
        const actual = await pixels(png);
        let transparent = 0, ink = 0;
        for (let i = 0; i < actual.data.length; i += 4) { if (actual.data[i + 3] !== 255) transparent++; if (actual.data[i] !== 17 || actual.data[i + 1] !== 13 || actual.data[i + 2] !== 27) ink++; }
        let expected;
        if (sigil.glyph) expected = await pixels(await window.pinBaseline(a, header));
        else {
          const match = mask.match(/^url\(["']?([^"')]+)["']?\)$/); if (!match) throw new Error('missing source mask');
          const image = new Image(); image.src = match[1]; await image.decode();
          const tmp = document.createElement('canvas'); tmp.width = tmp.height = 192; const t = tmp.getContext('2d');
          const w = 128, h = id === 'raster-fixture' ? 64 : 128;
          t.drawImage(image, (192 - w) / 2, (192 - h) / 2, w, h);
          const maskPixels = t.getImageData(0, 0, 192, 192).data;
          let maskClear = 0, maskInk = 0;
          for (let i = 3; i < maskPixels.length; i += 4) { if (!maskPixels[i]) maskClear++; else maskInk++; }
          if (!maskClear || !maskInk) throw new Error('mask lacks transparency or shape');
          t.globalCompositeOperation = 'source-in'; t.fillStyle = sigil.color; t.fillRect(0, 0, 192, 192);
          const c = document.createElement('canvas'); c.width = c.height = 192; const x = c.getContext('2d'); x.fillStyle = '#110d1b'; x.fillRect(0, 0, 192, 192); x.drawImage(tmp, 0, 0);
          expected = { data: x.getImageData(0, 0, 192, 192).data };
        }
        let different = 0; for (let i = 0; i < actual.data.length; i++) if (actual.data[i] !== expected.data[i]) different++;
        header.append(actual.c);
        return { skin, id, property, mask, png, width: actual.image.naturalWidth, height: actual.image.naturalHeight, transparent, ink, different, logoSuppressed: !sigil.logo, baselineCompared: !!sigil.glyph };
      }, { skin, id });
      const bytes = Buffer.from(result.png.split(',')[1], 'base64'); delete result.png;
      assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      assert.equal(result.width, 192); assert.equal(result.height, 192); assert.equal(result.transparent, 0); assert.ok(result.ink > 0); assert.equal(result.different, 0); assert.equal(result.logoSuppressed, true);
      const file = `${skin}-${id}.png`; fs.writeFileSync(path.join(OUT, file), bytes); cases.push({ ...result, file, sha256: hash(bytes) });
    }
  }
  assert.equal(cases.length, 14); assert.deepEqual(pageErrors, []); assert.deepEqual(rejected, []);
};
(async () => {
  let error;
  try { await main(); } catch (e) { error = e; }
  finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    const result = { pass: !error, source_sha256: hash(pin), baseline_source_sha256: hash(baseline), cases, served, rejected, pageErrors, error: error ? String(error.stack) : null, scope: 'Synthetic raster fixture only; no shell, owner data or native pin requests' };
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
  }
  if (error) process.exitCode = 1;
})();
