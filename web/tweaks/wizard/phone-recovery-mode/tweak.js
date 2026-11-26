// Phone recovery mode (wizard-ux issue 1775): the work is in core/android-relay.js, which copies this switch to the
// Android app, and the Android app (StartGuard, StartPolicy, RecoveryScreen, MainActivity).
export default function setup(api) { return () => {}; }
