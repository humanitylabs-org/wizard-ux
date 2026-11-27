/* Catch me up (wizard-agent-service issue 668): a box-side switch read by the Agent Service
 * (server/catch-up.mjs: "catch me up" runs the built catch-up). Nothing runs here. */
export default function setup(api) {
  return () => {};
}
