/* Tags (wizard-agent-service issue 608): a box-side switch read by the Agent Service; the shell follows the box's
 * channel list (tags: true). Nothing here changes the page. */
export default function setup(api) {
  // Box-side switch: the Agent Service reads it from the Look file; nothing runs here.
  return () => {};
}
