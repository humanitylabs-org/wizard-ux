export default function setup(api) {
  // Box-side switch: the App Manager (wizard-app-manager wam/updates.py) reads it and says `waits_for_work`;
  // core/os-update-flow.js follows that answer. Nothing runs here.
  return () => {};
}
