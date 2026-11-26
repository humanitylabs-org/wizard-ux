/* Phone tester builds (wizard-app-manager issue 799): a box-side switch. The App Manager (wam/phone_sync.py) mirrors
 * the newest phone tester build while it is on. Nothing on screen changes. */
export default function setup(api) {
  // Box-side switch: the App Manager's hourly phone mirror (wizard-app-manager wam/phone_sync.py) reads it.
  return () => {};
}
