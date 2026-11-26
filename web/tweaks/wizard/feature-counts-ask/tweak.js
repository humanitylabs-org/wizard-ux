// Ask before sharing feature counts (wizard-ux issue 1817): the prompt is drawn by the shell's core Settings code
// (web/core/settings.js, askOpen) while this switch is on; nothing runs here.
export default function setup(api) {
  return () => {};
}
