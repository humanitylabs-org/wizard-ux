// Restricted synthetic subset of Files-backed createSkins (server/skins.mjs).
// PATCH writes skin.json, merges tweaks and returns list(); it NEVER changes active.
const copy = value => JSON.parse(JSON.stringify(value));
function createSkinFixture(data, { id = 'My skin', activeWrites = [], recipeWrites = [], refused = [], metadata = null } = {}) {
  const skin = data.skins.find(s => s.id === id);
  if (!skin) throw new Error('Missing allowlisted skin fixture');
  let meta = copy(metadata);
  const reply = (body, status = 200) => ({ status, body: copy(body) });
  const deny = (pathname, method, input) => { refused.push({ pathname, method, input }); return reply({ error: 'qa: unrelated write refused' }, 403); };
  const object = x => !!x && typeof x === 'object' && !Array.isArray(x);
  function handle(pathname, method, input) {
    if (pathname === '/wizard/v1/skins' && method === 'GET') return reply(data);
    if (pathname === '/wizard/v1/skins/active' && method === 'PUT') {
      if (!object(input) || Object.keys(input).length !== 1 || !Object.hasOwn(input, 'id') || (input.id !== null && input.id !== id)) return deny(pathname, method, input);
      activeWrites.push(copy(input)); data.active = input.id; return reply(data);
    }
    if (pathname === '/wizard/v1/skins/' + encodeURIComponent(id) && method === 'PATCH') {
      if (!object(input) || !Object.keys(input).length || Object.keys(input).some(k => !['base', 'tweaks'].includes(k))) return deny(pathname, method, input);
      if (Object.hasOwn(input, 'base') && !['nebula', 'grove'].includes(input.base)) return deny(pathname, method, input);
      if (Object.hasOwn(input, 'tweaks') && (!object(input.tweaks) || !Object.keys(input.tweaks).length || Object.entries(input.tweaks).some(([k, v]) => !['wizard/two-orbs', 'wizard/orb-radial'].includes(k) || typeof v !== 'boolean'))) return deny(pathname, method, input);
      // metadata(id) defaults only name; list()'s default nebula is NOT persisted.
      meta = { name: id, ...(meta || {}), ...copy(input), ...(input.tweaks ? { tweaks: { ...(meta?.tweaks || {}), ...input.tweaks } } : {}) };
      Object.assign(skin, { base: meta.base || 'nebula', tweaks: meta.tweaks || {}, has_recipe: Object.hasOwn(meta, 'base') || Object.hasOwn(meta, 'tweaks') });
      recipeWrites.push(copy(input)); return reply(data);
    }
    return deny(pathname, method, input);
  }
  return { handle, data, activeWrites, recipeWrites, refused, recipe: () => meta === null ? reply({ error: 'not_found' }, 404) : reply(meta) };
}
module.exports = { createSkinFixture };
