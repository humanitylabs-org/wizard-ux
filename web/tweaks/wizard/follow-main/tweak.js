export default function setup(api) {
  // Box-side switch: the Agent Service (server/follow-main.mjs) and its follow-main timer read it; nothing runs here.
  return () => {};
}
