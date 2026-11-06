import test from 'node:test';
import assert from 'node:assert/strict';
import {architectureReason} from '../web/store/store-status.js';

test('eligibility follows the selected release and server host, not the browser',()=>{
  const arm={architectures:['arm64']};
  assert.match(architectureReason(arm,'amd64'),/arm64.*not this Wizard \(amd64\)/);
  assert.equal(architectureReason(arm,'arm64'),'');
  assert.equal(architectureReason({architectures:['amd64','arm64']},'amd64'),'');
  assert.match(architectureReason(arm,''),/Compatibility unavailable/);
  assert.equal(architectureReason({},'amd64'),'');
});
