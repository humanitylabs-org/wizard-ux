# Snooze = lowest priority, bottom of Ready (`nav.snoozeOrder('last')`)

A trusted `nav` tweak may call `api.nav.snoozeOrder('last')`. The skin host records it per package and drops it on
teardown; `WosSkinHost.snoozeOrder` reads `'last'` while any live package holds it, otherwise `'default'`.
`web/live.js` and `web/core/chats.js` read only that host value, never a package id. With `'default'` (every stock
setup, and any page without a skin host) Chats behaves exactly as before: collapsed Snoozed section, Snoozed filter,
approvals/errors keep their priority, picker on Snooze.

With `'last'`:

- Deferred settled threads stay in Ready, after every awake row (including approvals) under Newest, Oldest, Priority
  and By subject (one order bar, then awake subjects, then the snoozed tail). No Snoozed section or filter.
- Row and open header read Snoozed, even for an approval, recovery or error; they do not count as waiting or match
  Needs you until restored or replied. The underlying status/attention is untouched, so Restore recovers it.
- A snoozed pin stays saved but renders in Ready until restored. Working, hidden and archived threads keep their place.
- Toast: `Snoozed · bottom of Ready`.

Miguel's `miguel/snooze-someday` tweak (Mizel experience) holds `'last'` and intercepts Snooze: one tap, no picker,
`nav.snoozeSomeday` → `WosBoomerang.someday({ restore: true })` → the routed Defer disposition. An archived thread is
restored first; if the defer then fails the error says it was restored to Ready. The stock picker's Someday never
passes `restore`. Its `tweak.css` carries the phone order for Mizel skins, whose Chats list is `column-reverse`
(snoozed rows `order:-1`, the Ready order bar `order:-2`).

Tests: `tests/snooze-last*.test.mjs` (host gate on/off, grouping/sort on/off, indicators, restore sequencing,
shipped tweak contract).
