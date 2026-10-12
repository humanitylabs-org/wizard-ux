/* PREVIEW ONLY (feature/desk-sigils-mock): on the staging origin, open a few apps on their own desks the first
 * time, then land on the Music desk, so the desk sigils show at once. Drop this file before merging. */
(() => {
  if (!/\.staging\.wizard001\.com$/.test(location.hostname) && !/[?&]seedDesks=1/.test(location.search)) return;
  if (localStorage.getItem('wos.previewDesksSeeded')) return;
  const ids = ['wizard-music', 'calendar', 'wizard-signal'];
  const go = async () => {
    const D = window.WizCore && window.WizCore.deeplink; if (!D) return setTimeout(go, 300);
    await Promise.resolve(window.WizCore.appsLoaded && window.WizCore.appsLoaded());
    for (const id of ids) { D.route(location.pathname + '?open=' + id); await new Promise(r => setTimeout(r, 450)); }
    // back to the Music desk: Home on the left; Calendar, Signal, Chats… on the right
    const pick = () => [...document.querySelectorAll('#dotsL [data-goto]')].find(b => /music/i.test(b.getAttribute('aria-label') || ''));
    for (let n = 0; n < 4 && pick(); n++) { pick().click(); await new Promise(r => setTimeout(r, 450)); }
    localStorage.setItem('wos.previewDesksSeeded', '1');
  };
  addEventListener('load', () => setTimeout(go, 900));
})();
