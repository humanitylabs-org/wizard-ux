/* Agent knows the Wizard interface (wizard-ux issue 1437): a box-side switch read by the Agent Service
 * (server/agent-bridge.mjs), which copies the shell's generated manual (skill/SKILL.md) into the agent's skills only
 * while it is on. Nothing in the shell changes. */
export default function setup(api) {
  // Box-side switch: the Agent Service reads it; nothing runs here.
  return () => {};
}
