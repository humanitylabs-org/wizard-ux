// Synthetic-regression preload only; all module resolution lives in qa-playwright.cjs.
// Opt-in synthetic authority fills model fixtures absent from older suites. The voice-seal suite
// otherwise requires a live backend; supply reads here and fence all unhandled requests locally.
if (process.env.QA_SYNTHETIC_REGRESSION === '1') {
  const { chromium } = require('./qa-playwright.cjs'), launch = chromium.launch.bind(chromium);
  chromium.launch = async (...args) => {
    const browser = await launch(...args), newContext = browser.newContext.bind(browser);
    browser.newContext = async (...options) => {
      const context = await newContext(...options), register = context.route.bind(context);
      context.route = (pattern, handler, opts) => register(pattern, async r => {
        const q = r.request(), u = new URL(q.url());
        const json = data => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
        if (q.method() === 'GET' && u.pathname === '/wizard/hermes/api/model/options') return json({ model: 'qa-model', provider: 'qa-provider', providers: [{ slug: 'qa-provider', name: 'Synthetic QA provider', authenticated: true, is_current: true, models: ['qa-model'] }] });
        if (process.env.QA_SUITE === 'qa-voice-seal.cjs') {
          const threads = Array.from({ length: 6 }, (_, i) => ({ id: 'qa-' + i, title: 'Synthetic thread ' + i, model: 'qa-model', provider: 'qa-provider', source: 'api_server', status: 'completed', message_count: 2, last_active: Date.now() / 1000 - i * 60 }));
          if (q.method() === 'GET') {
            if (u.pathname === '/wizard/v1/bootstrap') return json({ bootstrap: 1, settings: { agent: { name: 'QA Agent' } }, capabilities: { voice: true, files: true, router: true }, endpoints: { transcribe: '/wizard/voice/transcribe', route: '/wizard/v1/route', sessions: '/wizard/hermes/api/sessions', runs: '/wizard/hermes/v1/runs', upload: '/wizard/files/upload' } });
            if (u.pathname === '/wizard/hermes/api/sessions') return json({ data: threads, has_more: false });
            if (/\/messages$/.test(u.pathname)) return json({ data: [{ role: 'user', content: 'synthetic request' }, { role: 'assistant', content: 'synthetic answer' }], has_more: false });
            if (u.pathname === '/wizard/thread-seen') return json({ state: { initializedAt: Date.now(), threads: {} } });
            const t = u.pathname.match(/\/api\/sessions\/(qa-\d)$/); if (t) return json({ session: threads.find(s => s.id === t[1]) });
          }
          r.continue = () => json({}); // never allow a missed route to reach real Hermes
        }
        return handler(r);
      }, opts);
      return context;
    };
    return browser;
  };
}
