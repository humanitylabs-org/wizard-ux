/* Apps wake your agent (wizard-os issue 634): a box-side switch read by the Agent Service (server/app-wake.mjs).
 * Nothing in the shell changes. */
export default function setup(api) {
  // Box-side switch: the Agent Service reads it from the Look file; nothing runs here.
  return () => {};
}
