'use strict';
async function start() {
  try {
    const result = await WizardApp.data.call({operation:'fixture.notifications.list',args:{limit:20}});
    document.querySelector('#items').replaceChildren(...result.items.map(item => { const li=document.createElement('li');li.textContent=item.title;return li; }));
    document.querySelector('#status').textContent='Loaded synthetic list';
  } catch(e) { document.querySelector('#status').textContent='Unavailable: '+e.code; }
}
if (window.WizBoundaryClient?.ready) start(); else addEventListener('wizard:boundary:connected',start,{once:true});
