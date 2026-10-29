export default function setup(api) {
  // The host delegates rendering, visibility-bound polling and quota reads to core/resources.js + usage.js.
  api.data.read.resources.refresh();
  return () => {};
}
