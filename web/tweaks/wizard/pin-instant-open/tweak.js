// Instant home-screen apps (wizard-ux issue 1830): the work is in core/android-relay.js (copies this switch to the
// Android app), core/single-app-session.js (tells the pinned window when the app has loaded), core/offline-session.js
// with core/offline-sw.js (release-stamped shell files from the saved copy), and the Android app (PinInstant).
export default function setup(api) { return () => {}; }
