export default function setup(api) {
  const root = document.createElement('div'); root.setAttribute('data-part', 'model-pills'); root.setAttribute('aria-label', 'New chat model');
  let disposed = false, selected = null, generation = 0;
  const paint = async () => {
    const seq = ++generation, models = await api.models.list(), current = await api.thread.model(); if (disposed || seq !== generation) return; selected = current; root.replaceChildren();
    for (const model of models.filter(m => !m.disabled)) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = model.label || model.id;
      button.setAttribute('aria-pressed', String(selected?.model === model.id && selected?.provider === model.provider));
      button.onclick = async () => { button.disabled = true; try { await api.thread.model(model); await paint(); } catch (e) { api.toast(e.message); } finally { button.disabled = false; } };
      root.append(button);
    }
    api.slot.mount('list-top', root, 0);
  };
  const sync = () => { api.slot.mount('list-top', root, 0); };
  void paint().catch(e => api.toast(e.message)); api.on('render', sync); api.on('route', () => { void paint().catch(e => api.toast(e.message)); }); return () => { disposed = true; root.remove(); };
}
