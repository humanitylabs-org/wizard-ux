import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// The shell names the app for every vault call: a framed app cannot reach another app's secret.
const services = readFileSync(new URL('../web/core/app-services.js', import.meta.url), 'utf8');
const client = readFileSync(new URL('../web/core/app-client.js', import.meta.url), 'utf8');
test('vault ops are relayed with the frame-owned appId only', () => {
  assert.equal((services.match(/vault: Object\.freeze/g) || []).length, 1, 'one vault facade preserves foreground admission and document checks; no clean-merge shadowing');
  for (const op of ['vault.has', 'vault.seal', 'vault.open', 'vault.forget']) assert.ok(services.includes(`'${op}'`), op);
  assert.match(services, /vaultCall\(st\.appId, 'seal'/);
  assert.match(services, /vaultCall\(st\.appId, 'open'/);
  assert.doesNotMatch(services, /vaultCall\(d\.args/);
  assert.match(services, /JSON\.stringify\(\{ \.\.\.extra, id, v: 1, appId, method \}\)/, 'appId written after the extra args, so args cannot override it');
});
test('apps without the Android app see no vault and a clear code', async () => {
  const start = services.indexOf('let vaultSeq'), end = services.indexOf('\n  }', services.indexOf('function vaultCall')) + 4;
  const fn = new Function('window', services.slice(start, end) + '; return vaultCall;')({});
  assert.deepEqual(await fn('messenger', 'has'), {available: false, saved: false});
  await assert.rejects(fn('messenger', 'open'), e => e.code === 'unavailable');
});
test('native replies resolve the matching request and carry error codes', async () => {
  const sent = [], port = {postMessage: m => sent.push(JSON.parse(m))};
  const start = services.indexOf('let vaultSeq'), end = services.indexOf('\n  }', services.indexOf('function vaultCall')) + 4;
  const fn = new Function('window', 'setTimeout', 'clearTimeout', services.slice(start, end) + '; return vaultCall;')({wizardVaultPort: port}, () => 1, () => {});
  const opened = fn('messenger', 'open', {title: 'Unlock Messenger'});
  assert.equal(sent[0].appId, 'messenger'); assert.equal(sent[0].method, 'open');
  port.onmessage({data: JSON.stringify({id: sent[0].id, ok: true, result: {secret: 's3'}})});
  assert.equal((await opened).secret, 's3');
  const cancelled = fn('messenger', 'open', {appId: 'other'});
  assert.equal(sent[1].appId, 'messenger');
  port.onmessage({data: JSON.stringify({id: sent[1].id, ok: false, error: 'cancelled'})});
  await assert.rejects(cancelled, e => e.code === 'cancelled');
});
test('WizardApp.vault exposes has/seal/open/forget with a long prompt timeout', () => {
  assert.match(client, /vault: Object\.freeze/);
  assert.match(client, /request\(op, args, 130000\)/);
});
// James, 27 Oct 2026: after a reload a background Messenger asked for his fingerprint over Chats. The shell holds
// seal/open until that app is in front and has stayed there briefly, and gives up with not_in_front.
test('fingerprint prompts wait until the asking app is in front', async () => {
  const start = services.indexOf('const VAULT_STEADY_MS'), end = services.indexOf('let registry, available');
  const doc = {hidden: false};
  const {whenInFront, inFront} = new Function('document', 'frames', 'setInterval', services.slice(start, end).replace('VAULT_WAIT_MS = 60000', 'VAULT_WAIT_MS = 2500') + '; return {whenInFront, inFront};')(doc, new Map(), () => 0);
  let front = false; const st = {isFront: () => front, isVisible: () => true};
  assert.equal(inFront(st), false, 'isFront wins over isVisible');
  let done = false; const p = whenInFront(st, () => true).then(() => { done = true; });
  await new Promise(r => setTimeout(r, 900)); assert.equal(done, false, 'no prompt while another window is in front');
  front = true; await new Promise(r => setTimeout(r, 300)); front = false; // a reload passing over the desk
  await new Promise(r => setTimeout(r, 700)); assert.equal(done, false, 'a brief pass does not count');
  front = true; await p; assert.equal(done, true, 'opened: the prompt goes ahead');
  doc.hidden = true; assert.equal(inFront(st), false, 'a hidden Wizard never prompts');
  await assert.rejects(whenInFront({isFront: () => false}, () => true), e => e.code === 'not_in_front');
  await assert.rejects(whenInFront({isFront: () => false}, () => false), e => e.code === 'cancelled');
});
test('seal and open both wait for the app to be in front; has and forget do not', () => {
  assert.match(services, /seal: async[^\n]*await whenInFront\(st/);
  assert.match(services, /open: async[^\n]*await whenInFront\(st/);
  assert.doesNotMatch(services, /has: async[^\n]*whenInFront/);
});
