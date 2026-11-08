/* Apps view (Miguel, 1 Nov 2026; desktop too since round 4): wears the built-in Apps layout (web/layouts/apps): Home as a
 * standard home screen (phone) or a launchpad (desktop), one app icon per desk, Chats first, + for an app not open yet.
 * Turning this off releases the layout: the stock Home (and the stock dock on the phone) comes straight back. */
export default function setup(api) {
  return api.layout.use('apps');
}
