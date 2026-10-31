/* Desks | Orbs switch (Miguel, 31 Oct 2026; was Classic | Orb): in the middle of the top bar, in place of the date and time. While the Orb desktop is being iterated, one click flips it on or off for
 * this device from the desktop itself, in both modes, never through Settings. It only switches miguel/orb-shell, the
 * same way Settings › Look › Tweaks does (the device's tweak mix, no reload), so it can never leave him stuck: the
 * switch stays in the bar whichever side is on. The highlighted side follows what the desktop really wears
 * (html[data-layout], tweak.css), so a half-loaded Orbs view still shows Desks and one click mends it.
 * Phone (experimental, 31 Oct 2026): the same switch at the top of Home, between the which-Wizard menu and the gear,
 * sized like the phone's own top controls; Orbs puts the orb scene on Home, Desks gives the stock Home back. */
export default function setup(api) {
  const desk = api.env.shell === 'desktop';
  const ORB = 'miguel/orb-shell';
  const box = document.createElement('div');
  box.className = 'os-switch'; box.setAttribute('role', 'group'); box.setAttribute('aria-label', (desk ? 'Desktop' : 'Home') + ' view: Desks or Orbs');
  const side = (orb, label) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'os-side ' + (orb ? 'is-orb' : 'is-classic'); b.textContent = label;
    b.title = !desk ? (orb ? 'Orbs: the orb on Home, your open apps around it' : 'Desks: the usual Home') : orb ? 'Orbs: the orb in the middle, your apps around it, chats beside it' : 'Desks: numbered desks with your windows, the bar and Home';
    api.listen(b, 'click', () => {
      if (box.classList.contains('is-busy') || api.settings.tweakOn(ORB) === orb) return;
      box.classList.add('is-busy');
      api.settings.toggleTweak(ORB).then(() => box.classList.remove('is-busy'));
    });
    return b;
  };
  const classic = side(false, 'Desks'), orb = side(true, 'Orbs');
  const paint = () => { const on = api.settings.tweakOn(ORB); classic.setAttribute('aria-pressed', String(!on)); orb.setAttribute('aria-pressed', String(on)); };
  box.append(classic, orb);
  paint(); api.on('route', paint);
  if (desk) api.slot.mount('bar-center', box, -10);
  else api.slot.mount('home-main', box, -20);
  return () => box.remove();
}
