export default function setup(api) {
  // The shell renders ↻ and refreshes in place (desktop ⌥R contract); the host revokes both on teardown.
  return api.windowRefresh.use({ pull: false });
}
