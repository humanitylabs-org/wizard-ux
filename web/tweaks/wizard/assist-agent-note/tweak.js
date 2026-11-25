// Side button opens the Agent chat (wizard-ux issue 1528): the work is in core/android-relay.js, which copies this
// switch to the Android app (assist/AssistNote), and app-boot.js's 'agent-note' handoff, which opens Messenger.
export default function setup(api) { return () => {}; }
