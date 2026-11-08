import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const { assertReadOnlyFixture } = createRequire(import.meta.url)('./notes-fixture-write-policy.cjs');
const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');

test('Notes browser entry matches the production Alt+KeyO apps shortcut', () => {
  const desktop = read('../web/desktop/desktop.js');
  const harness = read('./qa-notes-sigil.cjs');
  assert.match(desktop, /if \(alt && !shift && code === 'KeyO'\).*palToggle\('apps'\)/);
  assert.match(harness, /page\.keyboard\.press\('Alt\+o'\)/);
  assert.doesNotMatch(harness, /keyboard\.press\('(?:Control|Meta)\+o'\)/);
  assert.match(harness, /locator\('#palette:not\(\[hidden\]\)'\)\.waitFor/);
  assert.match(harness, /has:page\.locator\('\.[n]m',\{hasText:\/\^Notes\$\//);
  assert.match(harness, /\['candidate','baseline'\]/);
  assert.match(harness, /report\.cases\.length,BASELINE\?12:6/);
});

test('Notes fixture permits only refused exact shell bootstrap attempts', () => {
  const refused = (method, path) => ({ method, path, status:405, refusedBeforeHandlers:true });
  const allowed = [refused('POST','/wizard/v1/ui-preferences/seed'), refused('PUT','/wizard/thread-seen')];
  const result = assertReadOnlyFixture([{method:'GET',path:'/notes/api/tree'}, ...allowed]);
  assert.equal(result.attempted.length,2);
  assert.equal(result.acceptedMutations.length,0);
  assert.equal(result.refusedShellBootstrap.length,2);
  for (const row of [
    refused('POST','/notes/api/tree'), refused('POST','/unknown'),
    refused('POST','/wizard/v1/ui-preferences/seed/'),
    refused('DELETE','/wizard/thread-seen'),
    {...allowed[0],status:200}, {...allowed[1],status:204},
    {...allowed[0],refusedBeforeHandlers:false},
    {method:'POST',path:'/wizard/v1/ui-preferences/seed'},
  ]) assert.throws(() => assertReadOnlyFixture([row]));
  const harness = read('./qa-notes-sigil.cjs');
  assert.ok(harness.indexOf('request.status = 405; request.refusedBeforeHandlers = true;') < harness.indexOf("if (p === '/wizard/v1/bootstrap')"));
  assert.match(harness,/report.writePolicy=assertReadOnlyFixture\(requests\)/);
  assert.match(harness,/report.pageErrors.length,0/);
});
