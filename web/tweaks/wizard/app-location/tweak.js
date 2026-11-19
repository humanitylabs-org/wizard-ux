// Location for Maps (wizard-ux issue 1629): the work is in core/apps.js (WizCore.frameAllow, read by every app frame),
// core/android-relay.js, which copies this switch to the Android app, and the Android app (AppLocation, MainActivity).
export default function setup(api) { return () => {}; }
