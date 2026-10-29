'use strict';
// One resolver for all QA entrypoints. An explicit override fails loudly, never silently falls back.
const override = process.env.QA_PLAYWRIGHT || process.env.PLAYWRIGHT_PATH || process.env.PW || process.env.PW_MODULE || process.env.PLAYWRIGHT_MODULE || process.env.PLAYWRIGHT_DIR || process.env.QA_PW;
if (override) {
  try { module.exports = require(override); }
  catch (cause) { throw new Error(`Cannot load QA_PLAYWRIGHT (${override}): ${cause.message}`, { cause }); }
} else {
  for (const name of ['playwright', 'playwright-core']) {
    try { module.exports = require(name); break; }
    catch (cause) {
      if (cause.code !== 'MODULE_NOT_FOUND' || !cause.message.startsWith(`Cannot find module '${name}'`)) throw cause;
      if (name === 'playwright-core') throw new Error('Browser QA needs Playwright: npm install --no-save playwright (or playwright-core), or set QA_PLAYWRIGHT', { cause });
    }
  }
}
