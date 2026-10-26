/* Prepare the shell before mounting an opted-in pinned app. No reload or app data access. */
(() => {
  'use strict';
  const policy = window.WizHomeScreenPolicy, app = window.WizOfflineApps?.apps[policy?.id];
  if (!policy?.mode || !app?.offline || !navigator.serviceWorker) return;
  async function prepare() {
    const reg = await navigator.serviceWorker.register('/wizard-os-home/sw.js', { scope: '/wizard-os-home/', updateViaCache: 'none' });
    const worker = reg.installing || reg.waiting || reg.active;
    if (!worker) throw Error('Offline shell unavailable');
    if (worker.state !== 'activated') await new Promise((resolve, reject) => {
      const changed = () => {
        if (worker.state === 'activated') { worker.removeEventListener('statechange', changed); resolve(); }
        else if (worker.state === 'redundant') { worker.removeEventListener('statechange', changed); reject(Error('Offline shell unavailable')); }
      };
      worker.addEventListener('statechange', changed); changed();
    });
    return true;
  }
  let timer;
  window.WizOfflineSession = Object.freeze({ ready: Promise.race([
    prepare(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Offline shell timed out')), 15000); })
  ]).catch(() => false).finally(() => clearTimeout(timer)) });
})();
