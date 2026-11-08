// Now playing (Miguel, 4 Nov 2026; minimal): small moving bars on the playing app's own icon in the AI apps view's
// apps column, nothing else. Hovering the bars turns them into pause; a click pauses that app without opening it;
// paused bars stop and fade out after a short grace. ⌥P (in that view) pauses / plays what played last. The view
// draws the bars (it listens passively); this package only holds the shell's media watcher (api.media,
// core/media-watch.js) while it is on, and its css paints them. Stock Desks shows nothing (its ⌥P is the stock HUD
// key). The phone (4 Nov 2026): the same bars on the playing app's icon in the AI apps Home dock and grid; a tap on
// them pauses without opening the app; nothing inside an app and nothing in stock Desks. Nothing playing: nothing
// drawn, the view is exactly as without the tweak.
export default function setup(api) {
  const M = api.media; if (!M) return () => {};
  return M.watch(() => {});
}
