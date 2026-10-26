(() => {
  'use strict';
  const food = window.WosUsuals, root = document.querySelector('[data-usuals]');
  WizardApp.ready({name:'Food', version:'0.1.0'});
  food.mount(root);
  WizardApp.back.register({canGoBack:() => !!document.querySelector('[data-us-sheet], .us-teach'), back:() => !!food.back()});
  function command(text, meta) {
    if (meta.stage !== 'beforeNames') return null;
    const id = food.match(text);
    if (id) return {id};
    if (!food.available()) return null;
    const spell = food.spell(text);
    if (spell === 'new') return {id:'+new'};
    if (spell === 'open' && (meta.kind === 'command' || meta.view?.kind !== 'chat thread')) return {open:true};
    return null;
  }
  WizardApp.voice.commands.register({
    claims:(text, meta) => !!command(text, meta),
    receive(text, meta) { const c=command(text, meta); return c?.open ? WizardApp.shell.focusApp() : c?.id ? food.run(c.id) : false; }
  });
})();
