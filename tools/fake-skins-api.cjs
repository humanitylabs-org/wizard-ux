// Explicit in-memory contract fake. Never contacts a relay, owner box, or signer.
const {createHash} = require('node:crypto');
const hash = b => createHash('sha256').update(b).digest('hex');
module.exports = function fakeSkins() {
  const css = 'html[data-skin]{--bg:#18211b;--ink:#f4edcf;--violet-2:#d9ac72;--ls-test:store;}';
  const ownCss = 'html[data-skin]{--ls-test:owner;}';
  const sha = hash(css), pubkey = 'a'.repeat(64), eventId = 'b'.repeat(64), previewHash = 'c'.repeat(64);
  const a = `30117:${pubkey}:quiet-grove`;
  const item = { a, event_id: eventId, pubkey, npub: 'npub1fixtureauthoronly00000000000000000000000000000000000000000', name: 'Quiet Grove', summary: 'Warm greens for a little room to think.', author: { name: 'Demo maker', picture: 'https://fixture.invalid/maker.webp' }, published_at: 1792700000, updated_at: 1792800000, forks: 7, files: [{ name: 'skin.css', sha256: sha, size: Buffer.byteLength(css), url: `https://fixture.invalid/${sha}` }], preview: null, fork: null, featured: true };
  const items = [{ ...item, a: `30117:${pubkey}:paper`, name: 'Paper', featured: false, forks: 2, updated_at: item.updated_at + 1, preview: `/wizard/v1/skins/store/blob/${previewHash}` }, item];
  const skins = [{ id: 'my-skin', name: 'My skin', has_script: true, forked_from: null, published: null }];
  let active = 'my-skin'; const calls = [];
  const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const image = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');
  function handle(path, method = 'GET', body = {}) {
    const pathname = path.split('?')[0]; calls.push({ path, method, body });
    if (pathname === '/wizard/v1/my-skin') return path.includes('format=json') ? json({ path: active ? `Skins/${active}/skin.css` : 'Skins', empty: active === null, script: null }) : { status: 200, contentType: 'text/css', body: active === null ? '' : active === 'quiet-grove' ? css : ownCss };
    if (pathname === '/wizard/v1/skins' && method === 'GET') return json({ active, skins });
    if (pathname === '/wizard/v1/skins' && method === 'POST') { skins.push({ id: 'new-skin', name: body.name, has_script: false, forked_from: null, published: null }); return json({ id: 'new-skin' }); }
    if (pathname.endsWith('/active') && method === 'PUT') { active = body.id; return json({ active }); }
    if (pathname.endsWith('/store') && method === 'GET') return json({ items, featured: [a], relays: [{ url: 'wss://fixture.invalid', ok: true, events: 2 }] });
    if (pathname.endsWith('/store/add') && method === 'POST') { if (!skins.some(s => s.id === 'quiet-grove')) skins.push({ id: 'quiet-grove', name: 'Quiet Grove', has_script: false, forked_from: { a, event_id: eventId }, published: null }); active = 'quiet-grove'; return json({ id: active }); }
    if (pathname.endsWith('/store/report') && method === 'POST') return json({ ok: true });
    if (pathname.endsWith('/pack') && method === 'POST') return json({ unsigned: { kind: 30117, created_at: 1792800000, tags: [['d', body.slug || 'quiet-grove'], ['name', 'Quiet Grove'], ['summary', body.summary], ['alt', 'Wizard OS skin: Quiet Grove'], ['base', 'nebula'], ['file', 'skin.css', sha, String(Buffer.byteLength(css)), `https://fixture.invalid/${sha}`]], content: '' }, slug: body.slug || 'quiet-grove', files: [item.files[0]] });
    if (pathname.endsWith('/publish') && method === 'POST') { const id = decodeURIComponent(pathname.split('/').at(-2)); skins.find(s => s.id === id).published = { slug: body.event.tags.find(t => t[0] === 'd')[1], event_id: body.event.id, pubkey: body.event.pubkey, created_at: body.event.created_at }; return json({ a, event_id: body.event.id, relays: [{ url: 'wss://fixture.invalid', ok: true }] }); }
    if (pathname.endsWith('/' + sha) && method === 'GET') return { status: 200, contentType: 'text/css', body: css };
    if (pathname.endsWith('/' + previewHash) && method === 'GET') return { status: 200, contentType: 'image/webp', body: image };
    return json({ error: 'fixture_not_found', detail: pathname }, 404);
  }
  return { handle, calls, css, ownCss, sha, a, item, pubkey, get active() { return active; } };
};
