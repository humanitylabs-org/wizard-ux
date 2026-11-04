/* AI apps view (Miguel, 2 Nov 2026): wears the built-in AI apps layout (web/layouts/ai-apps) on the phone: the layout
 * the ChatGPT, Claude and Perplexity phone apps share, with Wizard's apps where they put Projects / GPTs / Spaces.
 * On the desktop it wears the same layout (layouts/ai-apps/desktop.js): their desktop pattern, a collapsible sidebar
 * beside a centred chat column. Turning this off releases the layout: the stock shell (Desks) comes straight back. */
export default function setup(api) {
  if (api.env.shell !== 'phone' && api.env.shell !== 'desktop') return () => {};
  return api.layout.use('ai-apps');
}
