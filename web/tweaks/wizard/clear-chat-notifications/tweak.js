// Clear chat notifications (wizard-ux issue 1276): the work is in core/android-relay.js and the Android app's
// notification listener, which read this switch; the package only makes it a switch.
export default function setup(api) { return () => {}; }
