export default function setup(api) {
  api.nav.intercept('snooze', async context => { await api.nav.snoozeSomeday(context.sessionId); });
  return () => {};
}
