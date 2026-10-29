export default function setup(api) {
  // Borrow the shared renderer/input adapter; the host revokes this choice on teardown.
  return api.overview.use({ hold: 'arrange', appAction: 'home-screen', appHold: false });
}
