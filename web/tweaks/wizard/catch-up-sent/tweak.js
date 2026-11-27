/* Catch me up clears Sent (wizard-agent-service issue 710): a box-side switch read by the Agent Service
 * (server/catch-up.mjs: the catch-up offers finished Sent chats, any age, and clear archives them). Nothing runs here. */
export default function setup(api) {
  return () => {};
}
