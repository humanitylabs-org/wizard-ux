#!/usr/bin/env node
// Owner-only ui-preferences client. No direct file writes or auth bypass.
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
const SPACE_ID = /^[a-z0-9-]{1,48}$/, THREAD_ID = /^[A-Za-z0-9._:-]{1,180}$/
const validName = s => typeof s === 'string' && s.trim().length > 0 && s.length <= 60 && !/[\u0000-\u001f\u007f]/u.test(s)
export function editSpaces(current, [command, id, ...args]) {
  const spaces = structuredClone(current)
  if (command === 'list') return spaces
  if (command === 'create') {
    const name = id
    if (!validName(name)) throw new Error('Name must be 1–60 characters without control characters')
    if (spaces.length >= 50) throw new Error('Maximum 50 Spaces')
    if (spaces.some(s => s.name.toLowerCase() === name.toLowerCase())) throw new Error('A Space already has this name; use its id')
    const threads = [...new Set(args)]
    if (threads.length > 500 || threads.some(t => !THREAD_ID.test(t))) throw new Error('Invalid thread ids (maximum 500)')
    return [...spaces, { id: randomUUID(), name, threads, createdAt: new Date().toISOString() }]
  }
  if (!['rename', 'delete', 'add', 'remove'].includes(command)) throw new Error('Usage: wizard-spaces.mjs list | create NAME [THREAD_ID…] | rename ID NAME | delete ID | add ID THREAD_ID… | remove ID THREAD_ID…')
  if (!SPACE_ID.test(id || '')) throw new Error('Invalid Space id')
  const space = spaces.find(s => s.id === id)
  if (!space) throw new Error('Space not found')
  if (command === 'delete') { if (args.length) throw new Error('delete accepts only an id'); return spaces.filter(s => s.id !== id) }
  if (command === 'rename') { if (args.length !== 1 || !validName(args[0])) throw new Error('rename needs one name, 1–60 characters'); space.name = args[0] }
  if (command === 'add' || command === 'remove') {
    if (!args.length || args.some(t => !THREAD_ID.test(t))) throw new Error('Supply valid thread ids')
    space.threads = command === 'add' ? [...new Set([...space.threads, ...args])] : space.threads.filter(t => !args.includes(t))
    if (space.threads.length > 500) throw new Error('Maximum 500 threads per Space')
  }
  return spaces
}
export async function run(args, { url = process.env.WIZARD_UI_PREFERENCES_URL || 'http://127.0.0.1:8923/wizard/v1/ui-preferences', request = fetch } = {}) {
  const endpoint = new URL(url)
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) throw new Error('Use an existing owner-authorized HTTP endpoint without credentials in its URL')
  async function prefs(method = 'GET', body) {
    const response = await request(endpoint, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error(`ui-preferences ${method}: HTTP ${response.status}; use this install’s owner-authorized route, never bypass auth`)
    const value = await response.json()
    if (!Array.isArray(value.spaces)) throw new Error('This Agent Service does not support Spaces yet')
    return value
  }
  const before = await prefs(), next = editSpaces(before.spaces, args)
  if (args[0] !== 'list') {
    await prefs('PUT', { spaces: next })
    const after = await prefs()
    if (JSON.stringify(after.spaces) !== JSON.stringify(next)) throw new Error('Spaces read-back differs; concurrent edit or failed persistence. Re-read before retrying.')
  }
  return { spaces: next, ...(args[0] === 'create' ? { created: next.at(-1) } : {}) }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2)).then(value => console.log(JSON.stringify(value, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1 })
}
