const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
for (const file of ['web/app.js', 'web/desktop/desktop.js']) {
  test(file + ': cold canonical app ID cannot fuzzy-open LINE', async () => {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
    const match = source.match(/    app\(id(?:, srcEl)?\) \{([\s\S]*?)\n    \},\n    video:/);
    assert.ok(match, 'Use the actual shell app deep-link handler');
    const APP = {}, opened = [], lookups = [];
    let ready; const loaded = new Promise(r => ready = r);
    const C = { appsLoaded: () => loaded };
    const findApp = (id, exact) => { lookups.push({id,exact}); return exact ? null : {id:'line'}; };
    const handler = new Function('APP','findApp','openApp','window','C','W','fromOf','id','srcEl',match[1]);
    handler(APP,findApp,a=>opened.push(a.id),{WizCore:C},C,{},()=>null,'voice-outline',null);
    assert.deepEqual(opened, [], 'Wait for registry rather than opening native LINE');
    APP['voice-outline']={id:'voice-outline'};ready();await loaded;await Promise.resolve();
    assert.deepEqual(opened,['voice-outline']);assert.ok(lookups.every(x=>x.exact===true));
    handler(APP,findApp,a=>opened.push(a.id),{WizCore:C},C,{},()=>null,'voice-outline',null);
    assert.deepEqual(opened,['voice-outline','voice-outline'],'Warm lookup opens exact app');
  });
}
