const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

export const successMessage = access => access?.privacy === 'private'
  ? 'Private: only your private agent can use it. Find it in'
  : 'Find it in';

export function renderInstallResult({ name, message, ok = false }) {
  const link = ok ? ' <a href="../?view=apps" target="_top" data-my-apps>My apps</a>.' : '';
  return `<b>${esc(name)}${ok ? ' is ready' : ' wasn’t installed'}</b><span>${esc(message)}${link}</span>`;
}
