/* Shell-owned, local-profile-only async state. No app-origin database access.
 * Atomic CAS + operation receipt commit; acknowledge only after durable readback.
 * Never a backup/cross-device promise: canonical drafts still need their backend. */
(() => {
  'use strict';
  const fail = code => { throw Object.assign(new Error(code), { code }); };
  const exact = (o, keys) => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).sort().join(',') === [...keys].sort().join(',');
  const keyOK = k => typeof k === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(k) && !['__proto__','constructor','prototype'].includes(k);
  const bytes = x => new TextEncoder().encode(JSON.stringify(x)).byteLength;
  function jsonValue(v, depth = 0) {
    if (depth > 16) fail('bad_request');
    if (v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) return;
    if (Array.isArray(v)) { if (v.length > 1000) fail('bad_request'); for (const x of v) jsonValue(x,depth+1); return; }
    if (!v || Object.getPrototypeOf(v) !== Object.prototype || Object.keys(v).length > 128) fail('bad_request');
    for (const [k,x] of Object.entries(v)) { if (!keyOK(k)) fail('bad_request'); jsonValue(x,depth+1); }
  }
  const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])) : v;
  const digest = async v => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonical(v))))), b=>b.toString(16).padStart(2,'0')).join('');
  let connection;
  const db = () => connection ||= new Promise((resolve,reject) => {
    const r = indexedDB.open('wizard-app-state-v1',1);
    r.onupgradeneeded = () => r.result.createObjectStore('namespaces');
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(Object.assign(new Error('Storage unavailable'),{code:'storage_unavailable'}));
  });
  const empty = () => ({ serial:0, values:{}, receipts:{}, migration:null });
  async function atomic(namespace, authorize, update) {
    const database = await db();
    if (!authorize()) fail('revoked');
    return new Promise((resolve,reject) => {
      const tx = database.transaction('namespaces', update ? 'readwrite' : 'readonly');
      const store = tx.objectStore('namespaces'); let answer, reason;
      const r = store.get(namespace);
      r.onsuccess = () => { try {
        if (!authorize()) fail('revoked');
        const doc = r.result || empty();
        answer = update ? update(doc) : doc;
        if (update) store.put(answer, namespace);
      } catch(e) { reason=e; tx.abort(); } };
      tx.oncomplete = () => resolve(structuredClone(answer));
      tx.onabort = tx.onerror = () => reject(reason || Object.assign(new Error('Storage failed'),{code:'storage_unavailable'}));
    });
  }
  function bounded(doc, quota) {
    if (Object.keys(doc.values).length > 128 || bytes({values:doc.values,migration:doc.migration}) > quota || Object.keys(doc.receipts).length > 256 || bytes(doc.receipts) > 524288) fail('quota_exceeded');
    return doc;
  }
  async function migrate(context) {
    // Reviewed synthetic mapping only. A same-ID other publisher cannot inherit it.
    if (context.appId !== 'fixture-drafts' || context.sourceId !== 'synthetic:fixture-drafts') return;
    if ((await atomic(context.namespace,context.authorize)).migration) return;
    const raw = localStorage.getItem('fixture-drafts.legacy.v1');
    if (raw === null) return;
    let legacy; try { legacy = JSON.parse(raw); } catch (_) { fail('migration_failed'); }
    if (!exact(legacy,['version','text']) || legacy.version !== 1 || typeof legacy.text !== 'string' || bytes({text:legacy.text}) > 32768) fail('migration_failed');
    const hash = await digest({text:legacy.text});
    const saved = await atomic(context.namespace, context.authorize, doc => {
      if (doc.migration) return doc;
      if (doc.serial || Object.keys(doc.values).length) fail('migration_conflict');
      return bounded({ serial:1, values:{draft:{revision:'r1',value:{text:legacy.text}}}, receipts:{}, migration:{version:1,hash,revision:'r1'} },context.quota);
    });
    const readback = await atomic(context.namespace, context.authorize);
    if (!readback.migration || (readback.serial === saved.serial && JSON.stringify(readback.values) !== JSON.stringify(saved.values))) fail('migration_failed');
    // Both marker and copied value share the commit. Keep legacy bytes for rollback.
  }
  async function call(context, method, args) {
    if (!context.authorize()) fail('revoked');
    if (typeof context.namespace !== 'string' || !Number.isSafeInteger(context.quota) || context.quota <= 0) fail('not_allowed');
    if (!args || args.area !== 'persistent' || bytes(args) > 65536) fail('bad_request');
    if (!['state.read','state.write','state.transaction'].includes(method)) fail('not_allowed');
    if (method === 'state.read') {
      if (!exact(args,['area','key']) || !keyOK(args.key)) fail('bad_request');
      await migrate(context);
      const doc = await atomic(context.namespace,context.authorize), entry = doc.values[args.key];
      if (!context.authorize()) fail('revoked');
      return entry ? { exists:true, value:entry.value, revision:entry.revision, schemaVersion:1 } : { exists:false, revision:null, schemaVersion:1 };
    }
    let changes;
    if (method === 'state.write') {
      if (!exact(args,['area','key','value','ifRevision','operationKey'])) fail('bad_request');
      changes=[{kind:'put',key:args.key,value:args.value,ifRevision:args.ifRevision}];
    } else {
      if (!exact(args,['area','changes','operationKey'])) fail('bad_request');
      changes=args.changes;
    }
    if (typeof args.operationKey !== 'string' || !/^[a-f0-9-]{36}$/.test(args.operationKey) || !Array.isArray(changes) || !changes.length || changes.length > 16) fail('bad_request');
    const seen = new Set();
    for (const c of changes) {
      if (!exact(c,['kind','key','value','ifRevision']) || c.kind !== 'put' || !keyOK(c.key) || seen.has(c.key) || !(c.ifRevision === null || /^r[1-9][0-9]*$/.test(c.ifRevision))) fail('bad_request');
      seen.add(c.key); jsonValue(c.value); if (bytes(c.value) > 32768) fail('too_large');
    }
    await migrate(context);
    const hash = await digest({method,args});
    const doc = await atomic(context.namespace, context.authorize, current => {
      const old = current.receipts[args.operationKey];
      if (old) { if (old.hash !== hash) fail('conflict'); return current; }
      for (const c of changes) if ((current.values[c.key]?.revision || null) !== c.ifRevision) fail('conflict');
      if (!Number.isSafeInteger(current.serial+1)) fail('quota_exceeded');
      current.serial++;
      const revisions = {};
      for (const c of changes) { const revision='r'+current.serial; current.values[c.key]={revision,value:structuredClone(c.value)}; revisions[c.key]=revision; }
      const result = method === 'state.write' ? {revision:revisions[args.key],committed:true} : {committed:true,revisions};
      current.receipts[args.operationKey]={hash,result,serial:current.serial};
      // Recent retry receipts have a separate bounded budget; autosave must not
      // permanently exhaust value capacity. An evicted old CAS cannot reapply.
      const oldest=Object.entries(current.receipts).sort((a,b)=>a[1].serial-b[1].serial);
      for (const [key] of oldest.slice(0,Math.max(0,oldest.length-256))) delete current.receipts[key];
      return bounded(current,context.quota);
    });
    const readback = await atomic(context.namespace,context.authorize);
    if (JSON.stringify(readback.receipts[args.operationKey]) !== JSON.stringify(doc.receipts[args.operationKey])) fail('storage_unavailable');
    if (!context.authorize()) fail('revoked');
    return doc.receipts[args.operationKey].result;
  }
  Object.defineProperty(window,'WizAppState',{ value:Object.freeze({call}), writable:false });
})();
