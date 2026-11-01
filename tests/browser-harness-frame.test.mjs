import test from 'node:test';
import assert from 'node:assert/strict';
import appFrame from '../tools/qa-browser-frame.cjs';
test('browser harness waits on the iframe context even when URL enumeration is still blank',async()=>{
  const calls=[];
  const frame={async waitForURL(predicate){calls.push('navigation');assert.equal(predicate(new URL('http://fixture/fixture-drafts/')),true);}};
  const page={frames:()=>[],locator(selector){assert.match(selector,/fixture-drafts/);return {first(){return this;},async waitFor({state}){calls.push(state);},async elementHandle(){return {async contentFrame(){calls.push('context');return frame;}};}};}};
  // The former page.frames().find(...) returns undefined at this exact point.
  assert.equal(page.frames().find(f=>f.url().includes('/fixture-drafts/')),undefined);
  assert.equal(await appFrame(page,'/fixture-drafts/'),frame);
  assert.deepEqual(calls,['attached','context','navigation']);
});
