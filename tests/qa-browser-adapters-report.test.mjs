import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../tools/qa-browser-adapters.cjs', import.meta.url), 'utf8');
const setupStart = source.indexOf('  const serviceTrace = [];');
const setupEnd = source.indexOf('  for (const [target, privateNotes]', setupStart);
const finalStart = source.lastIndexOf('    check(report.serviceTrace.length');
const finalEnd = source.indexOf('  } catch (error)', finalStart);
assert.ok(setupStart >= 0 && setupEnd > setupStart && finalStart > setupEnd && finalEnd > finalStart);
const setup = source.slice(setupStart, setupEnd);
const finalize = source.slice(finalStart, finalEnd);

async function finish(rows) {
  const writes = [], printed = [], report = { checks: [] };
  let closed = false;
  const sandbox = {
    report, rows, path, out: '/synthetic-evidence',
    check(value, name) { assert.ok(value, name); report.checks.push(name); },
    context: { async close() { closed = true; } },
    fs: { writeFileSync(file, bytes) { writes.push({ file, report: JSON.parse(bytes) }); } },
    console: { log(bytes) { printed.push(JSON.parse(bytes)); } },
  };
  await new vm.Script(`(async () => {\n${setup}\nserviceTrace.push(...rows);\n${finalize}\n})()`)
    .runInNewContext(sandbox);
  return { report, writes, printed, closed };
}

const deniedRun = { method: 'POST', path: '/wizard/hermes/v1/runs', status: 403 };

test('real final block saves the local service trace and closes the context', async () => {
  const result = await finish([deniedRun]);
  assert.equal(result.closed, true);
  assert.equal(result.writes.length, 1);
  assert.equal(result.writes[0].file, '/synthetic-evidence/result.json');
  assert.deepEqual(result.writes[0].report.serviceTrace, [deniedRun]);
  assert.deepEqual(result.printed, [result.writes[0].report]);
  assert.deepEqual(result.report.checks, ['browser proof never sends a run to an owner agent']);
});

for (const [name, rows] of [
  ['successful owner run', [{ ...deniedRun, status: 200 }]],
  ['empty service trace', []],
  ['missing response status', [{ method: 'GET', path: '/wizard/v1/settings' }]],
  ['missing request path', [{ method: 'GET', status: 200 }]],
]) {
  test(`real final block rejects ${name}`, async () => {
    await assert.rejects(finish(rows), /browser proof never sends a run to an owner agent/);
  });
}
