import assert from 'node:assert/strict';
// Mounts one map at Home's home-main slot, reads only through data.read (asks the shared poller for fresh devices),
// and leaves nothing behind on teardown.
export default async function check(f) {
  const html = f.doc.documentElement;
  assert.ok(html.dataset.tweaks.includes('wizard/machines-home'));
  assert.ok(f.refreshes > 0, 'asks the shared resources poller for fresh devices');
  await f.clear();
  assert.equal(html.dataset.tweaks, '');
}
