// Thales QA overlay for suites written against the live origin (qa-recordings, qa-mizel-desk): serve the shell
// under test from QA_WEB_DIR/web for https://wizard.tailc0f369.ts.net/wizard-os-home/*, read everything else
// from the live tailnet origin (GET/HEAD only; every write is answered locally and logged as SAFETY_BLOCK).
// Usage: node -r ./qa-thales-loader.cjs -r ./tools/qa-thales-overlay.cjs <suite.cjs>
const fs = require('fs'), path = require('path');
const { chromium } = require(process.env.PW);
const WEB = path.join(process.env.QA_WEB_DIR, 'web');
const TYPES = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.txt': 'text/plain' };
const launch = chromium.launch.bind(chromium);
function overlay(route) {
  const q = route.request(), u = new URL(q.url());
  if (!['GET', 'HEAD'].includes(q.method())) { console.log('SAFETY_BLOCK', q.method(), u.pathname); return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); }
  const m = u.hostname === 'wizard.tailc0f369.ts.net' && u.pathname.match(/^\/wizard-os-home\/(.*)$/);
  if (m && !m[1].startsWith('api/')) {
    const f = path.join(WEB, m[1] || 'index.html');
    if (f.startsWith(WEB) && fs.existsSync(f) && fs.statSync(f).isFile()) return route.fulfill({ status: 200, contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  }
  return null;
}
chromium.launch = async (opts = {}, ...rest) => {
  const args = (opts.args || []).filter(a => !a.startsWith('--host-resolver-rules'));
  const browser = await launch({ ...opts, args, executablePath: opts.executablePath || process.env.QA_CHROME }, ...rest), newContext = browser.newContext.bind(browser);
  browser.newContext = async (...a) => {
    const ctx = await newContext({ ...a[0], serviceWorkers: 'block' }), reg = ctx.route.bind(ctx);
    ctx.route = (pattern, handler, o) => reg(pattern, (route, request) => {
      const proceed = route.continue.bind(route);
      route.continue = opts => overlay(route) || proceed(opts);
      return handler(route, request);
    }, o);
    await reg('**/*', route => overlay(route) || route.continue());
    return ctx;
  };
  return browser;
};
