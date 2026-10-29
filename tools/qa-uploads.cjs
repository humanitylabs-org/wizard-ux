// In-memory Agent Service resumable-upload fixture. Never forwards a mutation.
const assert = require('node:assert/strict');
function uploadsFixture() {
  const uploads = new Map();
  async function route(r) {
    const q = r.request(), u = new URL(q.url()), m = q.method();
    const match = u.pathname.match(/^\/wizard\/v1\/uploads(?:\/([^/]+)(\/complete)?)?$/);
    if (!match) return false;
    const json = (status, body, headers = {}) => r.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });
    if (!match[1] && m === 'POST') {
      const meta = q.postDataJSON();
      assert.ok(meta.filename && meta.mime && meta.bytes > 0 && meta.client_upload_id);
      const id = 'qa-upload-' + (uploads.size + 1);
      uploads.set(id, { ...meta, offset: 0, chunks: [], complete: false, file: { id: 'drop_qa' + (uploads.size + 1), ...meta } });
      await json(201, { upload_id: id, offset: 0, chunk_bytes: 262144 }); return true;
    }
    const up = uploads.get(match[1]);
    assert.ok(up, 'upload must be created before use');
    if (m === 'PATCH') {
      assert.equal(q.headers()['content-type'], 'application/offset+octet-stream');
      assert.equal(Number(q.headers()['upload-offset']), up.offset);
      const bytes = q.postDataBuffer(); assert.ok(bytes?.length);
      up.chunks.push(bytes); up.offset += bytes.length; assert.ok(up.offset <= up.bytes);
      await r.fulfill({ status: 204, headers: { 'Upload-Offset': String(up.offset) } }); return true;
    }
    if (m === 'POST' && match[2]) {
      assert.equal(up.offset, up.bytes); up.complete = true;
      await json(200, { file: up.file }); return true;
    }
    if (m === 'GET') { await json(200, { ...up, chunks: undefined }); return true; }
    throw Error('Unexpected upload method: ' + m);
  }
  return { route, uploads, completed: () => [...uploads.values()].filter(x => x.complete) };
}
module.exports = { uploadsFixture };
