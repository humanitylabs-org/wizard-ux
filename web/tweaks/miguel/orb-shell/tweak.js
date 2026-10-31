/* Orb desktop (Miguel, 31 Oct 2026): wears the built-in Orb layout (web/layouts/orb) on the desktop shell only.
 * The phone is untouched. Turning this off releases the layout: the classic desktop comes straight back. */
export default function setup(api) {
  if (api.env.shell !== 'desktop') return () => {};
  return api.layout.use('orb');
}
