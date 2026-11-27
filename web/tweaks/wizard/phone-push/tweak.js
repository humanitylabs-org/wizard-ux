// Instant phone notifications (wizard-ux issue 1618): the work is in core/android-relay.js, which copies this switch to
// the Android app, in the Android app (notify/AppPush, AppPushPolicy) and in the Notifications app (api/phone/inbox).
export default function setup(api) { return () => {}; }
