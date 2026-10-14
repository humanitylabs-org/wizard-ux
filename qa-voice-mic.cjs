// QA: desktop voice records from the built-in mic, so Bluetooth headphones stay in music mode (no HFP switch).
// Usage: (setsid node tools/qa-origin.cjs 9381 &) ; node qa-voice-mic.cjs
const { chromium } = require('/home/telos/node_modules/playwright');
const URL_ = process.argv[2] || "http://127.0.0.1:9381/wizard-os-home/?shell=desktop";
let pass = 0, fail = 0;
const ok = (c, n, x = '') => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, x); } };
const DEV = {
  bt: { deviceId: 'bt1', kind: 'audioinput', label: 'WH-1000XM4', groupId: 'g1' },
  bt2: { deviceId: 'bt2', kind: 'audioinput', label: 'Bluetooth Headset (bluez_input.A4_77)', groupId: 'g2' },
  linux: { deviceId: 'int1', kind: 'audioinput', label: 'Meteor Lake-P HD Audio Controller Digital Microphone', groupId: 'g3' },
  analog: { deviceId: 'int2', kind: 'audioinput', label: 'Built-in Audio Analog Stereo', groupId: 'g4' },
  mac: { deviceId: 'int3', kind: 'audioinput', label: 'MacBook Pro Microphone (Built-in)', groupId: 'g5' },
  usb: { deviceId: 'usb1', kind: 'audioinput', label: 'Blue Yeti USB Microphone', groupId: 'g6' },
  def: { deviceId: 'default', kind: 'audioinput', label: 'Default', groupId: 'g0' },
};
const CASES = [
  ['Linux laptop + Bluetooth headphones → built-in digital mic', ['def', 'bt', 'linux'], 'int1'],
  ['Analog built-in + bluez headset → built-in', ['def', 'bt2', 'analog'], 'int2'],
  ['MacBook + AirPods-style headset → MacBook mic', ['def', 'bt', 'mac'], 'int3'],
  ['USB mic plugged in → system default (user choice wins)', ['def', 'bt', 'linux', 'usb'], null],
  ['Only a Bluetooth mic → system default', ['def', 'bt'], null],
  ['No labels yet (first permission) → system default', ['def', 'bt', 'linux'], null, true],
];
(async () => {
  const b = await chromium.launch({ args: ['--host-resolver-rules=MAP wizard.qa 127.0.0.1:18460', '--unsafely-treat-insecure-origin-as-secure=http://wizard.qa', '--use-fake-ui-for-media-stream'] });
  for (const [name, list, want, hideLabels] of CASES) {
    const ctx = await b.newContext({ viewport: { width: 1400, height: 860 } });
    await ctx.route('**/*', (r) => { const q = r.request(); if (q.method() !== 'GET' && /\/wizard\/(hermes|thread-seen|v1\/runs)/.test(q.url())) return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); return r.continue(); });
    await ctx.addInitScript(([devs, hide]) => {
      window.__gum = [];
      const md = navigator.mediaDevices;
      md.enumerateDevices = async () => devs.map(d => ({ ...d, label: hide ? '' : d.label, toJSON() { return this; } }));
      md.getUserMedia = async (c) => {
        window.__gum.push(JSON.parse(JSON.stringify(c)));
        const ac = new AudioContext(); const o = ac.createOscillator(); const dst = ac.createMediaStreamDestination(); o.connect(dst); o.start(); return dst.stream;
      };
      try { localStorage.setItem('wos.coached', 'true'); } catch (e) {}
    }, [list.map(k => DEV[k]), !!hideLabels]);
    const p = await ctx.newPage();
    await p.goto(URL_, { waitUntil: 'load' });
    await p.waitForFunction(() => window.WizCore?.voice, null, { timeout: 20000 });
    const got = await p.evaluate(async () => { const v = WizCore.voice(); await v.start(); v.cancel(); return window.__gum; });
    const id = got[0]?.audio?.deviceId?.exact ?? null;
    ok(got.length === 1 && id === want && got[0].audio.echoCancellation === true, name, JSON.stringify(got));
    await ctx.close();
  }
  // A vanished built-in mic (OverconstrainedError) falls back to the default, still recording.
  const ctx = await b.newContext();
  await ctx.addInitScript((devs) => {
    window.__gum = []; const md = navigator.mediaDevices;
    md.enumerateDevices = async () => devs;
    md.getUserMedia = async (c) => { window.__gum.push(JSON.parse(JSON.stringify(c))); if (c.audio.deviceId) throw Object.assign(new Error('gone'), { name: 'OverconstrainedError' });
      const ac = new AudioContext(); const dst = ac.createMediaStreamDestination(); ac.createOscillator().connect(dst); return dst.stream; };
  }, [DEV.def, DEV.bt, DEV.linux]);
  const p = await ctx.newPage(); await p.goto(URL_, { waitUntil: 'load' }); await p.waitForFunction(() => window.WizCore?.voice, null, { timeout: 20000 });
  const r = await p.evaluate(async () => { const v = WizCore.voice(); const s = await v.start(); const st = v.state; v.cancel(); return { s, st, gum: window.__gum }; });
  ok(r.s === true && r.st === 'listen' && r.gum.length === 2 && !r.gum[1].audio.deviceId, 'built-in mic gone → falls back to default and records', JSON.stringify(r));
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
