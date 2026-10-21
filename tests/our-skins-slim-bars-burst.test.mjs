import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../web/'+p,import.meta.url),'utf8');
test('the update burst runs only on Miguel\'s three skins',()=>{
 const s=read('core/web-update.js');
 assert.match(s,/OURS = new Set\(\['obsidian', 'obsidian-light', 'landscapes'\]\)/);
 assert.match(s,/why === 'tap' && OURS\.has\(document\.documentElement\.dataset\.skin/);
});
for (const [f,p] of [['skins/obsidian/skin.css','html[data-skin^="obsidian"]'],['skins/landscapes/skin.css','html[data-skin="landscapes"]']]) test(f+' carries the slim phone bar and the burst, skin-scoped',()=>{
 const c=read(f);
 assert.ok(c.includes(p+'[data-shell="phone"][data-skin-frame="borderless"] .win > .wbar { height: 36px;'));
 assert.ok(c.includes(p+' .wos-burst {'));
});
test('James\'s skins and core CSS carry neither',()=>{ for (const f of ['styles.css','core/skin-frame.css']) { assert.ok(!read(f).includes('wos-burst')); } });
