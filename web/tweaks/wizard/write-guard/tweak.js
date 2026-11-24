export default function setup(api) {
  // Behaviour lives in core (core/write-guard.js reads data-tweaks on every write); nothing to draw.
  return () => {};
}
