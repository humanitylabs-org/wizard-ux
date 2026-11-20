// Extends shared custody QA; APIs/inference are synthetic and intercepted.
// Seeded retained rows are NOT the original device's IndexedDB or real inference.
const fs = require('fs'), path = require('path');
module.exports = async ({ boot, ok, sleep, sid, out }) => {
  const model = 'gpt-6.1-sol', provider = 'openai-codex';
  const shells = process.env.QA_TYPED_DESKTOP_ONLY === '1' ? [true] : [false, true];
  for (const desktop of shells) for (const skin of ['nebula', 'signal']) for (const scenario of ['fresh', 'retry']) {
    // Independent contexts separate delayed fresh-Send teardown and active-run
    // state from retained Retry. Signal still switches LIVE from Nebula.
    const label = `${desktop ? 'desktop' : 'phone'}-${skin}`;
    const text = `Synthetic ${scenario === 'fresh' ? 'fresh' : 'retained'} typed reply ${label}`;
    const fixture = {
      typedRoute: true, skin: 'nebula',
      retainedTyped: scenario === 'retry' ? { model, text } : null,
      sessions: [{ id: sid, title: 'Synthetic typed-send recovery', source: 'wizard-mobile',
        model, provider: null, status: 'completed', message_count: 2,
        messages: [{ role: 'user', content: 'Synthetic prior question' }, { role: 'assistant', content: 'Synthetic prior answer' }] }],
      agents: [{ id: 'hermes', label: 'Wizard', is_default: true, status: 'running', model: { model, provider } }],
      modelOptions: { model, provider, providers: [{ slug: provider, authenticated: true, is_current: true, models: [model, 'gpt-6-astra'] }] }
    };
    const f = await boot(desktop, false, null, fixture), p = f.p;
    f.state.down = false;
    const record = (v, n, d) => ok(v, `${label} ${scenario}: ${n}`, d);
    const click = locator => locator[desktop ? 'click' : 'tap']();
    p.on('console', msg => { if (/panel:/.test(msg.text())) (f.state.panelLog ||= []).push(msg.text()); });
    const snapshot = async () => p.evaluate(() => {
      const A = window.__wos || window.__wux;
      return { wins: Object.values(A.wins).map(w => ({ id: w.id, app: w.app, thread: w.thread })),
        panels: [...document.querySelectorAll('[data-chats]')].map(el => ({ id: el.dataset.chats, classes: el.closest('.panel')?.className, visible: !!el.getClientRects().length })) };
    });
    try {
      await p.evaluate(skin => WosSkin.set(skin), skin);
      await p.waitForFunction(skin => WosSkin.current === skin && document.documentElement.dataset.skin === skin, skin);
      await p.evaluate(() => document.fonts.ready);
      // Boot opens this fixture's thread only after retained-row recovery.
      // Require one canonical, non-outgoing pane continuously for >420ms.
      await p.waitForFunction(sid => {
        const A = window.__wos || window.__wux;
        const pane = [...document.querySelectorAll('[data-chats]')].find(el => A.wins[el.dataset.chats]?.thread === sid && !el.closest('[inert], .panel-out') && el.querySelector('.ch-compose textarea')?.getClientRects().length);
        const id = pane?.dataset.chats;
        if (!id || document.querySelector('.panel-out')) { window.__typedStable = null; return false; }
        if (window.__typedStable?.id !== id) window.__typedStable = { id, at: performance.now() };
        return performance.now() - window.__typedStable.at >= 500;
      }, sid);
      const wid = await p.evaluate(() => window.__typedStable.id);
      const chat = p.locator(`[data-chats="${wid}"]`);
      const chip = await chat.locator('[data-chmodel]:visible').first().innerText();
      record(/Sol/.test(chip), 'model-only thread displays the original Sol chip', chip);
      if (scenario === 'fresh') {
        const before = f.state.posts.length;
        await chat.locator('.ch-compose textarea').fill(text);
        await click(chat.locator('.ch-compose button[type="submit"]'));
        await p.waitForFunction(text => [...WosOutbox._items.values()].some(it => it.text === text && it.state === 'sent'), text);
        const fresh = f.state.posts.slice(before);
        record(fresh.length === 1 && fresh[0].input === text && fresh[0].session_id === sid && fresh[0].model === model && fresh[0].provider === provider && fresh[0].require_model_lock === true,
          'fresh typed Send captures exact chip route once through real composer', fresh);
      } else {
        const id = f.state.retainedId;
        record(await p.evaluate(({ id, text }) => { const it = WosOutbox.get(id); return it?.state === 'failed' && it.durable && it.model === 'gpt-6.1-sol' && !it.provider && it.text === text && !it.body && !it.steerBody; }, { id, text }),
          'failed original model-only row recovered durably before opening pane');
        const retry = chat.locator(`[data-ob="${id}"] [data-obretry="${id}"]`);
        await retry.waitFor({ state: 'visible' });
        await retry.click({ trial: true });
        f.state.beforeClick = await snapshot();
        await p.screenshot({ path: path.join(out, `${label}-model-only-before.png`), animations: 'disabled' });
        const before = f.state.posts.length;
        await click(retry); // Real visible pointer; no force or DOM dispatch.
        await p.waitForFunction(id => WosOutbox.get(id)?.state === 'sent', id);
        const sent = f.state.posts.slice(before), calls = (f.state.calls || []).filter(x => x.key === id);
        record(sent.length === 1 && calls.length === 1 && sent[0].input === text && sent[0].session_id === sid && sent[0].model === model && sent[0].provider === provider && sent[0].require_model_lock === true,
          'real Retry repairs only saved provider, keeping text/thread/key and one admission', { id, sent, calls });
        record(await p.evaluate(id => { const it = WosOutbox.get(id); return it?.durable && it.model === 'gpt-6.1-sol' && it.provider === 'openai-codex'; }, id),
          'repaired route is durably owned by the original row');
        await p.screenshot({ path: path.join(out, `${label}-model-only-after.png`), animations: 'disabled' });
        await p.reload();
        await p.waitForFunction(id => WosOutbox?.recoveryComplete && WosOutbox.get(id)?.state === 'sent', id);
        record(await p.evaluate(({ id, text, sid }) => { const it = WosOutbox.get(id); return it?.durable && it.text === text && it.sessionId === sid && it.model === 'gpt-6.1-sol' && it.provider === 'openai-codex'; }, { id, text, sid }) && f.state.posts.length - before === 1 && (f.state.calls || []).filter(x => x.key === id).length === 1,
          'reload retains repaired exact row with no duplicate admission');
      }
    } catch (e) {
      f.state.failureSnapshot = await snapshot().catch(() => null);
      await p.screenshot({ path: path.join(out, `${label}-${scenario}-failure.png`) }).catch(() => {});
      throw e;
    } finally {
      fs.writeFileSync(path.join(out, `${label}-${scenario}-requests.json`), JSON.stringify({ synthetic: true, writesForwarded: 0, requests: f.state.requests, calls: f.state.calls, errors: f.state.errors, retainedId: f.state.retainedId, panelLog: f.state.panelLog, beforeClick: f.state.beforeClick, failureSnapshot: f.state.failureSnapshot }, null, 2));
      await f.done(`${label} ${scenario} typed-route synthetic fixture`);
    }
  }
};
