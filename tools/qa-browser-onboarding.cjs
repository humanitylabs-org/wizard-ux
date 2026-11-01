// Synthetic established-owner state for boundary QA, not a sign-in bypass.
// Keep it across document reloads. Hostile frames still use the real Service.
module.exports = async function seedOnboarding(page, token, report) {
  report.onboardingFixture = { providerReads: 0, setupReads: 0 };
  await page.addInitScript(() => {
    if (window !== window.top) return;
    try { localStorage.setItem('wos.welcome.v1', 'done'); } catch (_) {}
  });
  for (const pathname of ['/wizard/hermes/api/model/options', '/wizard/v1/setup']) {
    await page.route('**' + pathname, async route => {
      const request = route.request();
      if (request.frame() !== page.mainFrame() || request.method() !== 'GET' ||
          request.headers()['x-wizard-shell-token'] !== token) return route.continue();
      const model = pathname.endsWith('/model/options');
      report.onboardingFixture[model ? 'providerReads' : 'setupReads']++;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(model
        ? { provider: 'synthetic-qa', model: 'synthetic-model', providers: [{ slug: 'synthetic-qa', authenticated: true, models: ['synthetic-model'] }] }
        : { first_run: false }) });
    });
  }
};
