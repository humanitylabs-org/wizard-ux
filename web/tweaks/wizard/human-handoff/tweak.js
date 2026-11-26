/* Browser takeover for Google setup (wizard-os issue 775): a box-side switch. The App Manager (wam/human_handoff.py)
 * installs Human Handoff for the host agent while it is on. Nothing on screen changes. */
export default function setup(api) {
  // Box-side switch: the App Manager (wizard-app-manager wam/human_handoff.py) reads it; nothing runs here.
  return () => {};
}
