/* Failure-only connectivity diagnosis, independent of Agent Service/Hermes.
 * No healthy polling: consumers call failure() only while a read/send is failing.
 */
(() => {
  'use strict';
  const order = ['gateway', 'signin', 'shell', 'agent-service', 'hermes'];
  const result = (layer, message, short) => ({ layer, message, short, action: 'troubleshoot' });
  const pending = result('checking', 'Checking the connection to Wizard. Messages are kept on this device while we retry.', 'Checking connection · retrying');
  let cached = null, cachedAt = 0, work = null, failureAt = -Infinity;
  async function request(url, options = {}, json = false) {
    const controller = new AbortController(); let timer;
    try {
      return await Promise.race([
        (async () => { const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin', ...options, signal: controller.signal }); return json ? { response, body: await response.json() } : response; })(),
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Diagnosis timed out')); }, 4000); }),
      ]);
    } finally { clearTimeout(timer); }
  }
  async function probe() {
    let ping;
    try { ping = await request('/troubleshoot/api/ping'); }
    catch (_) {
      if (navigator.onLine === false) return result('device-offline', 'Your device is offline. Messages are saved and will send when you reconnect.', 'Device offline · retrying');
      try { await request('https://www.gstatic.com/generate_204', { mode: 'no-cors', credentials: 'omit' }); }
      catch (_) { return result('internet', 'No internet connection. Messages are saved and will send when you’re back online.', 'No internet · retrying'); }
      return result('tailscale', 'Can’t reach your Wizard server. Open the Tailscale app on this device and make sure it’s connected. Messages are saved and will send when it’s back.', 'Check Tailscale · retrying');
    }
    // An HTTP error proves the server is reachable; never blame the device/VPN.
    if (!ping.ok) return result('gateway', `Wizard’s gateway answered (${ping.status}), but Troubleshooter isn’t available. Messages are kept while we retry.`, 'Gateway needs attention · retrying');
    try {
      const { response, body } = await request('/troubleshoot/api/status', {}, true);
      if (!response.ok || !Array.isArray(body.checks)) throw new Error('Invalid status');
      const failed = body.checks.filter(check => !check.ok).sort((a, b) => {
        const rank = id => order.includes(id) ? order.indexOf(id) : order.length;
        return rank(a.id) - rank(b.id);
      })[0];
      if (failed) {
        const labels = { gateway: 'Wizard’s gateway isn’t responding.', signin: 'Wizard sign-in needs attention.', shell: 'Wizard’s shell isn’t responding.', 'agent-service': 'Wizard’s Agent Service isn’t responding.', hermes: 'Your agent (Hermes) isn’t responding.' };
        const message = labels[failed.id];
        return result(failed.id, message ? message + (['agent-service', 'hermes'].includes(failed.id) ? ' It restarts itself automatically; open Troubleshooter if it doesn’t come back.' : ' Open Troubleshooter to check it.') : `${failed.label || failed.id}: ${failed.detail || 'Needs attention'}`, `${failed.label || failed.id} needs attention · retrying`);
      }
      if (body.overall && body.overall !== 'ok') return result('wizard', body.summary || 'Wizard reports a problem. Open Troubleshooter to check it.', 'Wizard needs attention · retrying');
    } catch (_) { return result('diagnosis', 'Wizard’s gateway is reachable, but its health report isn’t available. Open Troubleshooter to check it. Messages are kept while we retry.', 'Health report unavailable · retrying'); }
    return result('send', 'Wizard is reachable but didn’t take the message. Retrying.', 'Wizard reachable · retrying');
  }
  function diagnose() {
    if (work) return work;
    if (cached && Date.now() - cachedAt < 10000) return Promise.resolve(cached);
    work = probe().then(value => {
      const changed = JSON.stringify(value) !== JSON.stringify(cached);
      cached = value; cachedAt = Date.now();
      if (changed) window.dispatchEvent(new Event('wizreachchange'));
      return value;
    }).finally(() => { work = null; });
    return work;
  }
  window.WizReach = {
    diagnose,
    failure() {
      if (Date.now() - failureAt >= 15000) { failureAt = Date.now(); diagnose(); }
      return cached || pending;
    },
    // Troubleshooter is an ordinary built-in app: open it in a shell window like any other app. Leaving the shell
    // for the bare page is only the last resort, when the shell can't open windows at all.
    open() {
      try { if (window.WizOpenApp?.('troubleshooter')) return; } catch (e) {}
      if (document.documentElement.dataset.shell === 'desktop') window.open('/troubleshoot/', '_blank', 'noopener');
      else location.assign('/troubleshoot/');
    },
  };
})();
