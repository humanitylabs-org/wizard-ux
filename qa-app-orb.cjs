// QA: an app in front can wear the two-orb agent orb as its main button (WizardApp.orb.claim).
// Mizel claims it on its list as "New recording"; the orb shows a plus in Mizel's colour, Mizel hides its own button,
// a tap runs Mizel's action (no agent take), and opening a recording gives the orb back to the agent.
// Usage: node qa-app-orb.cjs [origin=http://127.0.0.1:9381/wizard-os-home/]   (MIZEL=8996 serves /mizel-live/)
// Writes to /wizard/* are refused by qa-origin; Mizel writes go to a scratch canary and are counted.
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('fs');
const ORIGIN = process.argv[2] || 'http://127.0.0.1:9381/wizard-os-home/';
const MIZEL = Number(process.env.MIZEL || 8996), SHOTS = process.env.QA_SHOTS || '';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } };
(async () => {
  const exe = process.env.CH || process.env.CHROMIUM_PATH;
  const b = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: 'dark', permissions: ['microphone'] });
  const runs = [], mizelWrites = [];
  await ctx.route('**/mizel-live/**', async r => {
    const u = new URL(r.request().url());
    if (r.request().method() !== 'GET') mizelWrites.push(r.request().method() + ' ' + u.pathname);
    const res = await r.fetch({ url: `http://127.0.0.1:${MIZEL}${u.pathname}${u.search}`, headers: { ...r.request().headers(), origin: new URL(ORIGIN).origin } });
    await r.fulfill({ response: res });
  });
  await ctx.route('**/wizard/**/v1/runs**', r => { runs.push(r.request().url()); r.fulfill({ status: 403, body: '{}' }); });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(ORIGIN + '?layout=two-orb&open=mizel');
  await p.waitForFunction(() => document.documentElement.dataset.layout === 'two-orb' && document.querySelector('#agentOrb'), null, { timeout: 20000 });
  const frame = async () => { for (let i = 0; i < 40; i++) { const f = p.frames().find(f => f.url().includes('/mizel-live/')); if (f) return f; await p.waitForTimeout(250); } return null; };
  const mf = await frame(); ok(!!mf, 'Mizel opens in the shell');
  await p.waitForFunction(() => document.querySelector('#agentOrb')?.classList.contains('app-claim'), null, { timeout: 15000 }).catch(() => {});
  const st = await p.evaluate(() => { const o = document.querySelector('#agentOrb'); return { claim: o.classList.contains('app-claim'), icon: o.querySelector('.to-glyph')?.dataset.icon, c: o.style.getPropertyValue('--c'), h: o.style.getPropertyValue('--h'), label: o.getAttribute('aria-label'), name: o.querySelector('.to-name')?.textContent, r: o.getBoundingClientRect().toJSON() }; });
  ok(st.claim && st.icon === 'plus', `orb wears Mizel's plus (${st.icon})`);
  ok(st.c === '#3fe0ff' && st.h === '190', `orb tinted to Mizel's colour (${st.c}, hue ${st.h})`);
  ok(/New recording/.test(st.label) && /Mizel/.test(st.label), `orb label: ${st.label}`);
  const fab = await mf.evaluate(() => { const f = document.querySelector('#btn-new-mobile'); return { claimed: document.documentElement.classList.contains('orb-claimed'), visible: !!f && f.getClientRects().length > 0 && getComputedStyle(f).display !== 'none' }; });
  ok(fab.claimed && !fab.visible, 'Mizel hides its own New recording button');
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/orb-mizel-list.png` });
  // Tap: Mizel's action, not an agent take.
  const before = mizelWrites.length;
  await p.locator('#agentOrb').tap();
  await p.waitForTimeout(2500);
  const voice = await p.evaluate(() => document.getElementById('device').dataset.voice || 'idle');
  ok(mizelWrites.slice(before).some(w => /\/api\/meetings$/.test(w)), `tap created a Mizel recording (${mizelWrites.slice(before).join(', ')})`);
  ok(voice === 'idle' && runs.length === 0, `no agent take started (voice=${voice}, runs=${runs.length})`);
  const view = await mf.evaluate(() => document.querySelector('.app')?.dataset.view);
  await p.waitForFunction(() => !document.querySelector('#agentOrb')?.classList.contains('app-claim'), null, { timeout: 8000 }).catch(() => {});
  const back = await p.evaluate(() => ({ claim: document.querySelector('#agentOrb').classList.contains('app-claim'), hidden: document.querySelector('#agentOrb').hidden }));
  ok(view === 'meeting' && !back.claim && !back.hidden, `inside a recording the orb is the agent orb again (view=${view})`);
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/orb-mizel-recording.png` });
  // Stop + delete the canary recording so nothing is left behind.
  const mid = await mf.evaluate(() => (location.hash.match(/mt_[a-z0-9]+/) || [])[0]);
  if (mid) {
    await fetch(`http://127.0.0.1:${MIZEL}/mizel-live/api/meetings/${mid}/stop`, { method: 'POST', headers: { origin: new URL(ORIGIN).origin } }).catch(() => {});
    await new Promise(r => setTimeout(r, 1500));
    const d = await fetch(`http://127.0.0.1:${MIZEL}/mizel-live/api/meetings/${mid}`, { method: 'DELETE', headers: { origin: new URL(ORIGIN).origin } }).catch(() => ({ status: 0 }));
    console.log('cleanup', mid, d.status);
  }
  // Back to the list: the claim returns.
  await mf.evaluate(() => { location.hash = '#/'; });
  await p.waitForFunction(() => document.querySelector('#agentOrb')?.classList.contains('app-claim'), null, { timeout: 8000 }).catch(() => {});
  ok(await p.evaluate(() => document.querySelector('#agentOrb').classList.contains('app-claim')), 'back on the list the plus returns');
  // Hold still opens the agent picker.
  const box = await p.locator('#agentOrb').boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.mouse.down(); await p.waitForTimeout(600);
  const arc = await p.evaluate(() => !document.querySelector('.to-arc').hidden && document.querySelectorAll('.to-chip').length);
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/orb-mizel-hold.png` });
  await p.mouse.move(10, 10); await p.mouse.up(); await p.waitForTimeout(500);
  ok(arc >= 2, `hold still opens the agent picker (${arc} agents)`);
  ok(await p.evaluate(() => document.querySelector('#agentOrb').classList.contains('app-claim')), 'after the picker closes the plus is back');
  ok(errs.length === 0, 'no page errors ' + errs.join(' | ').slice(0, 300));
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
