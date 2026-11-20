export default function setup(api) {
  // Box-side switch: the Agent Service (wizard-agent-service server/private-first.mjs) and the Welcome (core/welcome.js) read it; nothing runs here.
  return () => {};
}
