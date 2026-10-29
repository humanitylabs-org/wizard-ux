export default function setup(api) {
  const sync = () => { const actions = api.part('thread-actions'), slot = api.slot('thread-switch-row-end'); if (actions && slot && !slot.contains(actions)) api.slot.mount('thread-switch-row-end', actions); };
  sync(); api.on('render', sync); api.on('route', sync);
  return () => {}; // the host restores borrowed core elements before removing its mounts
}
