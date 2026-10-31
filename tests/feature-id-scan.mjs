// Ratchet feature-app references without treating skin packages as feature apps.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const FEATURE_PATTERNS = Object.freeze([
  'usuals', 'Usuals', 'wizard-music', 'video-editor', 'mizel', 'Mizel',
  'wizard-signal', 'wisdom', 'shopping', 'wizard-manager', 'topics',
  'photos', 'Photos', 'Immich', 'immich', 'wizard-recorder', 'android-apps', 'cinequeue', 'trackhunt',
]);

export function scanFeatureIds(root) {
  const counts = {};
  function walk(relative) {
    if (!existsSync(join(root, relative))) return;
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = `${relative}/${entry.name}`;
      if (entry.name === 'tests' || path === 'web/skins' || path.startsWith('web/core/skins')) continue;
      // Ignored runtime outputs contain owner exports or generated update descriptions,
      // not feature routing or shell implementation. Keep source files in the ratchet.
      if (['web/data.js', 'web/summaries.js', 'web/ux-changes.json'].includes(path)) continue;
      if (entry.isDirectory()) { walk(path); continue; }
      if (!entry.isFile()) continue; // Never follow symlinks outside the source tree.
      const bytes = readFileSync(join(root, path));
      const text = bytes.toString('utf8');
      if (bytes.includes(0) || text.includes('\ufffd')) continue; // Not a UTF-8 source file.
      for (const pattern of FEATURE_PATTERNS) {
        const count = text.split(pattern).length - 1;
        if (count) counts[`${path}:${pattern}`] = count;
      }
    }
  }
  walk('web');
  walk('android/app/src/main/java');
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

export function compareFeatureIds(actual, allowed) {
  const growth = [], shrinking = [];
  for (const key of new Set([...Object.keys(actual), ...Object.keys(allowed)])) {
    const count = actual[key] || 0, limit = allowed[key] || 0;
    if (count > limit) growth.push(`${key}: ${count} > ${limit}`);
    if (count < limit) shrinking.push(`${key}: ${limit} -> ${count}`);
  }
  return { growth, shrinking };
}
