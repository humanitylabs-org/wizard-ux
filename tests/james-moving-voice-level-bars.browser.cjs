// James's phone hearing-bars regression: real shell/recorder gesture, deterministic analyser samples.
// No live API calls: every request is served from this checkout or an explicit fixture below.
// Run on forum: QA_PLAYWRIGHT=/srv/work/wux-voice/deps/node_modules/playwright node tests/james-moving-voice-level-bars.browser.cjs
const { chromium } = require('../tools/qa-playwright.cjs');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), origin = 'http://127.0.0.1:9371';
const out = process.env.QA_VOICE_METER_OUTPUT || path.join(root, 'qa-voice-bars-evidence');
fs.mkdirSync(out, { recursive: true });
const measurements = [];
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.QA_CHROMIUM || undefined,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox'] });
  try {
    for (const width of [360, 412]) for (const skin of ['nebula', 'grove']) {
      const context = await browser.newContext({ viewport: { width, height: 892 }, deviceScaleFactor: 1,
        hasTouch: true, isMobile: true, permissions: ['microphone'] });
      const errors = [], sends = [];
      await context.route('**/*', r => {
        const q = r.request(), u = new URL(q.url());
        if (u.origin !== origin) return r.abort();
        const m = u.pathname.match(/^\/wizard-os-home\/(.*)$/);
        if (m && q.method() === 'GET' && !m[1].startsWith('api/')) {
          const file = path.resolve(root, 'web', m[1] || 'index.html');
          if (!file.startsWith(path.join(root, 'web') + '/')) return r.abort();
          const ext = path.extname(file), ct = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json' }[ext] || 'application/octet-stream';
          return r.fulfill({ status: 200, contentType: ct, body: fs.existsSync(file) ? fs.readFileSync(file) : '' });
        }
        if (q.method() !== 'GET' && /transcribe|\/route$|\/runs/.test(u.pathname)) sends.push(u.pathname);
        if (/\/hermes\/api\/sessions$/.test(u.pathname)) return r.fulfill({ json: { data: [], has_more: false } });
        if (/\/wizard\/thread-seen$/.test(u.pathname)) return r.fulfill({ json: { state: { initializedAt: Date.now(), threads: {} } } });
        return r.fulfill({ json: {} });
      });
      await context.addInitScript(skin => {
        localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTip', '1');
        localStorage.setItem('wos.skin', skin); window.__qaMicAmplitude = 0;
        AnalyserNode.prototype.getByteTimeDomainData = function (a) { a.fill(128 + window.__qaMicAmplitude); };
      }, skin);
      const p = await context.newPage(); p.on('pageerror', e => errors.push(String(e)));
      await p.goto(origin + '/wizard-os-home/');
      await p.waitForFunction(() => window.__wos?.live?.ok);
      await p.waitForTimeout(700);
      assert.equal(await p.evaluate(() => document.documentElement.dataset.skin), skin);
      assert.equal(await p.locator('#voiceMeter').isVisible(), false, 'idle meter hidden');
      const orb = await p.locator('#orbWrap').boundingBox();
      await p.touchscreen.tap(orb.x + orb.width / 2, orb.y + orb.height / 2);
      await p.waitForFunction(() => window.__wos.voice === 'listen');
      await p.waitForFunction(() => document.querySelector('#voiceMeter').style.getPropertyValue('--voice-meter-level') === '0');
      async function measure(name) {
        const s = await p.evaluate(() => {
          const meter = document.querySelector('#voiceMeter'), bar = meter.children[3];
          const rect = n => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
          const ids = ['timer', 'voiceDestination', 'arcCancel', 'arcPause', 'arcScreen', 'arcAttach'];
          return { voice: __wos.voice, level: +meter.style.getPropertyValue('--voice-meter-level'),
            display: getComputedStyle(meter).display, pointerEvents: getComputedStyle(meter).pointerEvents,
            meter: rect(meter), bar: rect(bar), controls: ids.map(id => ({ id, ...rect(document.getElementById(id)) })) };
        });
        measurements.push({ width, skin, name, ...s });
        fs.writeFileSync(path.join(out, 'measurements.json'), JSON.stringify(measurements, null, 2));
        await p.screenshot({ path: path.join(out, `${skin}-${width}-${name}.png`) });
        if (s.voice === 'listen') {
          assert.equal(s.display, 'flex'); assert.equal(s.pointerEvents, 'none');
          assert.ok(s.meter.x >= 0 && s.meter.y >= 0 && s.meter.x + s.meter.width <= width && s.meter.y + s.meter.height <= 892, 'meter on screen');
          for (const r of s.controls) {
            const overlap = Math.min(r.x + r.width, s.meter.x + s.meter.width) > Math.max(r.x, s.meter.x)
              && Math.min(r.y + r.height, s.meter.y + s.meter.height) > Math.max(r.y, s.meter.y);
            assert.equal(overlap, false, 'meter clear of ' + r.id);
          }
        }
        return s;
      }
      await measure('entering-silence');
      // Check every entrance frame, not only the final dock layout: buttons must not cross the meter.
      const entranceOverlaps = await p.evaluate(() => new Promise(resolve => {
        const until = performance.now() + 650, overlaps = [];
        function frame() {
          const m = document.getElementById('voiceMeter').getBoundingClientRect();
          for (const id of ['arcCancel', 'arcPause', 'arcScreen', 'arcAttach']) {
            const r = document.getElementById(id).getBoundingClientRect();
            if (Math.min(r.right, m.right) > Math.max(r.left, m.left)
              && Math.min(r.bottom, m.bottom) > Math.max(r.top, m.top)) overlaps.push(id);
          }
          if (performance.now() < until) requestAnimationFrame(frame); else resolve(overlaps);
        }
        frame();
      }));
      assert.deepEqual(entranceOverlaps, [], 'voice controls never sweep over the live meter');
      const quiet = await measure('silent');
      await p.evaluate(() => window.__qaMicAmplitude = 24);
      await p.waitForFunction(() => +document.querySelector('#voiceMeter').style.getPropertyValue('--voice-meter-level') > .7);
      await p.waitForFunction(height => document.querySelector('#voiceMeter').children[3].getBoundingClientRect().height > height * 2, quiet.bar.height);
      const loud = await measure('speech');
      assert.ok(loud.bar.height > quiet.bar.height * 2, 'bars visibly grow with speech');
      await p.click('#arcPause'); await p.waitForFunction(() => __wos.voice === 'paused');
      assert.equal(await p.locator('#voiceMeter').isVisible(), false, 'pause hides bars');
      assert.equal(await p.locator('#voiceMeter').evaluate(e => +e.style.getPropertyValue('--voice-meter-level')), 0);
      await measure('paused');
      await p.click('#arcPause'); await p.waitForFunction(() => __wos.voice === 'listen');
      await p.waitForFunction(() => +document.querySelector('#voiceMeter').style.getPropertyValue('--voice-meter-level') > .7);
      await measure('resumed');
      const chatsDesk = await p.evaluate(() => __wos.desks.findIndex(d => d.wins.some(id => __wos.wins[id].app === 'chats')));
      assert.ok(chatsDesk > 0, 'fixture has a Chats desk');
      await p.evaluate(i => {
        __wos.goDesk(i, true);
        __wos.setFull(__wos.desks[i].wins.find(id => __wos.wins[id].app === 'chats'), true);
      }, chatsDesk);
      await p.waitForFunction(() => document.getElementById('device').classList.contains('orb-corner'));
      await p.waitForTimeout(650);
      await measure('corner-speech');
      await p.evaluate(() => window.__qaMicAmplitude = 0);
      await p.waitForFunction(() => +document.querySelector('#voiceMeter').style.getPropertyValue('--voice-meter-level') === 0);
      await p.waitForTimeout(130); await measure('corner-silent');
      assert.deepEqual(sends, [], 'recording/pause/navigation must not send audio');
      assert.deepEqual(errors, [], 'no page errors');
      console.log(`PASS ${skin} ${width}px: idle, silence, speech, pause, resume, corner; no sends or overlaps`);
      await context.close();
    }
    fs.writeFileSync(path.join(out, 'measurements.json'), JSON.stringify(measurements, null, 2));
    console.log('PASS voice bars browser regression: 4 phone/skin cases');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
