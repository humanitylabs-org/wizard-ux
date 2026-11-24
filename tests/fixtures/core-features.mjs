// Notifications in Chats and the AI apps view are built into the shell (web/core/core-features.json, wizard-ux issue
// 1352), not tweak packages: tests that list the release-wide defaults or every offered id add them from here.
import { readFileSync } from 'node:fs';

export const coreFeatures = JSON.parse(readFileSync(new URL('../../web/core/core-features.json', import.meta.url), 'utf8'));
export const coreIds = Object.keys(coreFeatures);
export const coreDefaults = coreIds.filter(id => coreFeatures[id].default === true);
// The ids experience.js treats as release-wide defaults: the catalog's plus the core ones.
export const builtinDefaults = catalog => [...new Set([...(catalog?.defaults || []), ...coreDefaults])];
