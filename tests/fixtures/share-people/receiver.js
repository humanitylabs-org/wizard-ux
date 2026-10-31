// Exercises the real receiver transport; no Messenger/private data or network send implementation.
WizardApp.share.receive({accepts:['text','url','image','file'],receive:async item => {
  document.getElementById('recipient').textContent=({ 'test-a':'Test Person A','test-b':'Test Person B','test-c':'Test Person C' })[item.target] || 'Choose in Messenger (synthetic fallback)';
  document.getElementById('draft').value=[item.text,item.url].filter(Boolean).join('\n');
  document.getElementById('attachment').textContent=item.file ? item.name : '';
  return true; // only once visibly staged; button stays disabled
}});
