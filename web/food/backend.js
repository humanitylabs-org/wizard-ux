/* Food backends. The Food window (web/usuals.js) talks to one of these; it never calls native directly.
 *
 *  - automation(): Food on the generic device.automation v1 capability (Android 0.10.2+). Recipes, names, voice
 *    words, the basket/route rules and every word on the cover live here in web. Native records, replays, reads the
 *    screen and shows the cover; it alone decides that nothing spends money without the owner's tap.
 *  - legacy(): the pre-v1 native Food (WizardOSNative.usuals*), kept for older APKs until v1 is proven on a phone.
 *
 * Both answer the same small interface: snapshot() (sync, cached), refresh(), teach(name), run(id), match(text),
 * save(id, name, script), keepName(id), remove(id), cancel(), settings(). Actions resolve to '' or a blocker code. */
(function (root) {
  'use strict';
  const MODE = { recording: 'teaching', replaying: 'running', confirm: 'ready', committing: 'ordering', done: 'done', failed: 'failed', idle: 'idle' };

  /** Every word the cover shows for Food, in Food's voice. Native fills {n}, {step}, {of}, {what}, {total}, {detail}. */
  function coverWords(kind, name) {
    const nm = String(name || '');
    if (kind === 'record-new') return { recordLabel: 'Saving this order', recordName: 'New order', recordEmpty: 'Saves when you order',
      recordCount: '{n} taps · saves when you order', recordCancel: "Don't save this order", recordDone: 'Save', recordDoneDesc: 'Save without ordering',
      savedTitle: 'Saved to Food ✓', savedOk: 'OK', savedOpen: 'Rename', savedOpenDesc: 'Rename this order' };
    if (kind === 'record') return { recordLabel: 'Teaching', recordName: nm, recordEmpty: '0 steps', recordCount: '{n} steps · Done at checkout',
      recordCancel: 'Cancel teaching', recordDone: 'Done', recordDoneDesc: 'Done teaching',
      savedTitle: 'Saved to Food ✓', savedName: nm, savedOk: 'OK', savedOpen: 'Rename', savedOpenDesc: 'Rename this order' };
    return {
      runningTitle: 'Ordering your ' + nm, opening: 'Opening Grab', progress: 'Step {step} of {of} · {what}', cancel: 'Cancel',
      confirmTitle: nm + ' · {total}', confirmTitleNoTotal: nm,
      confirmBody: "Everything's in the basket and Grab is on the checkout screen. Wizard won't order until you tap Place order.",
      confirmButton: 'Place order · {total}', confirmButtonNoTotal: 'Place order', confirmDesc: 'Place order', leave: 'Look first',
      noCommitTitle: nm + ' is in your basket', noCommitBody: "Grab's order button didn't show. Tap Look first to finish in Grab.",
      committingTitle: 'Placing your order', committingBody: nm,
      doneTitle: 'Ordered ✓', doneBody: nm + ' is on its way. Track it in Grab.',
      checkTitle: 'Check Grab', checkBody: 'Grab is still on checkout; it may want one more tap.',
      failedTitle: 'Stopped · nothing ordered', failedLeave: 'Show me Grab', failedClose: 'Close',
      fail: FAIL,
    };
  }
  const FAIL = {
    'accessibility-off': 'Wizard OS accessibility was switched off', 'not-open': "Grab didn't open", 'no-field': "Couldn't find the search box",
    'type-refused': "Grab didn't take the search text", commit: 'Stopped before a payment button (“{detail}”)', 'tap-refused': "Grab didn't take the tap on “{detail}”",
    'not-found': "Couldn't find “{detail}”", 'commit-gone': 'The order button is gone. Nothing was ordered.',
    'commit-refused': "Grab didn't take the order tap. Nothing was ordered.", default: 'Stopped ({code})',
  };
  const failWords = (code, detail) => (FAIL[code] || FAIL.default).replace('{detail}', detail || '').replace('{code}', code || '');
  const BLOCK = { accessibility: 'accessibility', 'not-installed': 'grab', 'target-not-allowed': 'grab', busy: 'busy', 'commit-step': 'commit-step' };

  function describe(s) {
    if (s.type === 'type') return 'type “' + s.label + '”';
    if (s.type === 'wait') return 'wait ' + s.label + ' ms';
    if (s.type === 'enter') return 'press search';
    return 'tap ' + (s.label ? '“' + s.label + '”' : '(' + s.id + ')') + (s.near ? ' by “' + s.near + '”' : '');
  }

  function automation({ port, store, rules, stripAddress = t => t, onChange = () => {}, log = () => {} }) {
    const GRAB = rules.GRAB;
    let snap = { list: store.all(), blocker: '', state: { mode: 'idle' } };
    let collecting = null;
    const changed = () => { snap = Object.assign({}, snap, { list: store.all() }); onChange(); };

    function replayAction(r) {
      return { op: 'replay', package: r.pkg || GRAB, ref: r.id, ambiguous: rules.AMBIGUOUS, words: coverWords('run', r.name),
        steps: (r.steps || []).filter(s => !(s.type === 'tap' && rules.isCommit(s.label))).map(s => Object.assign({}, s, { say: describe(s) })),
        refusals: { accessibility: 'Food needs Wizard OS accessibility switched on', 'not-installed': "Grab isn't installed", busy: 'Finish the order in progress first' } };
    }
    function recordAction(name, ref) {
      const browsing = !name;
      return { op: 'record', package: GRAB, ref, ambiguous: rules.AMBIGUOUS, returnToWizard: !browsing, words: coverWords(browsing ? 'record-new' : 'record', name),
        refusals: { accessibility: 'Food needs Wizard OS accessibility switched on', 'not-installed': "Grab isn't installed", busy: 'Finish the order in progress first' } };
    }

    /** The shared voice table → native, so the floating orb and side button hear Food's words while this page sleeps. */
    async function register() {
      const list = store.all(), table = rules.voiceTable(list), actions = {};
      for (const e of table) if (!actions[e.action]) {
        const r = e.action === '+new' ? null : list.find(x => x.id === e.action);
        if (e.action !== '+new' && !r) continue;
        actions[e.action] = r ? replayAction(r) : recordAction('', '+new');
      }
      try { await port.call('device.automation.shortcuts', { table: { entries: table.filter(e => actions[e.action]), actions } }); }
      catch (e) { log('shortcuts:' + e.code); }
    }

    function applyRun(o) {
      const r = store.get(o.ref); if (!r) return;
      r.lastRunAt = o.at || Date.now();
      if (o.total) r.lastTotal = o.total;
      r.lastResult = o.result === 'committed' ? 'ordered' : o.result === 'failed' ? 'failed: ' + failWords(o.code, o.detail) : o.result;
      store.put(r);
    }
    function applyRecording(o) {
      const pend = o.ref && o.ref !== '+new' ? store.pending(o.ref) : null;
      if (o.cancelled) return { cancelled: true };
      const name = pend && pend.name ? pend.name : '';
      const got = rules.fromRecording(o);
      if (!got.steps.length) return { empty: true };
      const id = 'u-' + String(o.id || '').replace(/^o-/, '');
      const existing = store.get(id);
      const r = Object.assign({}, existing || {}, {
        id, pkg: o.package || GRAB, steps: got.steps, basket: got.basket, place: got.place,
        name: existing ? existing.name : name || store.uniqueName(got.suggested), needsName: existing ? existing.needsName : !name,
        createdAt: existing ? existing.createdAt : o.at || Date.now(),
      });
      if (got.total) r.lastTotal = got.total;
      if (o.committed) { r.lastRunAt = o.at || Date.now(); r.lastResult = 'ordered'; }
      store.put(r);
      if (pend && pend.replaces) store.remove(pend.replaces);
      return { saved: r };
    }

    /** Take finished recordings and runs from native, store them, then acknowledge (idempotent if the ack is lost). */
    function collect() {
      if (collecting) return collecting;
      collecting = (async () => {
        let res = [];
        try {
          const { outcomes = [] } = await port.call('device.automation.outcomes');
          for (const o of outcomes) res.push(o.kind === 'recording' ? applyRecording(o) : (applyRun(o), {}));
          if (outcomes.length) {
            await port.call('device.automation.ack', { ids: outcomes.map(o => o.id) });
            for (const o of outcomes) if (o.kind === 'recording' && o.ref && o.ref !== '+new') store.unpend(o.ref);
            if (outcomes.some(o => o.kind === 'recording')) await register();
          }
        } catch (e) { log('collect:' + e.code); }
        changed();
        return res;
      })().finally(() => { collecting = null; });
      return collecting;
    }

    async function refresh() {
      try {
        const s = await port.call('device.automation.status', { package: GRAB });
        const t = s.target || {}, b = t.blocker === 'busy' ? '' : BLOCK[t.blocker] || t.blocker || '';
        const ref = s.ref || '', r = ref ? store.get(ref) : null, pend = ref ? store.pending(ref) : null;
        const mode = MODE[s.mode] || 'idle';
        const browsing = mode === 'teaching' && !(pend && pend.name);
        const status = mode === 'teaching' ? (browsing ? 'Browse Grab and order as usual' : 'Build your basket in Grab, then tap Done')
          : mode === 'running' ? `Step ${Math.min(s.step + 1, s.steps)} of ${s.steps}` : mode === 'ready' ? 'Ready to order' : mode === 'ordering' ? 'Placing order' : '';
        snap = { list: store.all(), blocker: b, state: { mode, status, browsing, name: r ? r.name : pend ? pend.name : '', log: s.log || [] } };
        if (s.outbox > 0) await collect();
      } catch (e) { snap = Object.assign({}, snap, { blocker: e.code === 'no-port' ? 'native' : snap.blocker }); log('status:' + e.code); }
      onChange();
      return snap;
    }

    async function teach(name, replaces) {
      const nm = String(name || '').trim();
      const ref = nm ? store.pend({ name: nm, replaces: replaces || '' }) : '+new';
      try { await port.call('device.automation.record', recordAction(nm, ref)); refresh(); return ''; }
      catch (e) { if (nm) store.unpend(ref); return BLOCK[e.code] || e.code; }
    }
    async function run(id) {
      if (id === '+new') return teach('');
      const r = store.get(id); if (!r) return 'missing';
      try { await port.call('device.automation.replay', replayAction(r)); refresh(); return ''; }
      catch (e) { return BLOCK[e.code] || e.code; }
    }
    async function init() {
      if (!store.migrated()) {
        try { const { recipes = [] } = await port.call('device.automation.legacyRecipes'); const n = store.migrate(recipes); if (n) log('migrated:' + n); }
        catch (e) { log('migrate:' + e.code); }
      }
      await collect();
      await register();
      return refresh();
    }

    return {
      kind: 'automation-v1', init, refresh, collect, register, snapshot: () => snap,
      teach, run,
      match(text) { return rules.matchTable(rules.voiceTable(store.all()), stripAddress(String(text || ''))) || ''; },
      save(id, name, script) {
        const r = store.get(id); if (!r) return false;
        if (name != null && String(name).trim()) { r.name = String(name).trim(); r.needsName = false; }
        if (script != null && script !== r.script) { const s = rules.parse(script); if (!s.length) return false; r.steps = s; }
        store.put(r); changed(); register();
        return true;
      },
      keepName(id) { const r = store.get(id); if (r && r.needsName) { r.needsName = false; store.put(r); changed(); } },
      remove(id) { store.remove(id); changed(); register(); },
      async cancel() { try { await port.call('device.automation.cancel'); } catch (e) { log('cancel:' + e.code); } return refresh(); },
    };
  }

  /** The pre-v1 native Food, unchanged behaviour: everything below calls the old WizardOSNative.usuals* methods. */
  function legacy(N) {
    const has = () => !!(N() && typeof N().usuals === 'function');
    const read = () => { if (!has()) return { list: [], blocker: 'native', state: {} }; try { return JSON.parse(N().usuals() || '{}'); } catch (e) { return { list: [], blocker: '', state: {} }; } };
    return {
      kind: 'native-usuals', available: has, init: async () => read(), refresh: async () => read(), collect: async () => [], register: async () => {},
      snapshot: read,
      teach: async (name, replaces) => { const r = N().usualsTeach(name || ''); if (!r && replaces) N().usualsDelete(replaces); return r || ''; },
      run: async id => N().usualsRun(id) || '',
      match(text) { if (!has() || typeof N().usualsMatch !== 'function') return ''; try { return N().usualsMatch(String(text || '')) || ''; } catch (e) { return ''; } },
      save: (id, name, script) => !!N().usualsSave(id, name, script),
      keepName: id => N().usualsKeepName?.(id),
      remove: id => N().usualsDelete(id),
      cancel: async () => { N().usualsCancel?.(); },
    };
  }

  root.WosFoodBackend = { automation, legacy, coverWords, describe, failWords };
})(typeof window !== 'undefined' ? window : globalThis);
