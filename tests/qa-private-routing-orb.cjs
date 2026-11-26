'use strict';
// Private routing in the shell (wizard-ux issue 1804, switch wizard/private-routing; the Agent Service half is
// wizard-agent-service#629) in a real browser against the REAL Agent Service (tests/qa-private-routing-box.mjs, which
// needs QA_AS=<wizard-agent-service checkout>). Chromium's fake microphone records each take through the real orb; only
// speech-to-text and the recording upload are stand-ins here (the fake mic says nothing). The Agent Service decides
// where each take goes (name rule, private label from a private stand-in router, default); the stand-in agent runtimes
// record which agent got which words.
//   QA_SWITCH=on|off (default on)   QA_SHELLS=phone,classic   QA_SKINS=nebula,grove   QA_OUT=<dir> (shots, report.json)
//   QA_CASES=philosopher,personal,move,typed,default (default all)   QA_EXPECT=broken: print, never fail (main, before)
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { chromium } = require('../tools/qa-playwright.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..');
const SW = (process.env.QA_SWITCH || 'on') === 'on', EXPECT_BROKEN = process.env.QA_EXPECT === 'broken';
const SHELLS = (process.env.QA_SHELLS || 'phone,classic').split(','), SKINS = (process.env.QA_SKINS || 'nebula,grove').split(',');
const CASES = (process.env.QA_CASES || 'philosopher,personal,move,typed,default').split(',');
const out = process.env.QA_OUT || path.join(repo, 'private-routing-evidence');
fs.mkdirSync(out, { recursive: true });
const nap = ms => new Promise(r => setTimeout(r, ms));
const ID = 'wizard/private-routing';
const SAY = {
  philosopher: 'Philosopher, what would Heraclitus say about this',
  personal: 'What did Sam say in Messenger yesterday',
  move: 'How much did I spend on food this week',
  typed: 'Use Opus to review this plan',
  default: 'Fix the Chats scroll bug',
};
const report = { switch: SW, cases: [] };

function startBox() {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, QA_SWITCH: SW ? 'on' : 'off', QA_PORT: '0' };
    const p = spawn(process.execPath, [path.join(__dirname, 'qa-private-routing-box.mjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    p.stdout.on('data', d => { log += d; const m = /READY (\d+)/.exec(log); if (m) resolve({ proc: p, port: +m[1] }); });
    p.stderr.on('data', d => { log += d; });
    p.on('exit', code => reject(new Error('box exited ' + code + ': ' + log.slice(-800))));
  });
}

(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  try {
    for (const shell of SHELLS) for (const skin of SKINS) for (const name of CASES) {
      const phone = shell === 'phone', stem = `${shell}-${skin}-${name}`;
      const entry = { stem, said: SAY[name], errors: [] }; report.cases.push(entry);
      const box = await startBox(), origin = `http://127.0.0.1:${box.port}`;
      const context = await browser.newContext({ viewport: phone ? { width: 412, height: 915 } : { width: 1440, height: 900 }, ...(phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' } : {}), serviceWorkers: 'block', permissions: ['microphone'] });
      const state = async () => (await fetch(origin + '/qa/state')).json();
      try {
        await context.routeWebSocket('**/*', w => w.close());
        const mix = { 'wizard/desktop-chats': true, ...(SW ? { [ID]: true } : {}) };
        await context.addInitScript(({ phone, skin, mix }) => {
          if (window !== top) return;
          if (sessionStorage.getItem('qaBoot')) return; sessionStorage.setItem('qaBoot', '1');
          for (const [k, v] of Object.entries({ 'wos.shell': phone ? 'phone' : 'desktop', 'wux.shell': phone ? 'phone' : 'desktop', 'wos.desktop-view.v1': 'classic', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
            'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix }) })) localStorage.setItem(k, v);
        }, { phone, skin, mix });
        // Stand-ins only for speech-to-text and the recording's upload (the fake microphone says nothing).
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), p = u.pathname;
          if (u.origin !== origin) return r.abort();
          if (p === '/wizard/v1/bootstrap') {
            const real = await r.fetch(); const j = await real.json();
            j.endpoints = { ...j.endpoints, transcribe: '/qa/transcribe', upload: '/wizard/files/upload' }; j.capabilities = { ...j.capabilities, voice: true, files: true };
            return r.fulfill({ json: j });
          }
          if (q.method() === 'POST' && p === '/qa/transcribe') return r.fulfill({ json: { text: entry.said, ms: 90 } });
          if (q.method() === 'POST' && p === '/wizard/files/upload') return r.fulfill({ json: { file: { id: 'qa-voice-' + Date.now(), filename: 'voice.webm', mime: 'audio/webm', bytes: 10 } } });
          return r.continue();
        });
        const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
        await page.goto(origin + '/wizard-os-home/' + (phone ? 'index.html?phone' : 'desktop.html'));
        await page.waitForFunction(() => (window.__wux || window.__wos) && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy && window.WosAgents?.ready, null, { timeout: 30000 });
        await page.addStyleTag({ content: '#wosWelcome{display:none!important}' });
        if (SW) await page.waitForFunction(id => (document.documentElement.dataset.tweaks || '').split(' ').includes(id), ID);
        await nap(1500);
        entry.before = (await state()).runs.length;
        // Typed: the phone's typed orb; the desktop's launcher Ask (⌘Enter).
        if (name === 'typed') await page.evaluate(([t, phone]) => phone ? window.__wos.runUtterance(t, 'auto', true) : window.__wux.ask(t), [entry.said, phone]);
        else {
          const orb = async () => { if (phone) await page.locator('#orbWrap').tap(); else await page.keyboard.press('Alt+KeyV'); };
          await orb();
          await nap(1800);
          await orb();
        }
        const t0 = Date.now();
        let st; while (Date.now() - t0 < 15000) { st = await state(); if (st.runs.length > entry.before) break; await nap(250); }
        entry.runs = st.runs.map(x => ({ agent: x.agent, input: x.input, model: x.model, session: x.session_id }));
        entry.sent = st.sent.slice(0, 3).map(x => ({ text: x.text, agent_id: x.agent_id, chosen_by: x.chosen_by, corrected: x.corrected || null }));
        await nap(1500);
        entry.front = await page.evaluate(() => {
          const chip = [...document.querySelectorAll('.wpr-chip')].find(n => n.getClientRects().length);
          const thread = [...document.querySelectorAll('.ch-thread')].find(n => n.getClientRects().length);
          return { chip: chip ? chip.innerText.replace(/\s+/g, ' ').trim() : null, thread: !!thread, title: thread?.querySelector('.ch-head .ti')?.innerText?.trim() || null };
        });
        await page.screenshot({ path: path.join(out, stem + '.png') });
        if (name === 'move' && SW && entry.front.chip) {
          const first = entry.runs.at(-1);
          await page.locator('.wpr-chip').filter({ visible: true }).first().click();
          await page.locator('.wpr-sheet .wpr-panel').waitFor();
          entry.sheet = await page.locator('.wpr-sheet .wpr-panel').evaluate(n => ({ bg: getComputedStyle(n).backgroundColor, rows: [...n.querySelectorAll('[data-wprmove]')].map(b => b.dataset.wprmove) }));
          await page.screenshot({ path: path.join(out, stem + '-sheet.png') });
          await page.locator('.wpr-sheet [data-wprmove="philosopher"]').click();
          const t1 = Date.now();
          while (Date.now() - t1 < 15000) { st = await state(); if (st.runs.length > entry.runs.length) break; await nap(250); }
          await nap(1500);
          st = await state();
          entry.moved = { runs: st.runs.slice(entry.runs.length).map(x => ({ agent: x.agent, input: x.input, session: x.session_id })), archived: st.archived, old: first?.session,
            sent: st.sent.slice(0, 2).map(x => ({ text: x.text, agent_id: x.agent_id, chosen_by: x.chosen_by, corrected: x.corrected || null })) };
          entry.front.after = await page.evaluate(() => { const c = [...document.querySelectorAll('.wpr-chip')].find(n => n.getClientRects().length); return c ? c.innerText.replace(/\s+/g, ' ').trim() : null; });
          await page.screenshot({ path: path.join(out, stem + '-moved.png') });
        }
        const last = entry.runs.at(-1) || {};
        assert.equal(entry.runs.length, entry.before + 1, 'one run');
        assert.equal(last.input, entry.said, 'the owner\'s exact words');
        if (!SW) {
          assert.equal(last.agent, 'private', 'switch off: the default agent, as today');
          assert.equal(entry.front.chip, null, 'switch off: no chip');
        } else if (name === 'philosopher') {
          assert.equal(last.agent, 'philosopher'); assert.equal(last.model, 'claude-fable-5');
          assert.match(entry.front.chip || '', /Philosopher · Claude Fable · you named it/);
        } else if (name === 'personal' || name === 'move') {
          assert.equal(last.agent, 'private'); assert.match(entry.front.chip || '', /Private · .* · personal data/);
          if (name === 'move') {
            assert.equal(entry.moved.runs.length, 1, 'one new run'); assert.equal(entry.moved.runs[0].agent, 'philosopher'); assert.equal(entry.moved.runs[0].input, entry.said);
            assert.ok(entry.moved.archived.some(a => a.id === entry.moved.old), 'the old thread (no reply yet) is removed');
            assert.equal(entry.moved.sent.filter(x => x.corrected).length, 1, 'one correction on the Sent row');
            assert.match(entry.front.after || '', /Philosopher · Claude Fable/);
            assert.equal(entry.sheet.rows[0], 'private', 'Private group first');
            assert.ok(!/rgba\([^)]*, 0(\.\d+)?\)|transparent/.test(entry.sheet.bg), 'opaque sheet panel: ' + entry.sheet.bg);
          }
        } else if (name === 'typed') {
          assert.equal(last.agent, 'hermes'); assert.equal(last.model, 'claude-opus-5-5'); assert.match(entry.front.chip || '', /Hermes · .*Opus.* · you named it/);
        } else if (name === 'default') {
          assert.equal(last.agent, 'private'); assert.match(entry.front.chip || '', /Private · .* · default/);
        }
        assert.deepEqual(entry.errors, []);
        entry.pass = true;
      } catch (e) {
        entry.pass = false; entry.failure = String(e.stack || e).split('\n').slice(0, 3).join(' ');
      } finally { await context.close(); box.proc.kill(); }
    }
  } finally { await browser.close(); fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); }
  for (const c of report.cases) console.log(c.stem, c.pass ? 'PASS' : 'FAIL', JSON.stringify({ runs: (c.runs || []).slice(-1), sent: (c.sent || []).slice(0, 1), front: c.front, moved: c.moved }), c.failure || '', c.errors.length ? 'errors: ' + c.errors.join(' | ') : '');
  if (!EXPECT_BROKEN && report.cases.some(c => !c.pass)) process.exitCode = 1;
})();
