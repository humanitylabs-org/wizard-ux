export default function setup(api) {
  // Box-side switch: the Agent Service (wizard-agent-service server/messaging-replies.mjs) and Chats (core/chat-models.js) read it; nothing runs here.
  return () => {};
}
