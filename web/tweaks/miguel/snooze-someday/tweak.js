export default function setup(api) {
  // Snooze = lowest priority: the thread drops to the bottom of Ready (below approvals), no Snoozed section.
  api.nav.snoozeOrder('last');
  // One tap, no picker: the routed Defer disposition (an archived thread is restored first).
  api.nav.intercept('snooze', async context => { await api.nav.snoozeSomeday(context.sessionId); });
  return () => {};
}
