/* First chat with five choices (wizard-agent-service issue 650): the Agent Service reads this switch from the Look file
 * (a run note sends a first chat to wizard-guide's "First chat: five choices"); Chats draws a reply's tap-to-pick
 * buttons while it is on (core/chats-attach.js, core/chats-bind.js). Nothing runs here. */
export default function setup(api) {
  return () => {};
}
