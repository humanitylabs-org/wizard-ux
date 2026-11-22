// wizard-ux issue 1728: with private first the Agent Service makes `private` the default agent and hides `hermes`.
// A Hermes route with no agent means `hermes`, so every main-agent request must name the default agent.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const SRC = readFileSync(new URL('../web/core/agents.js', import.meta.url), 'utf8')

function boot(agents, { hang = false } = {}) {
  const calls = [], sources = []
  const ctx = {
    document: { documentElement: { dataset: {} }, querySelectorAll: () => [], hidden: false },
    location: { pathname: '/', origin: 'https://box.example' },
    console, URL, setTimeout, clearTimeout, setInterval: () => 0, Promise, Event: class { constructor(t) { this.type = t } },
    dispatchEvent() {},
  }
  ctx.window = ctx
  ctx.globalThis = ctx
  ctx.fetch = async (input) => {
    calls.push(String(input))
    if (String(input) === '/wizard/v1/agents') {
      if (hang) return new Promise(() => {})
      return { ok: true, status: 200, json: async () => ({ agents }) }
    }
    return { ok: true, status: 200, json: async () => ({}) }
  }
  ctx.EventSource = function EventSource(url) { sources.push(url); this.url = url }
  vm.runInNewContext(SRC, ctx)
  return { A: ctx.window.WosAgents, ctx, calls, sources }
}

const PRIVATE_FIRST = [
  { id: 'hermes', label: 'Hermes', hidden: true },
  { id: 'private', label: 'Private', privacy: 'private', is_default: true, status: 'running', model: { provider: 'tinfoil', model: 'glm-5-3', allowed_models: ['glm-5-3'], fallback: false } },
]

test('private first: unscoped Hermes routes name the default private agent', async () => {
  const { A, ctx, calls, sources } = boot(PRIVATE_FIRST)
  await A.load()
  assert.equal(A.routeAgent(), 'private')
  await ctx.fetch('/wizard/hermes/api/model/options')
  await ctx.fetch('/wizard/hermes/api/sessions?limit=40&offset=0')
  await ctx.fetch('/wizard/hermes/v1/runs', { method: 'POST' })
  await ctx.fetch('/wizard/hermes/api/sessions/s1/messages?order=oldest&agent=other')
  await ctx.fetch('https://box.example/wizard/hermes/v1/runs/r1#x')
  await ctx.fetch('/wizard/v1/private-first')
  await ctx.fetch('/wizard-tinfoil/api/status')
  new ctx.EventSource('/wizard/hermes/v1/runs/r1/events')
  assert.deepEqual(calls.filter(u => !/^\/wizard\/v1\/(agents|agent-options|app-bindings)$/.test(u)), [
    '/wizard/hermes/api/model/options?agent=private',
    '/wizard/hermes/api/sessions?limit=40&offset=0&agent=private',
    '/wizard/hermes/v1/runs?agent=private',
    '/wizard/hermes/api/sessions/s1/messages?order=oldest&agent=other',
    'https://box.example/wizard/hermes/v1/runs/r1?agent=private#x',
    '/wizard/v1/private-first',
    '/wizard-tinfoil/api/status',
  ])
  assert.deepEqual(sources, ['/wizard/hermes/v1/runs/r1/events?agent=private'])
})

test('a request made before the agent list answers waits for it', async () => {
  const { ctx, calls } = boot(PRIVATE_FIRST)
  await ctx.fetch('/wizard/hermes/api/model/options')
  assert.ok(calls.includes('/wizard/hermes/api/model/options?agent=private'), calls.join(' '))
})

test('an Agent Service that hangs never stalls Hermes requests for long', async () => {
  const { ctx, calls } = boot(PRIVATE_FIRST, { hang: true })
  const t = Date.now()
  await ctx.fetch('/wizard/hermes/api/model/options')
  assert.ok(Date.now() - t < 4500)
  assert.ok(calls.includes('/wizard/hermes/api/model/options'))
})

test('regression: default hermes keeps unscoped routes', async () => {
  const { A, ctx, calls, sources } = boot([{ id: 'hermes', label: 'Hermes', is_default: true }, { id: 'philosopher', label: 'Philosopher' }])
  await A.load()
  assert.equal(A.routeAgent(), '')
  await ctx.fetch('/wizard/hermes/api/model/options')
  await ctx.fetch('/wizard/hermes/v1/runs')
  new ctx.EventSource('/wizard/hermes/v1/runs/r1/events')
  assert.deepEqual(calls.filter(u => !/^\/wizard\/v1\/(agents|agent-options|app-bindings)$/.test(u)), ['/wizard/hermes/api/model/options', '/wizard/hermes/v1/runs'])
  assert.deepEqual(sources, ['/wizard/hermes/v1/runs/r1/events'])
})

test('no Agent Service (404): routes stay unscoped', async () => {
  const { A, ctx, calls } = boot([])
  await A.load()
  assert.equal(A.routeAgent(), '')
  await ctx.fetch('/wizard/hermes/api/sessions')
  assert.ok(calls.includes('/wizard/hermes/api/sessions'))
})

test('private first: a main-agent send routes as the private agent (its own provider, not custom:tinfoil-operator)', async () => {
  const { A, ctx } = boot(PRIVATE_FIRST)
  await A.load()
  assert.equal(A.mainRoute('')?.id, 'private')
  assert.equal(A.mainRoute('private')?.id, 'private')
  assert.equal(A.mainRoute('philosopher'), null)
  Object.assign(ctx, { localStorage: { getItem: () => null, setItem() {} }, addEventListener() {}, WizLive: { session: () => null, agentOf: () => '' } })
  ctx.document.addEventListener = () => {}
  vm.runInNewContext(readFileSync(new URL('../web/core/chat-models.js', import.meta.url), 'utf8'), ctx)
  const M = ctx.WosModels
  const snap = M.snapshot('', null, '')
  assert.deepEqual({ ...snap }, { model: 'glm-5-3', provider: 'tinfoil', agent: 'private' })
  assert.deepEqual({ ...(await M.resolveRoute(snap)) }, { model: 'glm-5-3', provider: 'tinfoil', agent: 'private' })
  assert.equal(M.agentFor('', '')?.id, 'private')
})

test('regression: hermes default has no main route agent', async () => {
  const { A } = boot([{ id: 'hermes', label: 'Hermes', is_default: true }])
  await A.load()
  assert.equal(A.mainRoute(''), null)
})
