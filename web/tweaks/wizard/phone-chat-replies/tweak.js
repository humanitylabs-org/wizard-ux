// Chat replies as Chats notifications (wizard-ux issue 1619): the work is in web/device.js (the phone hands an accepted
// send to the box, POST /wizard/v1/phone/reply-notes), in the Agent Service (it posts the reply to Notifications under
// Chats) and in the Android app (notify/AppNotify opens the thread and clears it on read).
export default function setup(api) { return () => {}; }
