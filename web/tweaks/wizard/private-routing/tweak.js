/* Private routing (wizard-agent-service issue 629): a box-side switch read by the Agent Service
 * (server/private-routing.mjs: the orb route names the agent each take is for). Nothing runs here. */
export default function setup(api) {
  return () => {};
}
