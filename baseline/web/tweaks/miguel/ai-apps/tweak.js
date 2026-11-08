/* AI apps view (Miguel, 2 Nov 2026): wears the built-in AI apps layout on the desktop (layouts/ai-apps/desktop.js):
 * the ChatGPT, Claude and Perplexity desktop pattern, a collapsible sidebar beside a centred chat column.
 * Desktop only (Miguel, 4 Nov 2026): the phone keeps the stock phone view until the phone layout
 * (layouts/ai-apps/layout.js, kept) is usable. Turning this off releases the layout: Desks comes straight back. */
export default function setup(api) {
  if (api.env.shell !== 'desktop') return () => {};
  return api.layout.use('ai-apps');
}
