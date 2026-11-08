'use strict';
// Synthetic owner-only Pages look file. Never forwards a network request.
// Share this adapter between browser QA and actual WosLookSync Node regressions.
const LOOK_PATH = '/wizard/v1/pages/wizard-look/look.json';
function lookFileReply(shared, pathname, method = 'GET', body = null, actor = '') {
  if (!shared || pathname !== LOOK_PATH) return null;
  const current = () => ({ exists: true, text: JSON.stringify(shared.doc), version: String(shared.version) });
  if (method === 'GET') {
    shared.reads = (shared.reads || 0) + 1;
    return { status: 200, body: current() };
  }
  if (method !== 'PUT') return { status: 405, body: { error: 'method_not_allowed' } };
  if (body?.version !== String(shared.version)) return { status: 409, body: { error: 'stale_version', current: current() } };
  if (typeof body?.text !== 'string') return { status: 400, body: { error: 'text_required' } };
  let doc; try { doc = JSON.parse(body.text); } catch { return { status: 400, body: { error: 'invalid_json' } }; }
  shared.doc = doc; shared.version++;
  (shared.acceptedWrites ||= []).push({ actor, version: String(shared.version), views: JSON.parse(JSON.stringify(doc.views || {})) });
  return { status: 200, body: { version: String(shared.version), changed: true } };
}
module.exports = { LOOK_PATH, lookFileReply };
