'use strict';
// QA-only scheduler instrumentation: do not cancel, reschedule or advance product work.
function installRafProbe(host = window) {
  const request = host.requestAnimationFrame.bind(host), cancel = host.cancelAnimationFrame.bind(host);
  const pending = host.__orbPendingRafs = new Set();
  host.requestAnimationFrame = callback => {
    const id = request(now => { pending.delete(id); callback(now); });
    pending.add(id); return id;
  };
  host.cancelAnimationFrame = id => { pending.delete(id); return cancel(id); };
}

function frozenIdle(host = window, { timeoutMs = 6000, frozenMs = 300, pollMs = 25 } = {}) {
  return new Promise(resolve => {
    const start = host.performance.now(), samples = [];
    let settled = null;
    function poll() {
      const sample = { elapsed: host.performance.now() - start, draws: host.__draws,
        pending: host.__orbPendingRafs.size, mode: host.Orb.mode,
        webgl: host.Orb.webgl, hidden: host.document.hidden };
      samples.push(sample);
      const fail = reason => resolve({ pass: false, error: reason, samples });
      if (sample.mode !== 'idle' || !sample.webgl || sample.hidden) return fail('idle observation lost visible working idle renderer');
      if (settled === null && sample.pending === 0) settled = sample;
      if (settled !== null) {
        // A late draw is a failure, not another chance to reset the observation window.
        if (sample.draws !== settled.draws || sample.pending !== 0) return fail('native idle must stay frozen');
        if (sample.elapsed - settled.elapsed >= frozenMs) return resolve({ pass: true, settled, final: sample, samples });
      }
      if (sample.elapsed >= timeoutMs) return fail('native idle never drained its animation frames');
      host.setTimeout(poll, pollMs);
    }
    poll();
  });
}
module.exports = { installRafProbe, frozenIdle };
