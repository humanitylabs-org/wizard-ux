/* Agents run code without asking (wizard-agent-service issue 597): a box-side switch read by the Agent Service
 * (server/agents.mjs, server/routed-run-queue.mjs). The Agents app toggle and the approval card's Expired state follow
 * what the Service sends, so nothing runs here. */
export default function setup(api) {
  return () => {};
}
