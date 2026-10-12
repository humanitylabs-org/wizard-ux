// Portable QA loader: existing suites retain historical module paths but run on Thales.
const Module = require('module');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (name, ...args) {
  if (name === '/home/telos/node_modules/playwright') name = process.env.PW;
  return resolve.call(this, name, ...args);
};
if (process.env.QA_BLOCK_WRITES === '1') {
  const { chromium } = require(process.env.PW);
  const launch = chromium.launch.bind(chromium);
  chromium.launch = async (...args) => {
    const browser = await launch(...args), newContext = browser.newContext.bind(browser);
    browser.newContext = async (...args) => {
      const context = await newContext({ ...args[0], serviceWorkers: 'block' });
      const registerRoute = context.route.bind(context);
      const block = route => { console.log('SAFETY_BLOCK', route.request().method(), route.request().url()); return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); };
      context.route = (pattern, handler, options) => registerRoute(pattern, (route, request) => {
        const proceed = route.continue.bind(route);
        route.continue = opts => !['GET', 'HEAD'].includes(opts?.method || route.request().method()) ? block(route) : proceed(opts);
        return handler(route, request);
      }, options);
      await context.route('**/*', route => route.continue());
      return context;
    };
    return browser;
  };
}
