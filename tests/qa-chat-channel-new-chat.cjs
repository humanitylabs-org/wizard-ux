'use strict';
// Channels (wizard/chat-channels, wizard-ux issue 1291) in a real browser: with a channel's feed open, every way of
// starting a new chat goes into THAT channel, never General. Desktop 1440x900 AI apps (the main-column feed) and phone
// 412x915 (the Chats feed), Nebula + Grove. Same disposable synthetic transport as tests/qa-chat-channels-ai-apps.cjs:
// nothing reaches a box; the only writes answered are the synthetic send and its Space filing. A fake microphone
// (Chromium's fake capture device) records the voice takes.
// Desktop: ⌥V records into the feed's own box (the pill says "new post in # <channel>", the feed stays, the take is
// filed into the channel at Send; the orb's idle talk takes the same talkNew path, tests/channel-new-chat-entry-points); + and ⌥N put the cursor in the feed's box; a post's thread open: ⌥V records a reply there.
// Phone: the orb records into the feed's box; + puts the cursor in it. No channel open: New chat as today.
// QA_EXPECT=broken (with QA_WEB=<main>/web) checks the baseline: the same steps leave the channel for General.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://chat-channels.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'chat-channel-new-chat-evidence');
const SKINS = (process.env.QA_SKINS || 'nebula,grove').split(','), SHELLS = (process.env.QA_SHELLS || 'desktop,phone').split(',');
const BROKEN = process.env.QA_EXPECT === 'broken';
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const SPACES = [
  { id: 'apps', name: 'WizardOS Apps', agent: 'hermes', threads: ['qa-a1'], createdAt: iso(now - 9e8) },
  { id: 'voice', name: 'Voice', agent: 'hermes', threads: ['qa-v1'], createdAt: iso(now - 8e8) },
];
const ROWS = [
  { id: 'qa-a1', title: 'Store listing', at: now - 5 * 36e5, preview: 'Here is the listing.' },
  { id: 'qa-v1', title: 'Voice keys', at: now - 2 * 36e5, preview: 'Shipped.' },
  { id: 'qa-g1', title: 'Weekend plans', at: now - 60 * 6e4, preview: 'Here is a plan.' },
].map(s => ({ id: s.id, title: s.title, runtime: 'direct', status: 'completed', updated_at: iso(s.at), updatedAt: iso(s.at), last_active: s.at / 1000, message_count: 2, messageCount: 2, archived: false, preview: s.preview }));
const report = { origin, web, expect: BROKEN ? 'broken' : 'fixed', cases: [] };
(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  try {
    for (const shell of SHELLS) for (const skin of SKINS) {
      const stem = `${shell}-${skin}${BROKEN ? '-before' : ''}`, phone = shell === 'phone';
      const entry = { stem, errors: [], refused: [], writes: [], steps: {} }; report.cases.push(entry);
      const context = await browser.newContext({ viewport: phone ? { width: 412, height: 915 } : { width: 1440, height: 900 }, ...(phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' } : {}), serviceWorkers: 'block', permissions: ['microphone'] });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        await context.addInitScript(({ skin, spaces, phone }) => {
          if (window !== top) return;
          if (sessionStorage.getItem('qaBoot')) return; sessionStorage.setItem('qaBoot', '1');
          const mix = { 'wizard/chat-channels': true, ...(phone ? {} : { 'wizard/desktop-chats': true }) };
          for (const [k, v] of Object.entries({ 'wos.shell': phone ? 'phone' : 'desktop', 'wux.shell': phone ? 'phone' : 'desktop', 'wos.desktop-view.v1': phone ? 'classic' : 'ai-apps', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
            'wos.chats.spaces.v1': JSON.stringify(spaces), 'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix }) })) localStorage.setItem(k, v);
        }, { skin, spaces: SPACES, phone });
        let prefs = { migrations: { 'launcher-seed-v1': true }, spaces: structuredClone(SPACES) };
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), method = q.method(), p = u.pathname;
          if (u.origin !== origin) { entry.refused.push({ method, url: q.url(), reason: 'external' }); return r.abort(); }
          if (!['GET', 'HEAD'].includes(method)) {
            entry.writes.push({ method, path: p });
            if (method === 'PUT' && p === '/wizard/thread-seen') return r.fulfill({ json: { ok: true, state: q.postDataJSON() } });
            if (method === 'POST' && p === '/wizard/files/upload') return r.fulfill({ json: { file: { id: 'qa-up-' + entry.writes.length, filename: 'voice.webm', mime: 'audio/webm', bytes: 10 } } });
            if (method === 'POST' && /\/(transcribe|transcriptions|stt)\b/.test(p)) return r.fulfill({ json: { text: 'Synthetic voice post', transcript: 'Synthetic voice post' } });
            if (method === 'POST' && p === '/wizard/hermes/api/sessions') { const b = q.postDataJSON() || {}; (entry.created = entry.created || []).push(b.id); return r.fulfill({ json: { session: { id: b.id } } }); }
            if (method === 'POST' && p === '/wizard/hermes/v1/runs') { entry.runs = (entry.runs || []).concat(q.postData() || ''); return r.fulfill({ json: { run_id: 'run-qa-' + entry.runs.length } }); }
            if (method === 'PATCH' && p === '/wizard/v1/ui-preferences') {
              for (const op of q.postDataJSON()?.ops || []) { const m = /^spaces\/([a-z0-9-]+)\/threads$/.exec(op.key); if (m && op.op === 'add') prefs.spaces = prefs.spaces.map(s => s.id === m[1] && !s.threads.includes(op.item) ? { ...s, threads: s.threads.concat(op.item) } : s); }
              return r.fulfill({ json: prefs });
            }
            entry.refused.push({ method, path: p, reason: 'unexpected-write' }); return r.fulfill({ status: 405, json: { error: 'Synthetic fixture refuses this write' } });
          }
          if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
          if (p.startsWith(prefix)) {
            const f = decodeURIComponent(p.slice(prefix.length) || 'index.html'), abs = path.resolve(web, f);
            if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
            if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return r.fulfill({ path: abs });
            return r.fulfill({ status: 404, body: 'No synthetic static asset' });
          }
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: prefs });
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: ROWS, has_more: false } });
          const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
          if (m) { const s = ROWS.find(x => x.id === decodeURIComponent(m[1])); if (!s) return r.fulfill({ status: 404, json: { error: 'missing' } });
            return r.fulfill({ json: m[2] ? { messages: [{ role: 'user', content: 'Synthetic ask for ' + s.title, timestamp: now / 1000 - 600 }, { role: 'assistant', content: s.preview, timestamp: now / 1000 - 590 }] } : { session: s } }); }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
        await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
        await page.waitForFunction(() => (window.__wux || window.__wos) && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
        await page.waitForFunction(() => (document.documentElement.dataset.tweaks || '').split(' ').includes('wizard/chat-channels'), null, { timeout: 15000 });
        if (!phone) await page.waitForFunction(() => document.documentElement.dataset.layout === 'ai-apps', null, { timeout: 15000 }); // the phone has no AI apps view
        const vis = sel => page.locator(sel).filter({ visible: true }).first();
        const filed = id => page.evaluate(id => JSON.parse(localStorage.getItem('wos.chats.spaces.v1') || '[]').find(s => s.id === id)?.threads || [], id);
        const voiceIdle = () => page.waitForFunction(() => !document.documentElement.classList.contains('voice-on') && !document.querySelector('.ch-mic.on'), null, { timeout: 15000 });
        // The channel's feed: desktop opens it from the sidebar's Channels tab into the main column; the phone in Chats.
        const feedSel = phone ? '.ch-chan-feed' : '.aad-feed .ch-chan-feed';
        const openFeed = async id => {
          if (phone) { await page.evaluate(() => __wos.openSheet('inbox')); await vis('.ch-chan-tabs').waitFor({ timeout: 10000 }); await nap(300);
            if (await page.locator('[data-chview="channels"]').filter({ visible: true }).count()) await vis('[data-chview="channels"]').click();
            await vis(`.ch-chan-open[data-chchan="${id}"]`).click(); }
          else { if (await page.locator('.aad-chan [data-chview="channels"]').filter({ visible: true }).count()) await vis('.aad-chan [data-chview="channels"]').click(); await vis(`.aad-chan .ch-chan-open[data-chchan="${id}"]`).click(); }
          await vis(feedSel).waitFor({ timeout: 10000 }); await nap(500);
        };
        const feedMic = () => page.locator(`${feedSel} .ch-chan-compose .ch-mic`).filter({ visible: true }).first();
        const step = async (name, fn) => { try { entry.steps[name] = await fn(); } catch (e) { entry.steps[name] = { error: String(e.message || e).split('\n')[0] }; throw e; } };
        if (!phone) await vis('.aad-side').waitFor({ timeout: 15000 });
        await openFeed('apps');
        await page.screenshot({ path: path.join(out, stem + '-feed.png') });
        // 1. Voice: ⌥V on desktop, the orb on the phone. Fixed: the feed box's mic lights up (a take into this channel).
        await step('voice', async () => {
          if (phone) await vis('#orbWrap').tap(); else await page.keyboard.press('Alt+KeyV');
          await page.waitForFunction(() => document.documentElement.classList.contains('voice-on') || document.querySelector('#wosVoice:not([hidden]), .voice-on'), null, { timeout: 8000 }).catch(() => {});
          await nap(1600);
          // Where the take goes, as the owner sees it: the desktop's recording pill, the phone's destination line.
          const said = (await page.evaluate(() => [document.querySelector('#voiceText'), document.querySelector('#voiceDestination, .voice-destination')].filter(x => x?.getClientRects().length).map(x => x.innerText).join(' | '))).replace(/\s+/g, ' ');
          const lit = /# WizardOS Apps/.test(said) || await feedMic().evaluate(b => b.classList.contains('on')).catch(() => false);
          await page.screenshot({ path: path.join(out, stem + '-voice-recording.png') });
          const before = await filed('apps');
          if (phone) await vis('#orbWrap').tap(); else await page.keyboard.press('Alt+KeyV');
          await page.waitForFunction(n => JSON.parse(localStorage.getItem('wos.chats.spaces.v1') || '[]').find(s => s.id === 'apps')?.threads.length > n, before.length, { timeout: 12000 }).catch(() => {});
          await nap(1200);
          const after = await filed('apps'), feedStays = await page.locator(feedSel).filter({ visible: true }).count() > 0;
          await page.screenshot({ path: path.join(out, stem + '-voice-sent.png') });
          return { said, lit, filedInChannel: after.length > before.length, feedStays, created: (entry.created || []).length };
        });
        await voiceIdle().catch(() => {});
        // 2. New chat: + (and ⌥N on desktop). Fixed: the feed stays and the cursor is in its box.
        await step('plus', async () => {
          if (!await page.locator(feedSel).filter({ visible: true }).count()) await openFeed('apps');
          // The phone's Chats feed has no + of its own: its message box stands where New chat's + is (issue 1258).
          if (phone) { await page.screenshot({ path: path.join(out, stem + '-plus.png') }); return page.evaluate(sel => ({ feed: !!document.querySelector(sel)?.getClientRects().length, fab: [...document.querySelectorAll('.ch-fab')].filter(x => x.getClientRects().length).length, box: !!document.querySelector('.ch-chan-compose textarea')?.getClientRects().length }), feedSel); }
          await vis('.aad-new, .aad-rnew').click(); await nap(700);
          const r = await page.evaluate(sel => ({ feed: !!document.querySelector(sel)?.getClientRects().length, inBox: !!document.activeElement?.closest?.('.ch-chan-compose') }), feedSel);
          await page.screenshot({ path: path.join(out, stem + '-plus.png') });
          return r;
        });
        if (!phone) await step('altN', async () => {
          if (!await page.locator(feedSel).filter({ visible: true }).count()) await openFeed('apps');
          await page.locator('.aad-tt').first().click().catch(() => {}); await page.keyboard.press('Alt+KeyN'); await nap(700);
          return page.evaluate(sel => ({ feed: !!document.querySelector(sel)?.getClientRects().length, inBox: !!document.activeElement?.closest?.('.ch-chan-compose') }), feedSel);
        });
        // 3. A post's thread open (desktop): ⌥V records a reply in that thread, never a new chat.
        if (!phone) await step('threadReply', async () => {
          if (!await page.locator(feedSel).filter({ visible: true }).count()) await openFeed('apps');
          await vis(`${feedSel} .ch-post-b[data-chopen="qa-a1"]`).click();
          await page.waitForFunction(() => [...document.querySelectorAll('.ch-thread')].some(t => t.getClientRects().length && /Store listing/.test(t.innerText)), null, { timeout: 8000 });
          await nap(400); await page.keyboard.press('Alt+KeyV'); await nap(1500);
          const said = (await page.evaluate(() => document.querySelector('#voiceText')?.innerText || '')).replace(/\s+/g, ' ');
          await page.screenshot({ path: path.join(out, stem + '-thread-voice.png') });
          await page.evaluate(() => __wux.escStep?.()); await nap(300); await page.keyboard.press('Escape'); await nap(400);
          await page.evaluate(() => document.querySelector('#voiceCancel')?.click()); await nap(400);
          return { said, replyMicLit: /Store listing/.test(said) };
        });
        await voiceIdle().catch(() => {});
        entry.refusedWrites = entry.refused.filter(x => x.reason === 'unexpected-write').map(x => x.method + ' ' + x.path);
        const s = entry.steps;
        if (BROKEN) {
          if (!phone) assert.ok(!s.voice.filedInChannel && !s.plus.inBox && !s.altN.inBox, 'baseline: ⌥V, + and ⌥N leave the channel');
        } else {
          if (!phone) assert.equal(s.voice.lit, true, 'the recording pill names the channel');
          assert.equal(s.voice.filedInChannel, true, 'the voice post is filed into the channel');
          assert.equal(s.voice.feedStays, true, 'the feed stays open');
          assert.deepEqual(s.plus, phone ? { feed: true, fab: 0, box: true } : { feed: true, inBox: true }, '+ puts the cursor in the channel\'s box');
          if (!phone) { assert.deepEqual(s.altN, { feed: true, inBox: true }, '⌥N too'); assert.equal(s.threadReply.replyMicLit, true, 'a post\'s thread: ⌥V replies there'); }
          assert.equal(entry.errors.length, 0, 'browser errors: ' + entry.errors.join('; '));
        }
        entry.pass = true;
      } catch (e) { entry.failure = e.stack; const pages = context.pages(); if (pages[0]) await pages[0].screenshot({ path: path.join(out, stem + '-failure.png') }).catch(() => {}); }
      finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await context.close(); }
    }
  } finally { await browser.close(); }
  const failed = report.cases.filter(c => !c.pass);
  console.log(JSON.stringify({ expect: report.expect, cases: report.cases.map(c => ({ stem: c.stem, pass: !!c.pass, steps: c.steps, refused: c.refusedWrites, failure: c.failure && String(c.failure).split('\n').slice(0, 2).join(' | ') })) }, null, 1));
  if (failed.length || report.cases.length !== SKINS.length * SHELLS.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
