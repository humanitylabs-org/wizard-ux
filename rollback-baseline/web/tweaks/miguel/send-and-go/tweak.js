export default function setup(api) {
  if (api.env.shell !== 'desktop') return () => {};
  api.on('sent', event => { if (api.route().thread === event.thread) api.nav.newThread(); });
  return () => {};
}
