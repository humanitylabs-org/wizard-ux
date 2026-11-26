/* Private routing (wizard-agent-service issue 629): a box-side switch read by the Agent Service
 * (server/private-routing.mjs) and by the shell inline (web/outbox.js, core/private-route.js, wizard-ux issue 1804). Nothing runs here. */
export default function setup(api) {
  return () => {};
}
