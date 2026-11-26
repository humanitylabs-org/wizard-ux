// Agents run code without asking (wizard-agent-service issue 597, box switch wizard/agent-approvals): the Agent
// Service stamps a container agent's approval prompt with when it closes (expires_at) and offers a per-agent
// approve/deny setting. Runs the real chat-kit.js, chats-approvals.js and the Agents app permissions block.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { modelContext } from './fixtures/chats-list-model.mjs';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const clone = v => JSON.parse(JSON.stringify(v));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const kitCtx = { window: null, URL, Intl, Date, navigator: {}, location: { origin: 'https://wizard.example', href: 'https://wizard.example/' },
  document: { addEventListener() {}, querySelector() { return null; } }, addEventListener() {} };
kitCtx.window = kitCtx; modelContext(kitCtx); vm.runInContext(read('web/core/chat-kit.js'), kitCtx);
const KIT = kitCtx.WosChat;

const prompt = extra => ({ command: "python3 -c 'print(1)'", timestamp: 1000, choices: ['once', 'session', 'always', 'deny'], ...extra });

test('normalizeApproval carries the closing time only when the Service sends one', () => {
  const plain = clone(KIT.normalizeApproval(prompt()));
  assert.equal(plain.expiresAt, undefined); assert.equal(plain.expired, undefined);
  const timed = clone(KIT.normalizeApproval(prompt({ window_s: 3600, expires_at: 4600 })));
  assert.equal(timed.expiresAt, 4600 * 1000); assert.equal(timed.expired, undefined);
  assert.equal(clone(KIT.normalizeApproval(prompt({ expires_at: 4600, expired: true }))).expired, true);
  for (const bad of [null, 'soon', -1, NaN]) assert.equal(clone(KIT.normalizeApproval(prompt({ expires_at: bad }))).expiresAt, undefined);
});

// chats-approvals.js in a vm, as createChats wires it.
function card({ approval, approve = async () => ({}) } = {}) {
  const calls = { approve: [], render: 0, timers: [] };
  const ctx = { window: null, document: { createElement() { return {}; } }, setTimeout: (fn, ms) => { calls.timers.push({ fn, ms }); return 1; } };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(read('web/core/chats-approvals.js'), ctx);
  const c = {}, w = { id: 'w1', thread: 't1' }, W = { w1: w };
  const LIVE = { run: async () => approval, approve: async (...a) => { calls.approve.push(a); return approve(...a); }, refresh() {}, session: () => null };
  const part = ctx.WizCore.chatsParts.approvals({ ch: () => c, esc, KIT, LIVE, renderThreadNow: () => { calls.render++; }, toast() {}, W });
  return { part, c, w, calls, s: { status: 'waiting_for_approval', runId: 'wizardq_1' } };
}

test('a prompt without a closing time draws exactly as before', async () => {
  const k = card({ approval: { status: 'waiting_for_approval', approval: prompt() } });
  await k.part.loadApproval(k.w, k.s);
  const html = k.part.approvalHtml(k.c, k.s);
  assert.match(html, /Needs your approval/); assert.match(html, /<small>Only the displayed request will be answered\.<\/small>/);
  assert.doesNotMatch(html, /Waits until|Expired/);
});

test('an open prompt says until when it waits, and a tap inside the window is sent', async () => {
  const k = card({ approval: { status: 'waiting_for_approval', approval: prompt({ timestamp: Date.now() / 1000 - 360, window_s: 3600, expires_at: Date.now() / 1000 + 3240 }) } });
  await k.part.loadApproval(k.w, k.s);
  const html = k.part.approvalHtml(k.c, k.s);
  assert.match(html, /Waits until [^<]+\. Only the displayed request will be answered\./);
  assert.match(html, /data-approve="once"/);
  assert.equal(k.calls.timers.length, 1, 'one repaint is due when the window closes');
  assert.ok(Math.abs(k.calls.timers[0].ms - 3240 * 1000) < 2000);
  await k.part.loadApproval(k.w, k.s); assert.equal(k.calls.timers.length, 1, 'a re-read of the same prompt adds no timer');
  await k.part.chooseApproval('w1', 'once', k.c.approval.key);
  assert.equal(k.calls.approve.length, 1, 'approving at minute 6 reaches the agent');
});

test('a closed prompt shows Expired with no buttons and cannot be approved', async () => {
  for (const approval of [prompt({ expires_at: Date.now() / 1000 - 1 }), prompt({ expires_at: Date.now() / 1000 + 60, expired: true })]) {
    const k = card({ approval: { status: 'waiting_for_approval', approval } });
    await k.part.loadApproval(k.w, k.s);
    const html = k.part.approvalHtml(k.c, k.s);
    assert.match(html, /data-appr-expired/); assert.match(html, /Expired · the agent stopped waiting/);
    assert.doesNotMatch(html, /data-approve=/, 'nothing to tap');
    await k.part.chooseApproval('w1', 'once', k.c.approval.key);
    assert.equal(k.calls.approve.length, 0, 'an expired prompt is never answered');
  }
});

// The Agents app's permissions block (web/agents/agents.js), as tests/private-agent-admin-note.test.mjs runs it.
const between = (s, a, b) => { const i = s.indexOf(a); assert.ok(i >= 0, a); const j = s.indexOf(b, i); assert.ok(j > i, b); return s.slice(i, j); };
function agentsPage(opts = {}) {
  const ctx = { console, fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }), localStorage: { getItem: () => null, setItem() {} },
    addEventListener() {}, dispatchEvent() {}, CustomEvent: class {}, setTimeout, clearTimeout, location: { pathname: '/agents/' },
    document: { documentElement: { dataset: { leaving: '1' }, getAttribute: () => '' } } };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(read('web/core/agents.js'), ctx);
  const page = read('web/agents/agents.js');
  ctx.S = { view: { name: 'detail', id: 'a1' }, sheet: null, opts: { wizard_apps: [], agent_apps: [], outside_tools: [], other_agents: ['none'], ...opts } };
  ctx.AG = ctx.WosAgents; ctx.esc = esc;
  vm.runInContext(`${between(page, '  const PLUS = ', '\n  /* ---------------- data')}
${between(page, '  const list = ', '  const provider = ')}
${between(page, '  function permsHtml(', '  /* ---------------- detail')}
this.permsHtml = permsHtml;`, ctx);
  return ctx;
}

test('Agents app: the Code and commands choice shows only when the Service offers it', () => {
  const off = agentsPage();
  assert.doesNotMatch(off.permsHtml({ wizard_apps: [], unattended_approvals: 'approve' }, { privacy: 'private', editable: true }), /data-unattended/, 'switch off: no choice');
  const on = agentsPage({ approvals: { unattended: ['approve', 'ask', 'deny'], default: 'approve', window_s: 3600 } });
  assert.doesNotMatch(on.permsHtml({ wizard_apps: [] }, { privacy: 'private', editable: true }), /data-unattended/, 'the main agent and host profiles have no setting');
  const pick = html => [...html.matchAll(/aria-checked="(true|false)" data-unattended="(\w+)"/g)].map(m => `${m[2]}:${m[1]}`);
  const yes = on.permsHtml({ wizard_apps: [], unattended_approvals: 'approve' }, { privacy: 'private', editable: true });
  assert.match(yes, /Code and commands/); assert.deepEqual(pick(yes), ['approve:true', 'ask:false', 'deny:false']);
  assert.match(yes, /without asking/);
  const ask = on.permsHtml({ wizard_apps: [], unattended_approvals: 'ask' }, { privacy: 'standard', editable: true });
  assert.deepEqual(pick(ask), ['approve:false', 'ask:true', 'deny:false']); assert.match(ask, /up to an hour/);
  const no = on.permsHtml({ wizard_apps: [], unattended_approvals: 'deny' }, { privacy: 'standard', editable: true });
  assert.deepEqual(pick(no), ['approve:false', 'ask:false', 'deny:true']); assert.match(no, /refused at once/);
});
