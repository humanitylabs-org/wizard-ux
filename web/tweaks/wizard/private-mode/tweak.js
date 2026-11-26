/* Private mode switch-over (wizard-agent-service issue 626): a box-side switch read by the Agent Service
 * (server/private-mode.mjs: /wizard/v1/private-mode and /wizard/v1/privacy-check). Nothing runs here. */
export default function setup(api) {
  return () => {};
}
