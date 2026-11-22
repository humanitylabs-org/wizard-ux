// What Settings › Look does with one switch on a fresh device (wizard-ux issue 1674: tests run the code that lists a
// switch, not its catalog text): the real core/experience.js over the shipped catalog and manifests
// (tests/fixtures/w1-experience.mjs freshDevice), on a fresh device and on every author's published preset.
import { readFileSync } from 'node:fs';
import { freshDevice } from './w1-experience.mjs';

const catalog = () => JSON.parse(readFileSync(new URL('../../web/tweaks/catalog.json', import.meta.url), 'utf8'));

// { manifest, row, running, presetsRunning: [author ids whose preset runs it], canTurnOn }
export async function switchOnFreshDevice(id) {
  const fresh = freshDevice(), l = await fresh.listing(id);
  const presetsRunning = [];
  for (const who of catalog().profiles || []) { const d = freshDevice({ preset: who }); await d.E.refresh(); if (d.active().includes(id)) presetsRunning.push(who); }
  let canTurnOn = false;
  if (l.row) { await fresh.E.toggle(id); await fresh.E.whenReady(); canTurnOn = fresh.active().includes(id); }
  return { ...l, presetsRunning, canTurnOn };
}
