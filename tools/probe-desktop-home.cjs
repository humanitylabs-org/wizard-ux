// Debug probe: why the desktop Home Agents chip is not found. usage: node probe-desktop-home.cjs <base> <out.png>
const { chromium } = require(process.env.PW);
(async () => {
  const base = process.argv[2], out = process.argv[3];
  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  const p = await c.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await p.goto(base + 'desktop.html', { waitUntil: 'load' }); await p.waitForTimeout(3000);
  const info = await p.evaluate(() => {
    const homes = [...document.querySelectorAll('.home')];
    const chips = [...document.querySelectorAll('[data-app="agents"]')].map(e => ({ cls: e.className, parent: e.parentElement?.className, vis: !!(e.offsetWidth || e.offsetHeight), rect: e.getBoundingClientRect().toJSON() }));
    return { homes: homes.map(h => ({ cls: h.className, vis: !!(h.offsetWidth || h.offsetHeight), apps: (h.querySelector('.home-apps')?.innerText || '').slice(0, 300) })), chips };
  });
  console.log(JSON.stringify(info, null, 1)); console.log('ERRS', JSON.stringify(errs.slice(0, 8)));
  await p.screenshot({ path: out }); await b.close();
})();
