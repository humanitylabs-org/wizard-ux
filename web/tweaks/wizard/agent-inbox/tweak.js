/* Agent inbox (wizard-agent-service issue 549): the Agent Service reads this switch (server/agent-inbox.mjs). The
 * Running view (wizard-ux issue 1569) is drawn by core/chats.js while it is on; this package only carries its CSS. */
export default function setup(api) {
  return () => {};
}
