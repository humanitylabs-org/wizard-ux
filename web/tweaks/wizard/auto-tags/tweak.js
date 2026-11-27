/* Automatic chat tags (wizard-agent-service issue 702): a box-side switch read by the Agent Service
 * (server/auto-tags.mjs: the Service tags chats from each channel's covers). The channel sheet's What goes here…
 * shows only while the box says autoTags: true on its channel list. Nothing runs here. */
export default function setup(api) {
  return () => {};
}
