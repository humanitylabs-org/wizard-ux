import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/reuse-check-app.yml', import.meta.url), 'utf8');

test('public app callers retain the GitHub-hosted default', () => {
  assert.match(workflow, /runner:\n[\s\S]*?type: string\n\s+required: false\n\s+default: '\"ubuntu-latest\"'/);
  const value = workflow.match(/default: '([^']+)'/)[1];
  assert.equal(JSON.parse(value), 'ubuntu-latest');
});

test('private app callers can select a self-hosted label array', () => {
  assert.match(workflow, /runs-on: \$\{\{ fromJSON\(inputs\.runner\) \}\}/);
  assert.deepEqual(JSON.parse('["self-hosted","linux","forum","reuse-check"]'), ['self-hosted', 'linux', 'forum', 'reuse-check']);
});

test('runner selection preserves trusted, read-only gate execution', () => {
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.match(workflow, /repository: humanitylabs-org\/wizard-ux\n\s+ref: main/);
  assert.equal((workflow.match(/persist-credentials: false/g) || []).length, 2);
  assert.match(workflow, /run: python3 wizard-shared\/tools\/style\/check_style.py app/);
  assert.match(workflow, /run: node wizard-shared\/tools\/reuse-check-app.mjs/);
  assert.doesNotMatch(workflow, /secrets:|npm (?:ci|install)|pull_request_target/);
});
