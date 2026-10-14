// Preview entry only; remove this file and its HTML tags before production.
(() => {
  if (location.hostname !== 'topic-icons.staging.wizard001.com') return;
  const started = Date.now();
  function enter() {
    const h = window.__wos || window.__wux;
    const w = h && Object.values(h.wins).find(w => w.app === 'chats');
    if (!w || !h.live.ok || !h.live.session('wizard_topics')) {
      if (Date.now() - started < 60000) setTimeout(enter, 250);
      return;
    }
    h.chats.setQuery(window.__wux ? { id: w.id + '::list', thread: null } : w, 'Wizard Topics');
    const row = document.querySelector('[data-chopen="wizard_topics"]');
    if (row) {
      const sec = row.closest('[data-sec]');
      if (sec && !sec.classList.contains('open')) sec.querySelector('[data-sectoggle]')?.click();
      setTimeout(() => {
        const target = document.querySelector('[data-chopen="wizard_topics"]');
        const sc = target?.closest('.ch-scroll');
        if (sc) sc.scrollTop += target.getBoundingClientRect().top - sc.getBoundingClientRect().top - 10;
      }, 350);
    }
  }
  enter();
})();
