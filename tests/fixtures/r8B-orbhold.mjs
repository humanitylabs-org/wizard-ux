// The phone dock orb's real press handling (web/app-orbswipe.js) wired to the real pre-warmed microphone
// (web/app-mic.js warmMic / takeWarm-in-openRec / dropWarm), both parts run as the phone shell calls them, on a mini-dom
// orb with a fake clock. getUserMedia is fake: each call is logged ('gum:N') and its stream's tracks log 'stop:N'.
// The shell's startOrbVoice is the synchronous path a tap takes to openRec (startVoice has no await before it when
// nothing holds the mic; startVoice('command') from a hold likewise), so a test sees whether a tap's take claims the warm stream before the press drops it.
import { createDocument } from './mini-dom.mjs';
import { partScope, runPartRecording } from './r5A-parts.mjs';

// switcher: the window.WosOrbSwitcher the press sees (default: none active); corner: the full-screen Chats corner orb;
// give: more names for the orbswipe part (APP, openApp, execute...).
export async function orbHold({ granted = true, native = false, orbTap = false, switcher = null, corner = false, give = {} } = {}) {
  const log = [], timers = [], created = []; let now = 0, n = 0;
  const setTimeout = (fn, ms) => { timers.push({ at: now + ms, fn }); return timers.length; };
  const clearTimeout = id => { if (timers[id - 1]) timers[id - 1].fn = null; };
  const advance = async ms => { const end = now + ms; for (;;) { const t = timers.filter(x => x.fn && x.at <= end).sort((a, b) => a.at - b.at)[0]; if (!t) break; now = t.at; const f = t.fn; t.fn = null; f(); } now = end; await settle(); };
  const settle = () => new Promise(r => setImmediate(r));
  const getUserMedia = () => { const id = ++n; log.push('gum:' + id); return Promise.resolve({ id, getTracks: () => [{ stop() { log.push('stop:' + id); } }], getAudioTracks: () => [] }); };
  const doc = createDocument();
  const scope = { document: doc, performance: { now: () => now }, setTimeout, clearTimeout, queueMicrotask,
    navigator: { userAgent: 'iPhone', mediaDevices: { getUserMedia }, permissions: { query: async () => ({ state: granted ? 'granted' : 'prompt' }) } },
    MediaRecorder: Object.assign(function () { return { start() {}, stop() {}, mimeType: 'audio/webm' }; }, { isTypeSupported: () => true }),
    AudioContext: function () { return { createMediaStreamSource: () => ({ connect() {} }), createAnalyser: () => ({}), close() {} }; },
    crypto: { randomUUID: () => 'u1' }, WosOrbSwitcher: switcher || { active: () => false }, WosCreateOrbSwitcher: host => { created.push(host); return switcher || {}; }, ...(orbTap ? { WosSkinHost: { orbTap: () => true } } : {}) };
  const V = { state: 'idle', captureEpoch: 1, chunks: [], parts: [] };
  const DEV = () => (native ? {} : null);
  const mic = await runPartRecording('app-mic.js', 'appParts', 'mic', { $: () => doc.createElement('div'), V, DEV, device: doc.createElement('div') }, partScope(scope));
  await settle(); // the permission answer
  const M = mic.out;
  const orbWrap = doc.createElement('div'); orbWrap.setPointerCapture = () => {}; orbWrap.hasPointerCapture = () => true; doc.body.append(orbWrap);
  const device = doc.createElement('div'); doc.body.append(device); if (corner) device.classList.add('orb-corner');
  const appVars = { G: null, sheet: null, idx: 0, desks: [{}], ovEl: null };
  const takes = [];
  const named = { appVars, orbWrap, device, V, $: () => doc.createElement('div'), generalTarget: doc.createElement('div'), MIC_WARM_MS: M.MIC_WARM_MS,
    warmMic: M.warmMic, dropWarm: M.dropWarm, mayHoldCommand: () => true, orbUpDesks: () => false, pillOvOpen: () => false,
    startOrbVoice: () => { takes.push('tap'); V.state = 'listen'; return M.openRec(V.captureEpoch); },
    startVoice: kind => { takes.push(kind); V.state = kind === 'command' ? 'command' : 'listen'; return M.openRec(V.captureEpoch); }, ...give };
  const orb = await runPartRecording('app-orbswipe.js', 'appParts', 'orbswipe', named, partScope({ ...scope, document: doc }));
  const ev = (type, more = {}) => orbWrap.dispatchEvent({ type, pointerId: 1, isPrimary: true, clientX: 100, clientY: 500, timeStamp: now, preventDefault() {}, stopPropagation() {}, ...more });
  return { log, takes, V, appVars, mic: M, calls: orb.calls, created, orbWrap, advance, settle, now: () => now,
    down: () => ev('pointerdown'), up: () => ev('pointerup'), cancel: () => ev('pointercancel'), move: dy => ev('pointermove', { clientY: 500 + dy }) };
}
