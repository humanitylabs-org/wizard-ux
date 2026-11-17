// Links open the app's own window (wizard-os issue 650): the work is in core/android-relay.js, which copies this switch
// to the Android app and asks it to open an app's window for a tapped link (core/links.js), and in the Android app
// (AppWindows, AppSessionActivity).
export default function setup(api) { return () => {}; }
