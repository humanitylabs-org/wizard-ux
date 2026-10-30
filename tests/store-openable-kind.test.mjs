import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source = readFileSync(new URL('../web/store/store.js', import.meta.url), 'utf8');
const declaration = pattern => {
  const match = source.match(pattern);
  assert.ok(match, `missing Store kind declaration: ${pattern}`);
  return match[0];
};
const program = [
  declaration(/  const KINDS = \[[\s\S]*?\n  \];/),
  declaration(/  const KIND_OF = .*?;/),
  declaration(/  const declaredKindOf = .*?;/),
  declaration(/  const kindOf = .*?;/),
].join('\n');

const kind = (app, {installed = false, open = false} = {}) =>
  Function('isInstalled', 'canOpen', `${program}; return kindOf(${JSON.stringify(app)}).id;`)(
    () => installed,
    () => open,
  );

test('installed Agent apps that expose Open are shown as owner-facing Apps', () => {
  assert.equal(kind({type: 'service'}, {installed: true, open: true}), 'apps');
  assert.equal(kind({type: 'service'}, {installed: true, open: false}), 'agent-apps');
  assert.equal(kind({type: 'service'}, {installed: false, open: true}), 'agent-apps');
  assert.equal(kind({type: 'view'}, {installed: true, open: true}), 'apps');
  assert.equal(kind({type: 'external'}, {installed: true, open: true}), 'connections');
});
