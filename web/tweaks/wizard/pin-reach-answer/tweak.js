// Connecting only while Wizard hasn't answered (wizard-ux issue 1607): the work is in core/android-relay.js, which copies
// this switch to the Android app, and in the Android app (ReachAnswer, MainActivity.answered).
export default function setup(api) { return () => {}; }
