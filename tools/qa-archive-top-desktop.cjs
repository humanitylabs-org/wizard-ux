'use strict';
// Desktop AI apps sidebar with and without miguel/archive-top (wizard-ux issue 1741): a real browser on the served
// shell (the tracker rig's synthetic service), one Working, one Ready and one archived chat.
const { chromium } = require('./qa-playwright.cjs');
const { mount, service } = require('./qa-thread-tracker.cjs');
const fx = require('./qa-proof-fixture.cjs');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'qa-archive-top-desktop'));
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME ? { executablePath: process.env.QA_CHROME } : {}) });
  const res = {};
  try {
    for (const [tag, tweaks] of [['off', []], ['on', ['miguel/archive-top']]]) {
      const svc = service(), now = Math.floor(Date.now() / 1000);
      const row = (id, title, extra) => ({ ...fx.row, id, title, status: 'completed', wizard_status: 'completed', message_count: 2, last_active: now, wizard_last_assistant_at: now, wizard_last_user_at: now - 30, ...extra });
      svc.sessionRows = () => [row('a-ready', 'Plan the trip', { wizard_attention: { state: 'needs_you', ask: 'Pick a date.' } }), row('a-work', 'Long build', { status: 'running', wizard_status: 'running' }), row('a-old', 'Old chat', { archived: true, wizard_archived: true })];
      const { ctx, page } = await mount(browser, svc, { shell: 'desktop', skin: 'nebula', tweaks });
      await page.evaluate(() => window.WosExperience.chooseDesktopView('ai-apps'));
      await page.waitForFunction(() => document.documentElement.dataset.layout === 'ai-apps');
      await page.waitForFunction(() => document.querySelectorAll('.aad-sec').length > 0);
      if (!(await page.locator('.aad-sec[data-sec="archive"]').count())) {
        await page.evaluate(async () => { await window.WizLive?.archive?.('a-old'); });
        await page.waitForTimeout(800);
      }
      await page.waitForTimeout(500);
      res[tag] = await page.evaluate(() => ({ tweaks: document.documentElement.dataset.tweaks || '', secs: [...document.querySelectorAll('.aad-sec')].map(h => h.dataset.sec) }));
      await page.screenshot({ path: path.join(OUT, tag + '.png') });
      console.log(tag, JSON.stringify(res[tag]));
      await ctx.close();
    }
  } finally { await browser.close(); }
  const ok = res.on.secs[0] === 'archive' && res.off.secs.at(-1) === 'archive' && JSON.stringify(res.on.secs.slice(1)) === JSON.stringify(res.off.secs.filter(k => k !== 'archive'));
  console.log(ok ? 'PASS archive-top puts Archived first on the desktop sidebar; off keeps it last' : 'FAIL');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
