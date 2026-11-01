// Resolve the browsing context before waiting for its navigation. An iframe src
// changes before page.frames() reports the destination (often still about:blank).
const assert = require('node:assert/strict');
module.exports = async function appFrame(page, pathname) {
  const locator = page.locator(`iframe[src*="${pathname}"]`).first();
  await locator.waitFor({state:'attached'});
  const element = await locator.elementHandle();
  const frame = await element.contentFrame();
  assert.ok(frame, 'attached app iframe has a browsing context: ' + pathname);
  await frame.waitForURL(url => url.pathname === pathname);
  return frame;
};
