import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { uploadsFixture } = createRequire(import.meta.url)('../tools/qa-uploads.cjs');
function request(method, path, body, headers = {}) {
  let response;
  return { request: () => ({ method: () => method, url: () => 'http://qa.invalid' + path, postDataJSON: () => body, postDataBuffer: () => body, headers: () => headers }), fulfill: async result => { response = result; }, result: () => response };
}
test('QA resumable uploads exercise create, byte offset, chunk bytes and completion', async () => {
  const fixture = uploadsFixture(), meta = { filename:'image.png', mime:'image/png', bytes:4, client_upload_id:'qa-client' };
  const create = request('POST', '/wizard/v1/uploads', meta); assert.equal(await fixture.route(create), true);
  const id = JSON.parse(create.result().body).upload_id;
  for (const [offset, chunk] of [[0, Buffer.from([1,2])], [2, Buffer.from([3,4])]]) {
    const patch = request('PATCH', '/wizard/v1/uploads/' + id, chunk, { 'content-type':'application/offset+octet-stream', 'upload-offset':String(offset) });
    assert.equal(await fixture.route(patch), true); assert.equal(patch.result().status, 204); assert.equal(patch.result().headers['Upload-Offset'], String(offset + 2));
  }
  const complete = request('POST', '/wizard/v1/uploads/' + id + '/complete'); await fixture.route(complete);
  assert.equal(JSON.parse(complete.result().body).file.filename, meta.filename);
  assert.deepEqual(Buffer.concat(fixture.completed()[0].chunks), Buffer.from([1,2,3,4]));
});
test('QA upload fixture rejects missing metadata, wrong offset and premature completion', async () => {
  const fixture = uploadsFixture();
  await assert.rejects(fixture.route(request('POST', '/wizard/v1/uploads', {})));
  const create = request('POST', '/wizard/v1/uploads', { filename:'test.txt', mime:'text/plain', bytes:4, client_upload_id:'qa' }); await fixture.route(create);
  const id = JSON.parse(create.result().body).upload_id;
  await assert.rejects(fixture.route(request('PATCH', '/wizard/v1/uploads/' + id, Buffer.from('x'), { 'content-type':'application/offset+octet-stream', 'upload-offset':'1' })));
  await assert.rejects(fixture.route(request('POST', '/wizard/v1/uploads/' + id + '/complete')));
  assert.equal(fixture.completed().length, 0);
});
test('QA upload fixture neither handles nor forwards non-upload requests', async () => {
  const fixture = uploadsFixture(), route = request('POST', '/wizard/hermes/v1/runs', { input:'never send' });
  assert.equal(await fixture.route(route), false); assert.equal(route.result(), undefined);
});
