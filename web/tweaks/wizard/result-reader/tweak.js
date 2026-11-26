/* Result reader (wizard-agent-service issue 630): a box-side switch read by the Agent Service
 * (server/result-reader.mjs: a private model decides how each finished background task is filed). Nothing runs here. */
export default function setup(api) {
  return () => {};
}
