import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import { fixture } from './fixtures/web-update-harness.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { cascade } from './fixtures/mini-css.mjs';
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
  // its styles are the shared banner CSS: the burst the real code appended is drawn full-screen on top by it
  const f = fixture({ autoApply: false }); f.doc.documentElement = { dataset: { skin: 'nebula' } };
  await f.update(); void f.web.reload('tap'); await Promise.resolve();
  const node = f.body.appended.find(n => n.className === 'wos-burst'), doc = createDocument();
  const el = doc.createElement('div'); el.className = node.className; doc.body.append(el);
  const won = cascade(el, read('core/update-banner.css'));
  assert.equal(JSON.stringify(['position', 'inset', 'pointer-events'].map(k => won[k]?.value)), '["fixed","0","all"]');
});
for (const f of ['skins/obsidian/skin.css','skins/landscapes/skin.css']) test(f+' carries no update burst of its own',()=>{
 const c=read(f);
 assert.ok(!c.includes('wos-burst'));
});
test('the burst lives only in the shared banner CSS',()=>{ for (const f of ['styles.css','core/skin-frame.css']) { assert.ok(!read(f).includes('wos-burst')); } });
