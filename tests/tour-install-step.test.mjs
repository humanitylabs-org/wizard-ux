// Install beat (Miguel, 26 Oct 2026): adding Wizard to the Home Screen moved out of the chat handoff text and into
// onboarding. The phone tour gets one last optional beat, only where installing can work and Wizard isn't installed:
// Android Chrome uses the browser's real prompt (shared with pwa-install.js, never the banner at the same time),
// iPhone Safari gets "Share, then Add to Home Screen", an app's in-app browser gets "open this link in Safari/Chrome".
// Runs the real tour.js and pwa-install.js together in node:vm against a tiny DOM stand-in.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const TOUR = readFileSync(new URL('../web/core/tour.js', import.meta.url), 'utf8');
const PWA = readFileSync(new URL('../web/pwa-install.js', import.meta.url), 'utf8');

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  iphoneWebView: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  iphoneInstagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 390.0.0.0 (iPhone16,2; iOS 18_6; en_US)',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1',
  iphoneFirefox: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/143.0 Mobile/15E148 Safari/605.1.15',
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
  androidChrome: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  androidTelegram: 'Mozilla/5.0 (Linux; Android 15; Pixel 9; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36 Telegram-Android/12.1.1',
  desktopChrome: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
};

function mk() {
  const kids = new Map(), set = new Set();
  return {
    dataset: {}, style: { setProperty(k, v) { this[k] = v; } }, innerHTML: '', textContent: '', hidden: false, offsetWidth: 1, _l: {},
    classList: { add: (...c) => c.forEach(x => set.add(x)), remove: (...c) => c.forEach(x => set.delete(x)), contains: c => set.has(c),
      toggle: (c, on) => { if (on === undefined) on = !set.has(c); if (on) set.add(c); else set.delete(c); return on; } },
    setAttribute() {}, appendChild: c => c, remove() { this.removed = true; }, focus() {}, blur() {},
    addEventListener(t, f) { (this._l[t] ||= []).push(f); },
    attachShadow() { return this; },
    querySelector(s) { if (!kids.has(s)) kids.set(s, mk()); return kids.get(s); },
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 60, height: 60 }),
  };
}

function boot({ ua = UA.iphoneSafari, standalone = false, display = '', touch = 5, native = false } = {}) {
  let timers = [];
  const store = new Map(), calls = [], created = [], banners = [], listeners = {};
  const body = mk(); body.prepend = el => banners.push(el);
  const document = {
    body, createElement: () => { const e = mk(); created.push(e); return e; }, querySelector: () => null, addEventListener() {},
    currentScript: { dataset: { pwaName: 'Wizard OS', pwaOrigin: '' }, src: 'https://box.example.ts.net/wizard-os-home/pwa-install.js' },
  };
  const ctx = {
    document, console: { warn() {}, log() {} }, Date,
    navigator: { userAgent: ua, standalone, maxTouchPoints: touch },
    location: { origin: 'https://box.example.ts.net', pathname: '/wizard-os-home/' },
    matchMedia: q => ({ matches: !!display && q === `(display-mode: ${display})` }),
    getComputedStyle: () => ({ paddingTop: '64px', paddingBottom: '16px' }),
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
    requestAnimationFrame: fn => fn(),
    addEventListener: (t, f) => { (listeners[t] ||= []).push(f); },
    URL,
  };
  if (native) ctx.WizardNative = {};
  ctx.window = ctx; ctx.self = ctx; ctx.top = ctx;
  vm.createContext(ctx);
  vm.runInContext(PWA, ctx, { filename: 'pwa-install.js' });
  vm.runInContext(TOUR, ctx, { filename: 'tour.js' });
  const T = ctx.WosTour;
  const H = {
    device: mk(), orbWrap: mk(), noMic: () => false, cmdExample: () => 'Open Calendar',
    goHome: () => calls.push('home'), prepare: () => calls.push('prepare'), toast: (...a) => calls.push('toast:' + a[1]), vib() {},
    closeSheets: () => calls.push('closeSheets'), setZen: on => { calls.push('zen:' + on); T.event('zen', { on }); },
    dismissVoice: () => calls.push('dismissVoice'), say: (t, k) => calls.push(`say:${k}:${t}`),
  };
  T.attach(H);
  const tour = () => created.filter(e => e._l.click && /tr-copy/.test(e.innerHTML)).at(-1);
  const q = s => tour().querySelector('.tr-copy').querySelector(s);
  const tap = sel => tour()._l.click.forEach(f => f({ target: { closest: s => (s === sel ? {} : null) } }));
  const runTimers = () => { const t = timers; timers = []; t.forEach(x => x.fn()); };
  const view = () => ({ step: T.step, active: T.active, sub: q('small').textContent, copy: q('b').textContent, next: q('.tr-nx').innerHTML, alt: q('.tr-alt').innerHTML });
  const fire = (t, ev = {}) => (listeners[t] || []).forEach(f => f(ev));
  // A Chrome-style beforeinstallprompt: prompt() must be called inside the tap; userChoice settles later.
  function promptEvent(outcome = 'accepted') {
    let settle; const ev = { prompts: 0, preventDefault() { this.prevented = true; },
      prompt() { this.prompts++; return Promise.resolve(); }, userChoice: new Promise(r => { settle = r; }) };
    ev.choose = () => settle({ outcome });
    return ev;
  }
  const shown = () => banners.filter(b => !b.removed);
  const toInstall = () => { T.start('qa'); tap('[data-tnext]'); tap('[data-tnext]'); };
  return { T, ctx, calls, store, tour, q, tap, runTimers, view, fire, promptEvent, shown, toInstall };
}

const flush = () => new Promise(r => setImmediate(r));

test('installOffer: only where adding to the Home Screen can work, and never when installed or in a Wizard app', () => {
  const cases = [
    [{ ua: UA.iphoneSafari }, 'ios'],
    [{ ua: UA.ipad }, 'ios'],
    [{ ua: UA.iphoneWebView }, 'inapp:Safari'],
    [{ ua: UA.iphoneInstagram }, 'inapp:Safari'],
    [{ ua: UA.androidTelegram }, 'inapp:Chrome'],
    [{ ua: UA.iphoneSafari, standalone: true }, null],
    [{ ua: UA.iphoneWebView, standalone: true }, null],
    [{ ua: UA.androidChrome, display: 'standalone' }, null],
    [{ ua: UA.androidTelegram, native: true }, null],
    [{ ua: UA.iphoneChrome }, null],
    [{ ua: UA.iphoneFirefox }, null],
    [{ ua: UA.androidChrome }, null], // no install prompt from the browser: nothing to offer
    [{ ua: UA.desktopChrome, touch: 0 }, null],
  ];
  for (const [opt, want] of cases) {
    const o = boot(opt).T.installOffer();
    assert.equal(o ? o.kind + (o.browser ? ':' + o.browser : '') : null, want, JSON.stringify(opt));
  }
});

test('iPhone Safari: last beat says Share, then Add to Home Screen; Done or Skip this step reaches the end card', () => {
  for (const how of ['[data-tidone]', '[data-tnext]']) {
    const t = boot();
    t.T.start('qa');
    assert.equal(t.view().sub, '1 of 3 · Talk');
    t.tap('[data-tnext]'); t.tap('[data-tnext]');
    const v = t.view();
    assert.equal(v.step, t.T.INSTALL); assert.equal(v.sub, '3 of 3 · Install');
    assert.equal(v.copy, 'Add Wizard to your Home Screen.');
    assert.match(v.alt, /class="tr-share"[\s\S]*Share, then Add to Home Screen\./);
    assert.match(v.alt, /data-tidone>Done</); assert.match(v.next, /Skip this step/);
    t.tap(how);
    assert.equal(t.T.step, t.T.DONE); assert.ok(t.T.active, 'end card still shows; a tap there finishes');
    assert.equal(t.store.get('wos.tour.v1'), undefined);
  }
});

test('in-app browsers are told to open the link in Safari (iPhone) or Chrome (Android) instead', () => {
  for (const [ua, browser] of [[UA.iphoneWebView, 'Safari'], [UA.iphoneInstagram, 'Safari'], [UA.androidTelegram, 'Chrome']]) {
    const t = boot({ ua });
    t.toInstall();
    assert.equal(t.T.step, t.T.INSTALL);
    assert.match(t.view().alt, new RegExp(`Open this link in ${browser} to install it\\.`));
    assert.doesNotMatch(t.view().alt, /Add to Home Screen|data-tinstall/);
  }
});

test('installed (standalone) or unsupported browsers have no install beat: Hide goes straight to the end card, "of 2"', () => {
  for (const opt of [{ standalone: true }, { ua: UA.androidChrome, display: 'standalone' }, { ua: UA.iphoneFirefox }, { ua: UA.androidChrome }]) {
    const t = boot(opt);
    t.T.start('qa');
    assert.equal(t.view().sub, '1 of 2 · Talk', JSON.stringify(opt));
    t.tap('[data-tnext]'); assert.equal(t.view().sub, '2 of 2 · Hide');
    t.T.event('zen', { on: true }); t.T.event('zen', { on: false }); t.runTimers();
    assert.equal(t.T.step, t.T.DONE, JSON.stringify(opt));
  }
});

test('Android Chrome: the beat\'s Install button opens the real prompt once, and the top banner never shows during the tour', async () => {
  const t = boot({ ua: UA.androidChrome });
  t.T.start('qa');
  const ev = t.promptEvent('accepted');
  t.fire('beforeinstallprompt', ev);
  assert.ok(ev.prevented);
  assert.equal(t.shown().length, 0, 'banner held while the tour runs');
  t.tap('[data-tnext]'); t.tap('[data-tnext]');
  assert.equal(t.T.step, t.T.INSTALL); assert.equal(t.view().sub, '3 of 3 · Install');
  assert.match(t.view().alt, /data-tinstall>Install</);
  t.tap('[data-tinstall]');
  assert.equal(ev.prompts, 1, 'prompt() runs inside the tap');
  t.tap('[data-tinstall]');
  assert.equal(ev.prompts, 1, 'a second tap never re-uses the consumed prompt');
  ev.choose(); await flush(); await flush();
  assert.equal(t.T.step, t.T.DONE);
  assert.equal(t.ctx.WizardPwaInstall.available, false);
  t.tap('[data-tother]');
  assert.ok(!t.T.active);
  assert.equal(t.shown().length, 0, 'installed: no banner after the tour either');
});

test('Android Chrome: dismissing the prompt or skipping the beat does not bring the banner straight back', async () => {
  const a = boot({ ua: UA.androidChrome });
  a.T.start('qa'); const ev = a.promptEvent('dismissed'); a.fire('beforeinstallprompt', ev);
  a.tap('[data-tnext]'); a.tap('[data-tnext]'); a.tap('[data-tinstall]'); ev.choose(); await flush(); await flush();
  assert.equal(a.T.step, a.T.DONE); a.T.finish('done');
  assert.equal(a.shown().length, 0);

  const b = boot({ ua: UA.androidChrome });
  b.T.start('qa'); const ev2 = b.promptEvent(); b.fire('beforeinstallprompt', ev2);
  b.tap('[data-tnext]'); b.tap('[data-tnext]'); assert.equal(b.T.step, b.T.INSTALL);
  b.tap('[data-tnext]'); assert.equal(b.T.step, b.T.DONE); assert.equal(ev2.prompts, 0);
  b.T.finish('done');
  assert.equal(b.shown().length, 0, 'skipped in the tour: snoozed like the banner\'s ×');
});

test('Skip tour before the install beat leaves the existing banner behaviour exactly as it was', () => {
  const t = boot({ ua: UA.androidChrome });
  t.T.start('qa'); t.fire('beforeinstallprompt', t.promptEvent());
  assert.equal(t.shown().length, 0);
  t.tap('[data-tskip]');
  assert.ok(!t.T.active);
  assert.equal(t.shown().length, 1, 'the browser\'s banner returns once the tour is gone');
});

test('Back from the install beat steps back to Hide; Practice again replays it', () => {
  const t = boot();
  t.toInstall(); assert.equal(t.T.step, t.T.INSTALL);
  assert.equal(t.T.back(), 'tour-step'); assert.equal(t.T.step, 2);
  t.T.finish('skip');
  t.T.start('help'); t.tap('[data-tnext]'); t.tap('[data-tnext]');
  assert.equal(t.T.step, t.T.INSTALL);
});

test('a hold during the install beat is undone and never mentions the orb swipe', () => {
  const t = boot();
  t.toInstall(); t.calls.length = 0;
  t.T.event('command', { ok: true, text: 'Settings' });
  assert.equal(t.T.step, t.T.INSTALL);
  assert.ok(['dismissVoice', 'closeSheets', 'home'].every(c => t.calls.includes(c)));
  assert.doesNotMatch(t.view().copy, /Swipe the orb/);
});

test('a dismissal holds for the tour too: banner × before the tour, or a skipped beat on replay, means no Install beat (Codex P2 on #548)', () => {
  const t = boot({ ua: UA.androidChrome });
  t.fire('beforeinstallprompt', t.promptEvent());
  assert.equal(t.shown().length, 1, 'banner offered before the tour starts');
  t.shown()[0].querySelector('.close')._l.click.forEach(f => f());
  assert.equal(t.ctx.WizardPwaInstall.available, false);
  t.toInstall();
  assert.equal(t.T.step, t.T.DONE, 'dismissed in the banner: the tour does not offer it again');

  const r = boot({ ua: UA.androidChrome });
  r.fire('beforeinstallprompt', r.promptEvent());
  r.toInstall(); assert.equal(r.T.step, r.T.INSTALL);
  r.tap('[data-tnext]'); r.T.finish('done');
  r.T.start('help'); r.tap('[data-tnext]'); r.tap('[data-tnext]');
  assert.equal(r.T.step, r.T.DONE, 'skipped once: Practice again does not offer it for the snooze period');
});

test('Skip tour on the Android install beat also snoozes the banner (Codex P2 on #549)', () => {
  const t = boot({ ua: UA.androidChrome });
  t.fire('beforeinstallprompt', t.promptEvent());
  t.toInstall(); assert.equal(t.T.step, t.T.INSTALL);
  t.tap('[data-tskip]');
  assert.ok(!t.T.active);
  assert.equal(t.shown().length, 0, 'no banner right after saying no to installing');
});
