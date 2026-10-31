// Miguel's model switch: while this tweak is on, the shell shows its four-slot switch (Opus · Astra · Sol · private
// model) above the message box (core/chat-models.js reads data-tweaks). No extra row above the chat list.
// Defer and Done move beside the switch: one tweak, because they belong to it (Miguel, 31 Oct 2026; was switch-row-actions).
export default function setup(api) {
  const sync = () => { const actions = api.part('thread-actions'), slot = api.slot('thread-switch-row-end'); if (actions && slot && !slot.contains(actions)) api.slot.mount('thread-switch-row-end', actions); };
  sync(); api.on('render', sync); api.on('route', sync);
  return () => {}; // the host restores borrowed core elements before removing its mounts
}
