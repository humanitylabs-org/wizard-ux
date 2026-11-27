/* Shorter app updates (wizard-app-manager issue 1074): a box-side switch. The App Manager (wam/short_updates.py)
 * asks Runtipi for a one-stop app update while it is on. Nothing on screen changes. */
export default function setup(api) {
  // Box-side switch: every app update the App Manager runs (wizard-app-manager wam/cli.py _app_update) reads it.
  return () => {};
}
