/* Agent inbox (wizard-agent-service issue 549): a box-side switch read by the Agent Service (server/agent-inbox.mjs).
 * The shell changes nothing while it is on; the Running view and sweep card are later steps of the series. */
export default function setup(api) {
  // Box-side switch: the Agent Service (wizard-agent-service server/agent-inbox.mjs) reads it; nothing runs here.
  return () => {};
}
