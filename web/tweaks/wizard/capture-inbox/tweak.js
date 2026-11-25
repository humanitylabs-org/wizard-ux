/* Capture inbox (wizard-os issue 696): a box-side switch read by the Agent Service (server/capture-inbox.mjs).
 * Nothing in the shell changes. */
export default function setup(api) {
  // Box-side switch: the Agent Service reads it from the Look file; nothing runs here.
  return () => {};
}
