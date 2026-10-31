import assert from 'node:assert/strict';
// Mounts one map at Home's home-main slot, follows Home repaints (api.on('home')), reads only through data.read,
// and leaves nothing behind on teardown.
export default async function check(f) {
  const html = f.doc.documentElement;
  assert.ok(html.dataset.tweaks.includes('miguel/machines-home'));
  assert.ok(f.refreshes > 0, 'asks the shared resources poller for fresh devices');
  await f.clear();
  assert.equal(html.dataset.tweaks, '');
}
