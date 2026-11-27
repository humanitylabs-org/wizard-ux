/* New chat quick links (wizard-ux issue 1965): Chats draws the chips while this switch is on (core/chats-status.js
 * QUICK_LINKS, core/chats-threadpaint.js, core/chats-bind.js), and the Agent Service reads it from the Look file for
 * how the main agent answers them. Nothing runs here. */
export default function setup(api) {
  return () => {};
}
