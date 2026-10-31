/* Classic | Orb switch (Miguel, 31 Oct 2026): while the Orb desktop is being iterated, one click flips it on or off for
 * this device from the desktop itself, in both modes, never through Settings. It only switches miguel/orb-shell, the
 * same way Settings › Look › Tweaks does (the device's tweak mix, no reload), so it can never leave him stuck: the
 * switch stays in the bar whichever side is on. The highlighted side follows what the desktop really wears
 * (html[data-layout], tweak.css), so a half-loaded Orb still shows Classic and one click mends it. Desktop only. */
export default function setup(api) {
  if (api.env.shell !== 'desktop') return () => {};
  const ORB = 'miguel/orb-shell';
  const box = document.createElement('div');
  box.className = 'os-switch'; box.setAttribute('role', 'group'); box.setAttribute('aria-label', 'Desktop style');
  const side = (orb, label) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'os-side ' + (orb ? 'is-orb' : 'is-classic'); b.textContent = label;
    b.title = orb ? 'Orb desktop: the entity in the middle, apps floating, Ready threads' : 'Classic desktop: desks, bar and Home';
    api.listen(b, 'click', () => {
      if (box.classList.contains('is-busy') || api.settings.tweakOn(ORB) === orb) return;
      box.classList.add('is-busy');
      api.settings.toggleTweak(ORB).then(() => box.classList.remove('is-busy'));
    });
    return b;
  };
  const classic = side(false, 'Classic'), orb = side(true, 'Orb');
  const paint = () => { const on = api.settings.tweakOn(ORB); classic.setAttribute('aria-pressed', String(!on)); orb.setAttribute('aria-pressed', String(on)); };
  box.append(classic, orb);
  paint(); api.on('route', paint);
  api.slot.mount('bar-start', box, -10);
  return () => box.remove();
}
