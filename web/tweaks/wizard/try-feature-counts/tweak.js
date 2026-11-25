export default function setup(api) {
  // Box-side switch: the shell's core Settings code (web/core/settings.js, countsCollect) reads the apps' Try new
  // features state while it is on and the App Manager (wizard-app-manager wam/switch_feedback.py) sends the counts.
  return () => {};
}
