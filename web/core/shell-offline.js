/* Opt-in shell warming, shared by Chats and offline-capable app-session pins. */
(() => {
  'use strict';
  const workerURL=new URL('../sw.js',document.currentScript.src);
  window.WosShellOffline = Object.freeze({
    async warm(features) {
      if (!isSecureContext || !navigator.serviceWorker) throw Error('Wizard needs a secure connection to open offline');
      const registration = await navigator.serviceWorker.register(workerURL.href,{scope:'/wizard-os-home/'});
      // ready can otherwise wait forever on a rejected shell installation.
      const ready = await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('Offline shell worker did not become ready')),20000))]);
      const worker=ready.active || registration.active;
      if(!worker)throw Error('Offline shell worker unavailable');
      return new Promise((resolve,reject)=>{
        const port=new MessageChannel(), timer=setTimeout(()=>reject(Error('Wizard shell did not confirm saving')),60000);
        port.port1.onmessage=e=>{clearTimeout(timer);port.port1.close();if(e.data?.ok)resolve(e.data);else reject(Error(e.data?.error||'Wizard shell did not save'));};
        worker.postMessage({type:'WIZ_OFFLINE_WARM',features:Object.keys(features).filter(k=>features[k])},[port.port2]);
      });
    }
  });
})();
