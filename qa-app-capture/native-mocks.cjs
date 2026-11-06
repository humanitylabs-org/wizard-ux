// Browser-only models of the *existing* native bridge signatures, not native QA.
function installDeviceMock() {
  window.deviceCalls = [];
  const saved = JSON.parse(localStorage.getItem('qa-device') || '{"active":null,"takes":{}}');
  const save = () => localStorage.setItem('qa-device', JSON.stringify(saved));
  window.WizardOSDevice = {
    recActive: () => JSON.stringify(saved.active),
    recStart: kind => { deviceCalls.push('start:' + kind); const id = 'native-' + Date.now(); saved.active = { id, ms: 1250, source: 'app' }; saved.takes[id] = { id, ms: 1250, bytes: 8 }; save(); return id; },
    recLevel: () => 50,
    recPause: on => { saved.active.paused = on; save(); },
    recStop: id => { deviceCalls.push('stop'); saved.active = null; save(); return JSON.stringify(saved.takes[id]); },
    recClaim: id => { deviceCalls.push('claim'); return localStorage.getItem('qa-null-claim') ? 'null' : JSON.stringify(saved.takes[id] || null); },
    recRead: (id, offset) => saved.takes[id] ? JSON.stringify({ b64: btoa('AAC-data'), next: -1 }) : 'null',
    recCancel: id => { deviceCalls.push('cancel'); saved.active = null; delete saved.takes[id]; save(); },
    recDone: id => { deviceCalls.push('done'); delete saved.takes[id]; save(); }
  };
}
function installMeetingMock() {
  window.meetingCalls = [];
  const pcms = new Set(), levels = new Set(), states = new Set(); let current = { recording: false };
  window.emitMeetingState = st => {current={...current,...st};states.forEach(cb=>cb(current));};
  const b = window.wizardNative = { meetings: {
    status: async () => current,
    start: async ({ meetingId }) => { meetingCalls.push('start'); current = { meetingId, recording: true, livePcm: true, mediaMs: 1000 }; return current; },
    stop: async () => { meetingCalls.push('stop'); current = { ...current, recording: false, final_seq: { me: 0 } }; states.forEach(cb => cb(current)); return current; },
    pause: async () => {current={...current,paused:true};states.forEach(cb=>cb(current));return current;}, resume: async () => {current={...current,paused:false};states.forEach(cb=>cb(current));return current;},
    pcm: async (id, enabled) => { meetingCalls.push('pcm:' + enabled); if (enabled) setTimeout(() => { pcms.forEach(cb => cb({ meetingId: id, startMs: 0, pcm: new Uint8Array(8000) })); levels.forEach(cb => cb({ me: .6, them: 0 })); }, 20); },
    onPcm: cb => { pcms.add(cb); return () => pcms.delete(cb); },
    onLevel: cb => { levels.add(cb); return () => levels.delete(cb); },
    onState: cb => { states.add(cb); return () => states.delete(cb); }
  } };
}
module.exports = { installDeviceMock, installMeetingMock };
