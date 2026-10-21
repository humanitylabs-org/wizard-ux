import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../web/core/settings.js',import.meta.url),'utf8');
test('Photos backup is registered once and gated on native navigation capability',()=>{
  const context={ window:{}, navigator:{userAgent:'desktop'}, document:{}, requestAnimationFrame:()=>{} };
  vm.runInNewContext(source,context);
  assert.ok(context.window.WosSettings);
  assert.equal((source.match(/id: 'photos-backup'/g)||[]).length,1);
  assert.match(source,/available: \(\) => typeof window.wizardPhotosPort\?\.postMessage === 'function'/);
  assert.match(source,/wizardPhotosPort.postMessage\('open'\)/);
});
test('Photos child Back explicitly restores the Wizard parent, album Back stays nested',()=>{
 const s=fs.readFileSync(new URL('../android/app/src/main/java/ai/wizards/os/photos/PhotosActivity.java',import.meta.url),'utf8');
 assert.match(s,/if\(albums\) \{ show\(\); return; \}/);
 assert.match(s,/new Intent\(this,MainActivity.class\).setAction\(MainActivity.ACTION_SETTINGS\)/);
 assert.match(s,/registerOnBackInvokedCallback/);
 assert.doesNotMatch(s,/moveTaskToBack|super.onBackPressed/);
});
