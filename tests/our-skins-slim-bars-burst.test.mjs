import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import { fixture } from './fixtures/web-update-harness.mjs';
const read=p => readFileSync(new URL('../web/'+p,import.meta.url),'utf8');
test('the update burst runs on every skin', async () => {
  // the real web-update.js (tests/fixtures/web-update-harness.mjs): a tapped reload bursts, whatever the skin
  for (const skin of ['nebula', 'obsidian', 'landscapes']) {
    const f = fixture({ autoApply: false }); f.doc.documentElement = { dataset: { skin } };
    await f.update();
    const going = f.web.reload('tap');
    await Promise.resolve();
    assert.equal(f.body.appended.filter(n => n.className === 'wos-burst').length, 1, skin);
    void going;
  }
  assert.ok(read('core/update-banner.css').includes('\n.wos-burst {'), 'its styles are the shared banner CSS');
});
for (const f of ['skins/obsidian/skin.css','skins/landscapes/skin.css']) test(f+' carries no update burst of its own',()=>{
 const c=read(f);
 assert.ok(!c.includes('wos-burst'));
});
test('the burst lives only in the shared banner CSS',()=>{ for (const f of ['styles.css','core/skin-frame.css']) { assert.ok(!read(f).includes('wos-burst')); } });
