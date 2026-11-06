/* Orbs view (Miguel, 31 Oct 2026): wears the built-in Orb layout (web/layouts/orb). Desktop: the orb scene instead of
 * desks. Phone (experimental): the same orb scene on Home only, the rest of the phone as it is (layouts/orb/phone.js).
 * Turning this off releases the layout: Desks (the classic desktop, the stock phone Home) comes straight back. */
export default function setup(api) {
  return api.layout.use('orb');
}
