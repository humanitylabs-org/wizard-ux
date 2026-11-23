// ux#1542 / ux#1479: while the Mac app restarts for an approved update it sets window.__wizardUpdateFrozen
// (try-wizard main.swift setUpdateFrozen). No recorder may start then: the restart would cut the take off. Every
// recorder refuses at its entry, and checks again right before it starts, because the freeze can land while the
// microphone, the store or the lock is still being awaited. Whatever it already opened is released.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const voiceSrc = readFileSync(new URL('../web/core/voice.js', import.meta.url), 'utf8');
const capture = readFileSync(new URL('../web/core/app-capture.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const desktop = readFileSync(new URL('../web/desktop/desktop.js', import.meta.url), 'utf8');
const MSG = 'Wizard is preparing an update; recording is paused';
const busy = e => e.code === 'update_busy' && e.message === MSG;

function slice(from, to, ctx) {
  const a = capture.indexOf(from), b = capture.indexOf(to, a);
  assert.ok(a >= 0 && b > a, from);
  vm.createContext(ctx); vm.runInContext(capture.slice(a, b), ctx); return ctx;
}

// Desktop voice (core/voice.js), with a microphone whose answer the test controls.
function desktopVoice() {
  const window = {}, calls = { mic: 0, recorders: 0, stopped: 0 };
  let grant;
  const track = { stop() { calls.stopped++; }, getSettings: () => ({ channelCount: 1 }) };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  window.MediaRecorder = class { constructor() { calls.recorders++; } start() {} static isTypeSupported() { return true; } };
  const ctx = { window, crypto: { randomUUID: () => 'synthetic' }, performance: { now: () => 0 }, requestAnimationFrame() {}, cancelAnimationFrame() {},
    setTimeout, setInterval, clearInterval, Promise, Float32Array, Math, MediaRecorder: window.MediaRecorder,
    navigator: { userAgent: 'test', mediaDevices: { enumerateDevices: async () => [], getUserMedia: () => { calls.mic++; return new Promise(r => { grant = () => r(stream); }); } } } };
  window.AudioContext = class { createMediaStreamSource() { return { connect() {} }; } createAnalyser() { return { connect() {} }; } close() {} };
  vm.runInNewContext(voiceSrc, ctx);
  const v = window.WizCore.voice({});
  return { window, v, calls, grant: () => grant() };
}

test('desktop voice refuses to start while the update freeze is set, before opening the microphone', async () => {
  const f = desktopVoice(); f.window.__wizardUpdateFrozen = true;
  await assert.rejects(f.v.start(), busy);
  assert.equal(f.calls.mic, 0); assert.equal(f.v.state, 'idle');
});

test('desktop voice: a freeze that lands while the microphone opens stops the take and releases the mic', async () => {
  const f = desktopVoice();
  const pending = f.v.start();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(f.calls.mic, 1);
  f.window.__wizardUpdateFrozen = true; f.grant();
  await assert.rejects(pending, busy);
  assert.equal(f.calls.recorders, 0, 'no MediaRecorder is started');
  assert.equal(f.calls.stopped, 1, 'the opened microphone is released');
  assert.equal(f.v.state, 'idle');
});

test('desktop voice still records when no freeze is set', async () => {
  const f = desktopVoice();
  const pending = f.v.start(); await new Promise(r => setTimeout(r, 0)); f.grant();
  assert.equal(await pending, true); assert.equal(f.calls.recorders, 1);
});

test('app capture start refuses while the update freeze is set', async () => {
  let ran = 0;
  const ctx = { validate: () => ({}), preparations: new Map(), active: null, crypto: { randomUUID: () => 'synthetic' }, observe() {}, yieldRecovery() {}, changed() {},
    setTimeout, clearTimeout, START_BOUND_MS: 10000, PROMPT_BOUND_MS: 60000, DEFAULT_LIMIT: 1024, micPromptOpen: async () => false,
    startRun: async () => { ran++; }, W: {}, fail: (code, message, extra) => Object.assign(Error(message), { code }, extra) };
  slice('  async function start(appId, opts = {}) {', '  async function startRun(', ctx);
  ctx.__wizardUpdateFrozen = true;
  await assert.rejects(ctx.start('messenger', {}), busy);
  assert.equal(ran, 0); assert.equal(ctx.active, null);
});

function browser() {
  let grant; const calls = { stopped: 0, recorders: 0 };
  const track = { stop() { calls.stopped++; }, addEventListener() {} };
  const ctx = { W: { MediaRecorder: class { constructor() { calls.recorders++; } } }, ownedRows: new Map(), recoveryLive: new Set(), unknownMeetingActive: false,
    navigator: { mediaDevices: { getUserMedia: () => new Promise(r => { grant = () => r({ getTracks: () => [track], getAudioTracks: () => [track] }); }) } },
    fail: (code, message) => Object.assign(Error(message), { code }), externalMic: async () => false };
  slice('  async function browserEngine(s) {', '  function beginVoiceBorrow(', ctx);
  return { ctx, calls, grant: () => grant() };
}

test('app capture (browser mic): a freeze that lands during the permission prompt stops before a recorder exists', async () => {
  const f = browser(); const s = { opts: {}, timedOut: false, row: {} };
  const pending = f.ctx.browserEngine(s);
  f.ctx.__wizardUpdateFrozen = true; f.grant();
  await assert.rejects(pending, busy);
  assert.equal(f.calls.stopped, 1); assert.equal(s.stream, null); assert.equal(s.engine, undefined); assert.equal(f.calls.recorders, 0);
});

for (const [label, freezeOn] of [['the take is saved', 1], ['the native reservation is saved (last await)', 2]])
test('app capture (native recorder): a freeze that lands while ' + label + ' never starts the native recorder', async () => {
  let nativeStarts = 0, released = 0, puts = 0; const removed = [];
  const ctx = { W: {}, ready: Promise.resolve(), acquire: async () => () => {}, softStore: async (s, work) => work(), recoverLocked: async () => {}, recoveryError: null,
    rows: async () => [], ownedRows: new Map(), recoveryLive: new Set(), navigator: {}, capabilities: () => ({}),
    adapter: () => ({ name: 'configured', start: async () => { nativeStarts++; return { nativeId: 'n' }; } }),
    put: async () => { if (++puts === freezeOn) ctx.__wizardUpdateFrozen = true; }, remove: async id => { removed.push(id); },
    cleanup() {}, release() { released++; }, fail: (code, message, extra) => Object.assign(Error(message), { code }, extra) };
  slice('  async function startRun(', '  // Recover only this app', ctx);
  const s = { row: { id: 'synthetic', appId: 'recorder' }, opts: {}, offs: [], readyResolve() {} };
  await assert.rejects(ctx.startRun(s, 'recorder', { kind: 'camera' }, {}, null), busy);
  assert.equal(nativeStarts, 0); assert.deepEqual(removed, ['synthetic']); assert.equal(released, 1);
});

test('the orb refuses first, and the desktop toast says recording is paused (not "Microphone unavailable")', async () => {
  // the phone orb (real startVoice): frozen, it refuses before touching anything else
  const at = app.indexOf('  async function startVoice(kind, opt = {}) {');
  const body = app.slice(at, app.indexOf('\n', app.indexOf('if (window.__wizardUpdateFrozen)', at)) + 1) + '  }';
  // (the slice runs from the top of startVoice: anything before the freeze check would run here and fail on its names)
  const calls = [];
  const start = vm.runInNewContext(`(() => { ${body}\n return startVoice; })()`, { window: { __wizardUpdateFrozen: true }, toast: (...a) => calls.push(a) });
  assert.equal(await start('tap'), 'busy');
  assert.deepEqual(calls, [['…', MSG, 2200]]);
  // every desktop take start (real desktop.js lines): an update_busy refusal says so, anything else is the microphone
  const lines = desktop.split('\n').filter(l => l.includes('try { await VOICE.start(); } catch (e) {'));
  for (const line of lines) {
    const said = [];
    const run = err => vm.runInNewContext(`(async () => { ${line.trim()}\n return 'started'; })()`, { VOICE: { start: async () => { throw err; } }, toast: (...a) => said.push(a[1]), vReply: null, vMode: '' });
    assert.equal(await run(Object.assign(new Error(MSG), { code: 'update_busy' })), 'none');
    await run(new Error('NotAllowedError'));
    assert.deepEqual(said, [MSG, 'Microphone unavailable: NotAllowedError'], line.trim().slice(0, 60));
  }
});
