import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../web/'+p,import.meta.url),'utf8');
test('the update burst runs on every skin',()=>{
 const s=read('core/web-update.js');
 assert.match(s,/if \(why === 'tap'\) \{ burst\(\);/);
 assert.ok(!/OURS/.test(s));
 assert.ok(read('core/update-banner.css').includes('\n.wos-burst {'));
});
test('the burst lives only in the shared banner CSS',()=>{ for (const f of ['styles.css','core/skin-frame.css']) { assert.ok(!read(f).includes('wos-burst')); } });
