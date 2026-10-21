// Optional Chromium override and write fence; module resolution lives in tools/qa-playwright.cjs.
if(process.env.QA_CHROME) {
  const {chromium}=require('./tools/qa-playwright.cjs'),launch=chromium.launch.bind(chromium);
  chromium.launch=(...args)=>launch({...args[0],executablePath:args[0]?.executablePath||process.env.QA_CHROME},...args.slice(1));
}
if (process.env.QA_BLOCK_WRITES === '1') {
  const { chromium } = require('./tools/qa-playwright.cjs');
  const launch = chromium.launch.bind(chromium);
  chromium.launch = async (...args) => {
    if(process.env.QA_CHROME && !args[0]?.executablePath) args[0]={...args[0],executablePath:process.env.QA_CHROME};
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
