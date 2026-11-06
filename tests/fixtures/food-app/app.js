(() => {
  'use strict';
  const food = window.WosUsuals, root = document.querySelector('[data-usuals]');
  WizardApp.ready({name:'Food', version:'0.1.0'});
  food.mount(root);
  WizardApp.back.register({canGoBack:() => !!document.querySelector('[data-us-sheet], .us-teach'), back:() => !!food.back()});
  function command(text, meta) {
    if (meta.stage === 'app') {
      // Legacy fallback aliases are reached only AFTER exact launcher names.
      // In particular held "open Grab" still opens Grab, not Food.
      const s = WizardApp.voice.stripAddress(text).toLowerCase().replace(/[^a-z0-9ก-๙ ]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/ please$/, '');
      const m = s.match(/^(?:open|launch|show|start|go to|switch to)\s+(?:me\s+)?(.+)$/);
      const q = m?.[1].replace(/^(the|my) /, '').replace(/ (app|application|view)$/, '');
      return ['usual','usuals','food','grab','saved orders','eats','wizard eats','bites','wizard bites','wizard food','grab food'].includes(q) ? {open:true} : null;
    }
    if (meta.stage !== 'beforeNames') return null;
    const id = food.match(text);
    if (id) return {id};
    if (!food.available()) return null;
    const spell = food.spell(text);
    if (spell === 'new') return {id:'+new'};
    if (spell === 'open' && (meta.kind === 'command' || meta.view?.kind !== 'chat thread')) return {open:true};
    // Names beyond wizard.md's eight-name limit stay app-owned. They occupy
    // the original exact-name stage, ahead of contextual Music fallback.
    if (meta.kind === 'command' || meta.view?.kind !== 'chat thread') {
      const q = WizardApp.voice.stripAddress(text).toLowerCase().replace(/[^a-z0-9ก-๙ ]+/g,' ').replace(/\s+/g,' ').trim().replace(/^(open |the |my )+/,'').replace(/ (app|application)$/,'');
      if (['usual','usuals','food','saved orders','eats','wizard eats','bites','wizard bites','wizard food','grab food','order food'].includes(q)) return {open:true};
    }
    return null;
  }
  WizardApp.voice.commands.register({
    claims:(text, meta) => !!command(text, meta),
    receive(text, meta) { const c=command(text, meta); return c?.open ? WizardApp.shell.focusApp() : c?.id ? food.run(c.id) : false; }
  });
})();
