#!/usr/bin/env node
// Independent verifier for the public event returned by the Android signer.
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
const { schnorr } = await import(process.env.WIZARD_NOBLE_SECP || '@noble/curves/secp256k1.js')

const event = JSON.parse(readFileSync(process.argv[2], 'utf8'))
if (!Number.isSafeInteger(event.kind) || !Number.isSafeInteger(event.created_at)
    || !/^[0-9a-f]{64}$/.test(event.pubkey) || !/^[0-9a-f]{64}$/.test(event.id)
    || !/^[0-9a-f]{128}$/.test(event.sig) || typeof event.content !== 'string'
    || !Array.isArray(event.tags) || !event.tags.every(tag => Array.isArray(tag) && tag.every(value => typeof value === 'string'))) throw new Error('Invalid event shape')
const serialized = JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content])
const id = createHash('sha256').update(serialized, 'utf8').digest('hex')
if (id !== event.id) throw new Error('NIP-01 id mismatch')
if (!schnorr.verify(Buffer.from(event.sig, 'hex'), Buffer.from(id, 'hex'), Buffer.from(event.pubkey, 'hex'))) throw new Error('BIP-340 signature failed')
console.log(JSON.stringify({ status: 'ok', verifier: '@noble/curves (independent of Android ACINQ)', kind: event.kind, id, pubkey: event.pubkey }))
