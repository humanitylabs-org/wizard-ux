// Uses live :8806 assets and real model catalogue; all writes are mocked in isolated contexts.
// NODE_PATH=<playwright-core parent> node qa-model-switch-versions.cjs
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8806/wizard-os-home/';
const OUT = process.env.QA_ARTIFACTS || '/home/oscar/.hermes/cache/scratch/wizard-model-switch';
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.QA_CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const reports = [];
  try {
    for (const [shell, width] of [['phone', 320], ['phone', 390], ['desktop', 1440]]) {
      const context = await browser.newContext({ viewport: { width, height: shell === 'phone' ? 844 : 900 }, isMobile: shell === 'phone', hasTouch: shell === 'phone' });
      const sid = 'qa-model-labels', iso = new Date(Date.now() - 60000).toISOString();
      const row = { id: sid, title: 'Model labels regression', status: 'completed', model: 'claude-opus-5-5', provider: 'claude-subscription-directsdk-experimental', updated_at: iso, wizard_last_assistant_at: iso, message_count: 2, latest_message: { role: 'assistant', content: 'All versions stay visible', timestamp: iso } };
      const writes = [], errors = [];
      await context.route('**/*', async route => {
        const req = route.request(), u = new URL(req.url());
        const json = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
        if (req.method() !== 'GET') {
          writes.push({ path: u.pathname, body: req.postDataJSON() });
          if (u.pathname.endsWith('/model')) { Object.assign(row, req.postDataJSON()); return json({ runtime: { model_lock: 'accepted', model: row.model, provider: row.provider, selection_version: writes.length } }); }
          return json({ accepted: true });
        }
        if (u.pathname.endsWith('/api/model/options')) return route.continue();
        if (u.pathname.endsWith('/api/sessions')) return json({ data: [row], has_more: false });
        if (u.pathname.endsWith('/messages')) return json({ data: [{ role: 'user', content: 'Previous request', timestamp: iso }, { role: 'assistant', content: 'All versions stay visible', timestamp: iso }], has_more: false });
        if (u.pathname.endsWith('/api/sessions/' + sid)) return json(row);
        if (u.pathname.startsWith('/wizard/')) return json({ state: {}, data: [], agents: [] });
        return route.continue();
      });
      const page = await context.newPage(); page.on('pageerror', e => errors.push(String(e)));
      await page.addInitScript(shell => { localStorage.setItem('wux.shell', shell); localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.skin', 'obsidian'); }, shell);
      await page.goto(BASE + (shell === 'desktop' ? 'desktop.html' : ''), { waitUntil: 'load' });
      await page.waitForFunction(() => (window.__wos || window.__wux)?.live?.session('qa-model-labels'));
      await page.evaluate(sid => window.__wos ? __wos.openWizardThread(sid) : __wux.openThread(sid), sid);
      await page.waitForSelector('.ms-o:not(:disabled) .ms-version');
      await page.waitForFunction(() => document.querySelectorAll('.ms-version').length === 3 && [...document.querySelectorAll('.ms-version')].every(x => x.textContent));
      await page.waitForSelector('.ch-tacts');
      await page.evaluate(() => document.fonts.ready);
      const catalogue = await page.evaluate(() => WosModels.options.filter(o => /opus|astra|sol/.test(o.value)).map(o => o.value));
      const states = [];
      for (const i of [1, 2, 0]) {
        await page.locator(`.ms-o[data-msi="${i}"]`).click();
        await page.waitForFunction(i => document.querySelector(`.ms-o[data-msi="${i}"]`)?.getAttribute('aria-checked') === 'true', i);
        const labels = await page.locator('.ms-o').evaluateAll(nodes => nodes.map(n => {
          const name = n.querySelector('.ms-name'), version = n.querySelector('.ms-version'), r = n.getBoundingClientRect();
          const nr = name.getBoundingClientRect(), vr = version.getBoundingClientRect();
          return { text: n.textContent.trim(), name: name.textContent, version: version.textContent, selected: n.getAttribute('aria-checked'), font: getComputedStyle(name).fontFamily, bodyFont: getComputedStyle(document.body).fontFamily, muted: getComputedStyle(version).opacity, fits: n.scrollWidth <= n.clientWidth && nr.left >= r.left && nr.right <= r.right && vr.left >= r.left && vr.right <= r.right && vr.bottom <= r.bottom, width: r.width };
        }));
        assert.deepEqual(labels.map(l => l.text), ['Opus 5.5', 'Astra 6', 'Sol 6.1']);
        assert.ok(labels.every(l => l.fits && l.font === l.bodyFont && Number(l.muted) < 1), JSON.stringify(labels));
        assert.equal(await page.locator('.ch-sheet').count(), 0, 'one tap, no model sheet');
        states.push({ selected: i, labels });
        await page.screenshot({ path: path.join(OUT, `${shell}-${width}-${i}.png`) });
      }
      assert.equal(writes.filter(w => w.path.endsWith('/model')).length, 3, 'exactly one model write per tap');
      assert.deepEqual(writes.filter(w => w.path.endsWith('/model')).map(w => w.body.model), ['gpt-6-astra', 'gpt-6.1-sol', 'claude-opus-5-5']);
      const geometry = await page.evaluate(() => { const a = document.querySelector('.ms').getBoundingClientRect(), b = document.querySelector('.ch-tacts').getBoundingClientRect(); return { switchTop: a.top, actionsTop: b.top, actionsRight: b.right, viewport: innerWidth, pageOverflow: document.documentElement.scrollWidth > innerWidth }; });
      assert.ok(Math.abs(geometry.switchTop - geometry.actionsTop) <= 2 && geometry.actionsRight <= width && !geometry.pageOverflow, JSON.stringify(geometry));
      await page.evaluate(() => window.__wos ? __wos.openWizardThread('__new__') : __wux.openThread('__new__'));
      await page.waitForSelector('.ms-o[data-msi="0"][aria-checked="true"]');
      for (const i of [1, 2, 0]) {
        await page.locator(`.ms-o[data-msi="${i}"]`).click();
        await page.waitForFunction(i => document.querySelector(`.ms-o[data-msi="${i}"]`)?.getAttribute('aria-checked') === 'true', i);
        assert.deepEqual(await page.locator('.ms-o').allTextContents(), ['Opus 5.5', 'Astra 6', 'Sol 6.1']);
      }
      assert.equal(writes.filter(w => w.path.endsWith('/model')).length, 3, 'new draft selection stays local');
      assert.deepEqual(errors, []);
      reports.push({ shell, width, catalogue, states, geometry, newDraftSelections: 3, writes, errors });
      await context.close();
    }
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ base: BASE, reports, realWrites: 0 }, null, 2));
    console.log(JSON.stringify({ base: BASE, cases: reports.map(r => ({ shell: r.shell, width: r.width, states: r.states.length, geometry: r.geometry })), artifacts: OUT, realWrites: 0 }, null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
