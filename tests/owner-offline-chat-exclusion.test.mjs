// James, 26-27 Oct: the removed offline Chats experiment must not return during sync.
// Existing message custody, transient caches and app-owned offline Wisdom are not that experiment.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const removed = [
  'docs/OFFLINE-CHATS.md', 'docs/OFFLINE-KIT.md', 'qa-android-flight.cjs', 'qa-offline-chats.cjs',
  'tests/offline-chats.test.mjs', 'tests/offline-worker.test.cjs', 'tools/offline-chats-fixture.cjs',
  'tools/offline-shell-manifest.mjs', 'tools/qa-android-native-back.cjs', 'tools/qa-offline-regressions.cjs',
  'web/core/offline-chats.css', 'web/core/offline-chats.js', 'web/core/offline-kit.js',
  'web/core/offline-shell-manifest.js', 'web/core/offline-sw.js', 'web/core/shell-offline.js',
];
test('James: no offline Chats reading kit, flight download or landing reply experiment survives', () => {
  for (const f of removed) assert.equal(fs.existsSync(path.join(root, f)), false, f);
  const forbidden = /WosOffline(?:Chats|Kit|Shell)?\b|WizOffline(?:Chats|Kit|Shell)?\b|offline-chats|offline-kit|offline-shell-manifest|offline-sw\.js|shell-offline\.js|landing(?:Reply|Replies)|heldLanding|flightDownload|data-offline|data-flight/;
  for (const dir of ['web', 'android']) {
    const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (/\.(?:js|html|css|json|java|xml)$/.test(e.name)) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), forbidden, path.relative(root, f));
    } };
    walk(path.join(root, dir));
  }
});
