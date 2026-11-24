/* Delete after APK release A is installed: registry grants replace the pilot seed,
 * and native accepts the actual granted app id rather than one legacy token.
 * Switch wizard/lock-screen-player (wizard-ux issue 1661, off by default): the Android app (0.10.57+) gets the
 * playing app's own id, and exactly Music and Podcasts are admitted (like only Maps gets location). */
(() => {
  'use strict';
  const pilot = 'wizard-music', MEDIA = [pilot, 'wizard-podcasts'], SWITCH = 'wizard/lock-screen-player';
  const on = () => { try { return (document.documentElement.dataset.tweaks || '').split(' ').includes(SWITCH); } catch (_) { return false; } };
  window.WizBackgroundAudioLegacy = {
    granted(appId, app) {
      if (appId !== pilot || !app?.url) return false;
      try { const u=new URL(app.url,location.href); return u.origin===location.origin && u.pathname==='/'+pilot+'/'; }
      catch (_) { return false; }
    },
    // Off: every admitted provider keeps the old single token. On: only the two media apps, each under its own id.
    admitted: appId => !on() || MEDIA.includes(appId),
    nativeAppId: appId => on() && MEDIA.includes(appId) ? appId : pilot,
  };
  try { window.addEventListener('wos:tweak-choice', e => { if (e?.detail?.id === SWITCH && e.detail.on === false) window.WizBackgroundAudio?.releaseOwn?.(); }); } catch (_) {}
})();
