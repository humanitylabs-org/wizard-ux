'use strict';
// A new channel post shows the owner's own words from its first frame, never the generated chat title, and never
// flips between the two (wizard/chat-channels, wizard-ux issue 1266, fourth item). Real browser, disposable synthetic
// transport (no box reads or writes). Phone 390x844 + desktop 1440x960, Nebula + Grove. # Philosophy gets two new
// posts, both titled by the box "Process Jonathan call transcript for insights":
//  - a voice note: its history is empty, then holds only the audio (4 s), then the transcript (from 10 s);
//  - a typed message: its history is empty for 6 s; the list alternates rows with and without the owner's words.
// The list is re-read every 700 ms for 30 s (the agent working, then done) while every animation frame is sampled.
// Pass: no frame shows the title; the voice post says "Voice note" until its transcript, then the transcript; the typed
// post shows its words from its first frame; once shown, the words never change back.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://chat-channel-words.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'chat-channel-words-evidence');
const RUN_MS = Number(process.env.QA_RUN_MS || 30000);
fs.mkdirSync(out, { recursive: true });
const iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const TITLE = 'Process Jonathan call transcript for insights';
const SAID = 'I just had a call with Jonathan. I would like you to pass the transcript to the philosopher.';
const TYPED = 'Summarise what Jonathan said about virtue';
const report = { origin, web, cases: [] };
(async () => {
  const browser = await chromium.launch();
  try {
    for (const shell of ['phone', 'desktop']) for (const skin of ['nebula', 'grove']) {
      const phone = shell === 'phone', stem = `${shell}-${skin}`;
      const entry = { stem, errors: [], refused: [] }; report.cases.push(entry);
      const context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 960 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block', ...(phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' } : {}) });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        const t0 = Date.now() - 60e3, SPACES = [{ id: 'philosophy', name: 'Philosophy', agent: 'hermes', threads: ['qa-old', 'qa-voice', 'qa-typed'], createdAt: iso(t0 - 9e8) }];
        await context.addInitScript(({ shell, skin, spaces }) => {
          if (window !== top || sessionStorage.getItem('qa.booted')) return; sessionStorage.setItem('qa.booted', '1');
          for (const [k, v] of Object.entries({ 'wos.shell': shell, 'wos.desktop-view.v1': 'classic', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
            'wos.chats.view.v1': 'channels', 'wos.chats.spaces.v1': JSON.stringify(spaces), 'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix: { 'wizard/desktop-chats': true, 'wizard/chat-channels': true } }) })) localStorage.setItem(k, v);
        }, { shell, skin, spaces: SPACES });
        const prefs = { migrations: { 'launcher-seed-v1': true }, spaces: structuredClone(SPACES) };
        let start = 0, lists = 0; // start: when the two new posts arrive (set once the feed is open)
        const since = () => start ? Date.now() - start : -1;
        const old = { id: 'qa-old', title: 'Older post', runtime: 'direct', status: 'completed', updated_at: iso(t0), last_active: t0 / 1000, last_assistant_at: iso(t0), message_count: 2, preview: 'Done', archived: false };
        const hist = {
          'qa-old': () => [{ role: 'user', content: 'An older question', timestamp: t0 / 1000 - 60 }, { role: 'assistant', content: 'Done', timestamp: t0 / 1000 }],
          'qa-voice': () => { const t = since(); if (t < 4000) return []; const at = (start + 1000) / 1000;
            if (t < 10000) return [{ role: 'user', content: '<helm_attachments>{"items":[{"id":"0123456789abcdef0123456789abcdef","name":"voice.webm","mime":"audio/webm"}]}</helm_attachments>', timestamp: at }];
            return [{ role: 'user', content: SAID, timestamp: at }, ...(t > 16000 ? [{ role: 'assistant', content: 'Passed it to the philosopher.', timestamp: at + 15 }] : [])]; },
          'qa-typed': () => { const t = since(); if (t < 6000) return []; const at = (start + 1500) / 1000;
            return [{ role: 'user', content: TYPED, timestamp: at }, { role: 'assistant', content: '', tool_calls: [{ id: 'c1', function: { name: 'terminal' } }], timestamp: at + 2 }, { role: 'tool', tool_call_id: 'c1', content: 'ok', timestamp: at + 3 }]; },
        };
        const rows = () => {
          const t = since(); if (t < 0) return [old];
          const working = t < 20000, odd = ++lists % 2 === 0, at = start + 1000; // every other read is stale (the first is not)
          const voice = { id: 'qa-voice', title: TITLE, runtime: 'direct', status: working ? 'running' : 'completed', wizard_run_id: working ? 'run-v' : '', updated_at: iso(at), last_active: at / 1000, message_count: 3 + Math.floor(t / 2000), archived: false,
            // A stale read every other time: no owner words; else the transcript once it is known.
            ...(odd || t < 10000 ? { preview: 'Running terminal' } : { last_user_message: { role: 'user', content: SAID, timestamp: at / 1000 }, latest_message: { role: 'user', content: SAID, timestamp: at / 1000 } }) };
          const typed = { id: 'qa-typed', title: TITLE, runtime: 'direct', status: working ? 'running' : 'completed', wizard_run_id: working ? 'run-t' : '', updated_at: iso(at + 500), last_active: (at + 500) / 1000, message_count: 2 + Math.floor(t / 2000), archived: false,
            ...(odd ? { preview: 'Running terminal' } : { last_user_message: { role: 'user', content: TYPED, timestamp: (at + 500) / 1000 }, latest_message: { role: 'user', content: TYPED, timestamp: (at + 500) / 1000 } }) };
          return [old, voice, typed];
        };
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), method = q.method(), p = u.pathname;
          if (u.origin !== origin) { entry.refused.push({ method, url: q.url(), reason: 'external' }); return r.abort(); }
          if (!['GET', 'HEAD'].includes(method)) {
            if (method === 'PUT' && p === '/wizard/thread-seen') return r.fulfill({ json: { ok: true, state: q.postDataJSON() } });
            entry.refused.push({ method, path: p, reason: 'unexpected-write' }); return r.fulfill({ status: 405, json: { error: 'Synthetic fixture refuses this write' } });
          }
          if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
          if (p.startsWith(prefix)) {
            const f = decodeURIComponent(p.slice(prefix.length) || 'index.html'), abs = path.resolve(web, f);
            if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
            if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return r.fulfill({ path: abs });
            return r.fulfill({ status: 404, body: 'No synthetic static asset' });
          }
          if (p === '/wizard/thread-seen') return r.fulfill({ json: { state: { initializedAt: 1, threads: {} } } });
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: prefs });
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: rows(), has_more: false } });
          const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
          if (m) { const id = decodeURIComponent(m[1]), s = rows().find(x => x.id === id); if (!s) return r.fulfill({ status: 404, json: { error: 'missing' } });
            if (!m[2]) return r.fulfill({ json: { session: s } });
            const all = hist[id](), off = Number(u.searchParams.get('offset') || 0), lim = Number(u.searchParams.get('limit') || 500), page = all.slice(off, off + lim);
            return r.fulfill({ json: { messages: page, pagination: { returned: page.length } } }); }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(String(e.stack || e.message).slice(0, 900)));
        await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
        await page.waitForFunction(() => (window.__wux || window.__wos) && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
        await page.waitForFunction(() => (document.documentElement.dataset.tweaks || '').split(' ').includes('wizard/chat-channels'), null, { timeout: 15000 });
        await page.evaluate(phone => phone ? __wos.openSheet('inbox') : __wux.openChatsList(), phone);
        const vis = sel => page.locator(sel).filter({ visible: true }).first();
        await vis('.ch-chan-open[data-chchan="philosophy"]').click(); await vis('.ch-chan-h').waitFor(); await nap(500);
        // Sample every frame: what each new post says.
        await page.evaluate(() => {
          window.__qaFrames = [];
          const tick = () => {
            const sc = [...document.querySelectorAll('.ch-list > .ch-scroll')].find(e => e.getClientRects().length && e.querySelector('.ch-chan-feed'));
            const said = id => { const p = sc && [...sc.querySelectorAll('.ch-post[data-chrow]')].find(x => x.dataset.chrow.endsWith('|' + id)); if (!p) return null; const t = p.querySelector('.ch-post-t'); return t ? (t.classList.contains('ch-post-wait') ? '<loading>' : t.textContent) : '<empty>'; };
            window.__qaFrames.push({ at: performance.now(), voice: said('qa-voice'), typed: said('qa-typed') });
            window.__qaRaf = requestAnimationFrame(tick);
          };
          tick();
        });
        start = Date.now();
        while (Date.now() - start < RUN_MS) { await page.evaluate(() => window.WizLive.refresh()).catch(() => {}); await nap(700); }
        await nap(1500);
        if (since() > 12000) await page.screenshot({ path: path.join(out, stem + '.png') });
        const frames = await page.evaluate(() => { cancelAnimationFrame(window.__qaRaf); return window.__qaFrames; });
        const seenVoice = frames.map(f => f.voice).filter(v => v !== null), seenTyped = frames.map(f => f.typed).filter(v => v !== null);
        const kinds = list => [...new Set(list)];
        entry.frames = frames.length; entry.lists = lists; entry.voiceSaid = kinds(seenVoice); entry.typedSaid = kinds(seenTyped);
        assert.ok(seenVoice.length > 100 && seenTyped.length > 100, 'both posts were on screen for many frames');
        for (const v of [...seenVoice, ...seenTyped]) assert.ok(!v.includes('Process Jonathan'), 'a frame showed the generated title: ' + v);
        assert.equal(seenVoice.at(-1), SAID, 'the voice post ends on its transcript');
        assert.equal(seenTyped[0], TYPED, 'the typed post shows its words from its first frame');
        for (const v of seenTyped) assert.equal(v, TYPED, 'the typed post never changes');
        const firstWords = seenVoice.indexOf(SAID);
        // Before its transcript: "Voice note" once the audio is in its history (the outbox's own row says so from the
        // send tap; this fixture has no outbox), else the loading line. Never words or a title.
        assert.ok(seenVoice.slice(0, firstWords).every(v => v === 'Voice note' || v === '<loading>'), 'before its transcript: ' + kinds(seenVoice.slice(0, firstWords)));
        assert.ok(seenVoice.slice(0, firstWords).includes('Voice note'), 'the voice post said "Voice note" while its transcript was pending');
        assert.ok(seenVoice.slice(firstWords).every(v => v === SAID), 'once shown, the transcript stays');
        assert.deepEqual(entry.errors, [], 'no page errors');
        assert.deepEqual(entry.refused, [], 'no unexpected requests');
        entry.pass = true;
      } catch (e) { entry.pass = false; entry.failure = String(e.message || e).slice(0, 600); }
      finally { await context.close(); }
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
  for (const c of report.cases) console.log(c.pass ? 'PASS' : 'FAIL', c.stem, c.failure || '', JSON.stringify({ frames: c.frames, lists: c.lists, voice: c.voiceSaid, typed: c.typedSaid, errs: c.errors }));
  process.exit(report.cases.every(c => c.pass) ? 0 : 1);
})();
