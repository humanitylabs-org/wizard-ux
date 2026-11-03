import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const { assertReadOnlyFixture } = createRequire(import.meta.url)('./notes-fixture-write-policy.cjs');
const source = readFileSync(new URL('./qa-app-icon-identity.cjs', import.meta.url), 'utf8');
test('icon browser fixture records real refused status before all dynamic handlers', () => {
  assert.ok(source.indexOf("if(req.method!=='GET')") < source.indexOf("if(p==='/wizard/v1/bootstrap')"));
  assert.match(source, /r\.status=status;res\.writeHead\(status/);
  assert.match(source, /r\.refusedBeforeHandlers=true;return send\(.*405\)/);
  const refused = (method,path) => ({method,path,status:405,refusedBeforeHandlers:true});
  const result = assertReadOnlyFixture([refused('POST','/wizard/v1/ui-preferences/seed'),refused('PUT','/wizard/thread-seen')]);
  assert.equal(result.acceptedMutations.length,0);
  for (const row of [refused('POST','/messenger/api/send'),refused('PUT','/notes/api/tree'),refused('POST','/unknown'),{...refused('POST','/wizard/v1/ui-preferences/seed'),status:200},{method:'PUT',path:'/wizard/thread-seen',status:405}]) assert.throws(()=>assertReadOnlyFixture([row]));
});
test('icon harness reuses working readiness, shortcut, selectors and skin hover settlement', () => {
  assert.match(source,/keyboard\.press\('Alt\+o'\)/);
  assert.match(source,/locator\('\.[n]m'/);
  assert.doesNotMatch(source,/networkidle|(?:Control|Meta)\+o/);
  assert.match(source,/window\.WizConfig\?\.live/);
  assert.match(source,/rowFor\(page,shell,'wizard-calendar'\)/);
  assert.match(source,/WizCore\.refreshApps\(\)/);
  assert.match(source,/report\.writePolicy=assertReadOnlyFixture\(requests\)/);
  assert.match(source,/serviceWorkers:'block'/);
});
test('Food follows actual platform admission instead of fabricating a picker row', () => {
  assert.match(source,/registry\.APP\[id\]/);
  assert.match(source,/WizardOSNative=\{usuals:\(\)=>JSON\.stringify\(\[\]\)\}/);
  assert.match(source,/shared-renderer-control-not-launcher/);
  assert.match(source,/desktop\.APP\.food\|\|desktop\.APPS\.some/);
  assert.match(source,/phoneOnly!==true/);
  assert.doesNotMatch(source,/force:\s*true|APP\.food\s*=|APPS\.push/);
  assert.match(source,/userAgent:'Mozilla\/5\.0 \(Linux; Android/);
  assert.match(source,/data-skinpick/);
  assert.match(source,/data-st-page="appearance"/);
  assert.match(source,/#dsettings/);
  assert.doesNotMatch(source,/WosSkin\.set\(/);
});

const desktopCss = readFileSync(new URL('../web/desktop/desktop.css', import.meta.url), 'utf8');
const systemSkin = 'html:is([data-skin^="obsidian"], [data-skin^="landscapes"])';
const selectedSystem = `${systemSkin} .pal-app.pal-sys.sel .ic`;
const sharedShadow = 'box-shadow: 0 0 0 2px rgba(225, 214, 255, .8), 0 10px 24px -10px color-mix(in oklab, var(--c, #8f63ff) 60%, transparent);';
function assertSystemSelection(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const shared = rules.find(([, selectors]) => selectors.trim().startsWith(`${selectedSystem},`));
  assert.ok(shared, 'system selection must extend the shared rule, not copy or weaken it');
  assert.equal(shared[1].trim(), `${selectedSystem},\n.pal-app.sel .ic`);
  assert.equal(shared[2].trim(), sharedShadow, 'selection changes only the existing shadow');
  // Same skin prefix and extra .sel give (0,5,1), above idle (0,4,1),
  // independent of source order. Do not remove the approved system idle styling.
  const idle = rules.find(([, selectors]) => selectors.trim() === `${systemSkin} .pal-app.pal-sys .ic`);
  assert.ok(idle);
  assert.equal(idle[2].trim(), 'border: 2.5px solid #8f63ff; background: linear-gradient(160deg, rgba(143, 99, 255, .34), rgba(143, 99, 255, .14)), #0f0c17; box-shadow: 0 4px 14px rgba(143, 99, 255, .28);');
  assert.doesNotMatch(shared[0] + idle[0], /!important/);
}
test('selected system tiles reuse the exact shared ring without losing idle skin identity', () => {
  assertSystemSelection(desktopCss);
});
test('selection regression rejects the old cascade and a weakened outline contract', () => {
  const old = desktopCss.replace(`${selectedSystem},\n.pal-app.sel .ic`, '.pal-app.sel .ic');
  assert.throws(() => assertSystemSelection(old));
  assert.throws(() => assertSystemSelection(desktopCss.replace('rgba(225, 214, 255, .8)', 'rgba(225, 214, 255, .4)')));
  assert.ok(source.includes(String.raw`assert.match(hovered.shadow,/^rgba\(225, 214, 255, 0\.8\) 0px 0px 0px 2px,/`));
});
