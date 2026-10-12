/* Staging only: open representative real apps and land directly on the overview being judged.
 * Remove this script and its index.html tag before promotion. Never changes the production origin. */
(async () => {
  if (!location.hostname.endsWith('.staging.wizard001.com')) return;
  await new Promise(resolve => window.addEventListener('load', resolve, { once: true }));
  for (let n = 0; n < 60 && !window.__wos; n++) await new Promise(r => setTimeout(r, 100));
  if (!window.__wos) return;
  await Promise.resolve(window.WizCore.appsLoaded?.());
  if (!localStorage.getItem('wos.previewOverview.v1')) {
    for (const id of ['wizard-music', 'calendar', 'wisdom']) {
      window.WizCore.deeplink.route(location.pathname + '?open=' + id);
      await new Promise(r => setTimeout(r, 400));
    }
    localStorage.setItem('wos.previewOverview.v1', '1');
  }
  const d = __wos.desks.findIndex(d => d.wins.some(id => __wos.wins[id]?.appId === 'wizard-music'));
  if (d >= 0) __wos.goDesk(d, true);
  await new Promise(r => setTimeout(r, 400));
  __wos.openOverview();
  document.querySelector('#overview').scrollTop = 0;
})();
