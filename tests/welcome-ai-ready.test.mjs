// What counts as "the agent has an AI" for the first-run Welcome, checked against the real model options shapes.
// A fresh Wizard (os.sh on a bare VPS, 29 Oct 2026) reported the virtual Mixture of Agents and the Claude
// subscription provider as authenticated before any sign-in, so the Welcome skipped "Connect your AI" and the first
// message failed. Each case runs the real web/core/welcome.js.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const src = readFileSync(new URL('../web/core/welcome.js', import.meta.url), 'utf8')
const ctx = { console, URL, URLSearchParams, Promise, JSON, Date, Math, String, Object, Array, Error, setTimeout, clearTimeout,
  AbortController, AbortSignal, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, addEventListener() {}, removeEventListener() {},
  document: { baseURI: 'https://box.test/wizard-os-home/' }, location: { href: 'https://box.test/wizard-os-home/' } }
ctx.window = ctx
vm.createContext(ctx)
vm.runInContext(src, ctx)
const { aiConnected } = ctx.WosWelcome
const SUB = 'claude-subscription-directsdk-experimental'
const CLAUDE = ['anthropic', SUB]
const moa = { slug: 'moa', authenticated: true, source: 'virtual', auth_type: 'virtual', models: ['default'] }
const sub = { slug: SUB, authenticated: true, source: 'canonical', models: ['claude-sonnet-5[1m]'] }

test('fresh Wizard before any sign-in: nothing counts (virtual MoA, unconfigured Claude subscription)', () => {
  const j = { provider: '', model: '', providers: [moa, sub, { slug: 'anthropic', authenticated: false }, { slug: 'openai-codex', authenticated: false }] }
  assert.equal(aiConnected(j), false)
  assert.equal(aiConnected(j, CLAUDE), false)
})

test('fresh Wizard after the Claude sign-in: the app made the subscription the agent model', () => {
  const j = { provider: SUB, model: 'claude-sonnet-5[1m]', providers: [moa, sub] }
  assert.equal(aiConnected(j), true)
  assert.equal(aiConnected(j, CLAUDE), true)
  assert.equal(aiConnected(j, 'openai-codex'), false)
})

test('alongside: a native Claude account or a ChatGPT sign-in counts; the chosen provider is checked alone', () => {
  const j = { provider: 'openai-codex', providers: [moa, sub, { slug: 'anthropic', authenticated: true }, { slug: 'openai-codex', authenticated: true }] }
  assert.equal(aiConnected(j), true)
  assert.equal(aiConnected(j, CLAUDE), true)
  assert.equal(aiConnected({ provider: '', providers: [moa, { slug: 'openai-codex', authenticated: true }] }, CLAUDE), false)
  assert.equal(aiConnected({ provider: '', providers: [{ slug: 'wizard-tinfoil', authenticated: true }] }, 'wizard-tinfoil'), true)
})
