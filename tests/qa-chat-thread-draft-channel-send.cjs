'use strict';
// A thread's draft survives a post sent from a channel's box (wizard-ux issue 1444) in a real browser, switch
// wizard/chat-channels on. Disposable synthetic transport only. Phone 390x844 and desktop 1440x960 (classic), Nebula.
// Ways (QA_WAYS): `post` (the thread is a post in the channel: open it from the feed, Back lands on the feed, send a post
// there, tap the post again), `fail` (the same, but the box refuses the channel post: its words go back to the channel
// box), `switch` (the same, but words are only typed into the channel box, not sent: both boxes keep their own),
// `newchat` (a New chat is sent in between) and `list` (a thread outside the channel: Back, open the channel, send, Back
// to channels, open the thread again). QA_EXPECT=broken checks the old behaviour: on main the draft is gone in the
// feed ways (post, fail, switch); newchat and list are controls that pass on both.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://chat-channels.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'thread-draft-channel-evidence');
const broken = process.env.QA_EXPECT === 'broken';
const shells = (process.env.QA_SHELLS || 'phone,desktop').split(','), ways = (process.env.QA_WAYS || 'post,fail,switch,newchat,list').split(',');
const FEED = new Set(['post', 'fail', 'switch']);
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const SPACES = [{ id: 'launch', name: 'Launch', agent: 'hermes', threads: ['qa-l1'], createdAt: iso(now - 9e8) }];
const ROWS = [{ id: 'qa-l1', title: 'Launch checklist', status: 'completed', at: now - 5 * 36e5, preview: 'Ready.' }, { id: 'qa-g1', title: 'Philosopher', status: 'completed', at: now - 36e5, preview: 'A thought.' }]
  .map(s => ({ id: s.id, title: s.title, runtime: 'direct', status: s.status, updated_at: iso(s.at), updatedAt: iso(s.at), last_active: s.at / 1000, message_count: 2, messageCount: 2, archived: false, preview: s.preview }));
const DRAFT = 'A half-typed reply to the philosopher', POST = 'Posting this from the channel box';
const report = { origin, web, broken, cases: [] };
(async () => {
  const browser = await chromium.launch();
  try {
    for (const shell of shells) for (const way of ways) {
      const phone = shell === 'phone', stem = `${shell}-${way}-${broken ? 'before' : 'after'}`, entry = { stem, errors: [], refused: [], created: [] }; report.cases.push(entry);
      const context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 960 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block' });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        await context.addInitScript(({ shell, spaces }) => {
          if (window !== top || sessionStorage.getItem('qa.seeded')) return; sessionStorage.setItem('qa.seeded', '1');
          for (const [k, v] of Object.entries({ 'wos.shell': shell, 'wos.desktop-view.v1': 'classic', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': 'nebula',
            'wos.chats.spaces.v1': JSON.stringify(spaces), 'wos.chats.view.v1': 'channels', 'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix: { 'wizard/desktop-chats': true, 'wizard/chat-channels': true } }) })) localStorage.setItem(k, v);
        }, { shell, spaces: SPACES });
        const prefs = { migrations: { 'launcher-seed-v1': true }, spaces: structuredClone(SPACES) };
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), method = q.method(), p = u.pathname;
          if (u.origin !== origin) { entry.refused.push({ method, url: q.url(), reason: 'external' }); return r.abort(); }
          if (!['GET', 'HEAD'].includes(method)) {
            if (method === 'PUT' && p === '/wizard/thread-seen') return r.fulfill({ json: { ok: true, state: q.postDataJSON() } });
            if (method === 'POST' && p === '/wizard/hermes/api/sessions' && way === 'fail') { entry.refusedPosts = (entry.refusedPosts || 0) + 1; return r.fulfill({ status: 422, json: { error: 'Synthetic refusal' } }); }
            if (method === 'POST' && p === '/wizard/hermes/api/sessions') { const b = q.postDataJSON() || {}; entry.created.push(b.id); return r.fulfill({ json: { session: { id: b.id } } }); }
            if (method === 'POST' && p === '/wizard/hermes/v1/runs') return r.fulfill({ json: { run_id: 'run-qa-' + entry.created.length } });
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
          if (m) { const s = ROWS.find(x => x.id === decodeURIComponent(m[1]));
            if (!s) return r.fulfill({ json: m[2] ? { messages: [{ role: 'user', content: POST, timestamp: Date.now() / 1000 }] } : { session: { id: m[1], title: 'New post' } } });
            return r.fulfill({ json: m[2] ? { messages: [{ role: 'user', content: 'Synthetic ask for ' + s.title, timestamp: now / 1000 - 600 }, { role: 'assistant', content: s.preview, timestamp: now / 1000 - 590 }] } : { session: s } }); }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
        await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
        await page.waitForFunction(() => (window.__wux || window.__wos) && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
        await page.waitForFunction(() => (document.documentElement.dataset.tweaks || '').split(' ').includes('wizard/chat-channels'), null, { timeout: 15000 });
        await page.evaluate(phone => phone ? __wos.openSheet('inbox') : __wux.openChatsList(), phone);
        const vis = sel => page.locator(sel).filter({ visible: true }).first();
        const sid = FEED.has(way) ? 'qa-l1' : 'qa-g1';
        const stored = () => page.evaluate(k => { try { return JSON.parse(localStorage.getItem('wos.chat.drafts.v1') || '{}')[k]?.text || ''; } catch (e) { return 'unreadable'; } }, 'direct:' + sid);
        const openThread = async () => {
          if (FEED.has(way)) await vis(`.ch-chan-feed [data-chopen="${sid}"]`).click();
          else await page.evaluate(([phone, sid]) => phone ? __wos.openWizardThread(sid) : __wux.openThread(sid), [phone, sid]);
          await vis('.ch-thread .ch-compose:not([data-chchanform]) textarea').waitFor();
        };
        // Back from the thread: the phone's ‹ button; the desktop's Esc step (its classic Chats window hides ‹).
        const back = async () => {
          if (phone) await vis('.ch-thread [data-chback]').click();
          else await page.evaluate(() => { const w = Object.values(__wux.wins).find(x => x?.app === 'chats' && x.thread); if (w) __wux.chats.chatsBack(w); });
          await nap(400);
        };
        // 1. Into the thread and type half a reply.
        if (FEED.has(way)) { await vis('.ch-chan-open[data-chchan="launch"]').click(); await vis('[data-chchanform] textarea').waitFor(); }
        await openThread();
        const ta = vis('.ch-thread .ch-compose:not([data-chchanform]) textarea');
        await ta.click(); await page.keyboard.type(DRAFT); await nap(200);
        entry.typedStored = await stored(); assert.equal(entry.typedStored, DRAFT, 'typing saves the draft');
        // 2. Leave the thread, into the channel, post from its box (or a New chat).
        await back();
        const chanSaved = () => page.evaluate(() => { try { const all = JSON.parse(localStorage.getItem('wos.chat.drafts.v1') || '{}'); return Object.keys(all).filter(k => k.startsWith('chan:')).map(k => all[k].text || ''); } catch (e) { return ['unreadable']; } });
        if (way === 'newchat') {
          await page.evaluate(() => { const el = [...document.querySelectorAll('[data-chats]')].find(e => e.checkVisibility?.() !== false && e.offsetParent); (window.__wos || window.__wux).chats.openChat(el.dataset.chats, '__new__'); });
          const nt = vis('.ch-thread .ch-compose:not([data-chchanform]) textarea'); await nt.waitFor();
          await nt.click(); await page.keyboard.type(POST); await vis('.ch-thread .ch-compose:not([data-chchanform]) .ch-send').click();
          await nap(1500);
          if (await vis('.ch-thread [data-chback]').count() && phone) await back();
        } else {
          if (way === 'list') { await vis('.ch-chan-open[data-chchan="launch"]').click(); }
          const box = vis('[data-chchanform] textarea'); await box.waitFor();
          await box.click(); await page.keyboard.type(POST);
          if (way !== 'switch') {
            await vis('[data-chchanform] .ch-send').click();
            if (way !== 'fail') await page.waitForFunction(() => !document.querySelector('[data-chchanform] textarea')?.value, null, { timeout: 5000 });
          }
          await nap(1500);
          if (way === 'fail') { await vis('.ch-pill').filter({ hasText: 'Not sent' }).waitFor({ timeout: 20000 }).catch(() => {}); await nap(500); }
        }
        entry.afterSendStored = await stored();
        // 3. Back into the thread.
        if (way === 'list') { const b = vis('[data-chchanback]'); if (await b.count()) await b.click(); await nap(300); }
        await openThread(); await nap(800);
        await page.screenshot({ path: path.join(out, stem + '.png') });
        entry.shown = await vis('.ch-thread .ch-compose:not([data-chchanform]) textarea').inputValue();
        // 4. And out again: the saved copy must still be there.
        await back();
        entry.finalStored = await stored();
        entry.posted = entry.created.length; entry.chanDrafts = await chanSaved();
        if (broken && FEED.has(way)) assert.notEqual(entry.shown === DRAFT && entry.finalStored === DRAFT, true, 'before the fix the draft is lost');
        else {
          if (way === 'fail') assert.ok(entry.refusedPosts >= 1, 'the box refused the channel post');
          else if (way !== 'switch') assert.equal(entry.posted, 1, 'the post (or New chat) was sent');
          if (way === 'switch' && !broken) assert.deepEqual(entry.chanDrafts, [POST], 'the channel box keeps its own words');
          assert.equal(entry.afterSendStored, DRAFT, 'sending in the channel left the thread draft alone');
          assert.equal(entry.shown, DRAFT, 'the thread shows its draft exactly as left');
          assert.equal(entry.finalStored, DRAFT, 'the draft is still saved after leaving again');
        }
        assert.deepEqual(entry.errors, []); assert.deepEqual(entry.refused.filter(x => x.reason === 'external'), []);
        entry.pass = true;
      } catch (e) { entry.failure = String(e.stack || e); } finally { await context.close(); }
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  const failed = report.cases.filter(c => !c.pass);
  console.log(JSON.stringify({ cases: report.cases.map(c => ({ stem: c.stem, pass: !!c.pass, typed: c.typedStored, afterSend: c.afterSendStored, shown: c.shown, final: c.finalStored, posted: c.posted, chan: c.chanDrafts })), failed: failed.map(c => c.stem + ': ' + String(c.failure).split('\n').slice(0, 3).join(' | ')) }, null, 1));
  if (failed.length || report.cases.length !== shells.length * ways.length) process.exitCode = 1;
})();
