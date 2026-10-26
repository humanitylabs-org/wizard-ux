/* Delete after APK release A is installed: registry grants replace the pilot seed,
 * and native accepts the actual granted app id rather than one legacy token. */
(() => {
  'use strict';
  const pilot = 'wizard-music';
  window.WizBackgroundAudioLegacy = {granted: appId => appId === pilot, nativeAppId: () => pilot};
})();
