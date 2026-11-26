/* The install sheet's private AI card (wizard-ux issue 1802; spec "Private mode as an opt-in", sections 3 item 4, 7
 * and 8.5), behind the owner's switch `wizard/private-ai-nudge`, off by default.
 * When an app that declares personal data (the Agent Service's answer for the app: its wizard.md `privacy: private`
 * tag, a private-data slot or its `personal_data` label, wizard-os#929; an app with no declaration is not personal,
 * nothing about apps is written here) is
 * installed on a Wizard with no private agent, the sheet shows one card above everything else:
 *   "<App> reads your email." (its own line) or "<App> holds personal data." + " We recommend private AI for apps like this, so no AI company sees it."
 *   Set up private AI · Use <Claude> for now · Why it matters (only while that page exists).
 * Shown on every such install (also after No thanks in the Welcome); never anywhere outside an install.
 * Pure helpers only: store.js owns the reads, the writes and the sheet. */
export const NUDGE_SWITCH = 'wizard/private-ai-nudge';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** The switch, as the shell wears it (the Store runs in the shell's frame; standalone it reads its own page). */
export function nudgeOn(win = window) {
  const has = doc => String(doc?.documentElement?.getAttribute?.('data-tweaks') || '').split(/\s+/).includes(NUDGE_SWITCH);
  try { if (win.parent && win.parent !== win && has(win.parent.document)) return true; } catch (_) {}
  try { return has(win.document); } catch (_) { return false; }
}
const agentsOf = access => (Array.isArray(access?.agents) ? access.agents : []).filter(a => a && typeof a.id === 'string');
/** The app declares personal data: the `privacy: private` tag or its own `personal_data` label (wizard-os#929). */
export const personalApp = access => access?.privacy === 'private' || access?.personal_data === true;
/** The card is due: the app declares personal data and the box has no private agent. A tagged app also has no agent
 * that can use it yet; an app with only the label already starts on the standard agent, so the card shows anyway. */
export function nudgeDue(access) {
  if (access?.privacy === 'private') return access.needs_private_agent === true && !agentsOf(access).some(a => a.enabled === true);
  return access?.personal_data === true && !agentsOf(access).some(a => a.privacy === 'private');
}
/** The sentence's first half: "<App> reads your email." from the app's own line, else "<App> holds personal data." */
export function readsLine(name, reads) {
  const line = String(reads || '').replace(/\s+/g, ' ').trim().replace(/\.+$/, '').slice(0, 80);
  return `${name || 'This app'} ${line || 'holds personal data'}.`;
}
/** The standard agent "Use … for now" puts the app on: the default if it is standard, else the main agent. */
export function standardOf(access) {
  const std = agentsOf(access).filter(a => a.privacy !== 'private');
  return std.find(a => a.is_default === true) || std.find(a => a.id === 'hermes') || std[0] || null;
}
/** The owner's standard provider, by the company's product name ('Claude', 'ChatGPT', …), or ''. */
export function providerWord(provider) {
  const p = String(provider || '');
  return [[/codex|chatgpt|openai/i, 'ChatGPT'], [/claude|anthropic/i, 'Claude'], [/gemini|google/i, 'Gemini']].find(([re]) => re.test(p))?.[1] || '';
}
/** The agent ids after "Use … for now": every agent already ticked, plus the standard one. */
export function withStandard(access) {
  const std = standardOf(access);
  return std ? [...new Set([...agentsOf(access).filter(a => a.enabled === true).map(a => a.id), std.id])] : null;
}
/** The private agent that can use the app now, or null. */
export const privateOn = access => agentsOf(access).find(a => a.enabled === true && a.privacy === 'private') || null;

/** The card. o: { id, name, reads (the app's line of what it reads, or ''), provider ('Claude' or ''), why (the Why it
 * matters page exists), busy, waiting }. */
export function nudgeHtml(o) {
  const use = o.provider ? `Use ${o.provider} for now` : 'Use your standard agent for now';
  return `<div class="pv-card pn-card" data-pv-app="${esc(o.id)}" data-pn-card>
      <h3>Private AI recommended</h3>
      <p class="mc-lede">${esc(readsLine(o.name, o.reads))} We recommend private AI for apps like this, so no AI company sees it.</p>
      ${o.waiting ? '<p class="pn-note" role="status">Finish setting up private AI. This sheet follows on its own.</p>' : ''}
      <div class="pv-acts pn-acts"><button type="button" class="get big" data-pn-setup ${o.busy ? 'disabled' : ''}>Set up private AI</button><button type="button" class="get pn-std" data-pn-standard ${o.busy ? 'disabled' : ''}>${o.busy === 'standard' ? 'Saving…' : esc(use)}</button></div>
      ${o.why ? '<button type="button" class="pn-why" data-pn-why>Why it matters</button>' : ''}</div>`;
}
/** After a choice: which agent the app is on now (the private one ticked once the switch-over moved it). */
export function nudgeStatus(o, access) {
  const priv = privateOn(access);
  const on = agentsOf(access).filter(a => a.enabled === true);
  const name = esc(o.name || 'This app');
  if (priv) return `<p class="pn-done" data-pn-done="private" role="status"><span class="pn-tick" aria-hidden="true">✓</span>${name} is on ${esc(priv.label || 'your private agent')}, your private agent.</p>`;
  if (on.length) return `<p class="pn-done" data-pn-done="standard" role="status"><span class="pn-tick" aria-hidden="true">✓</span>${name} is on ${esc(on.map(a => a.label || a.id).join(', '))}${o.provider ? ` with ${esc(o.provider)}` : ''} for now. You can move it to private AI later.</p>`;
  return `<div class="pv-card" data-pv-app="${esc(o.id)}" data-pn-done="none"><p class="mc-lede">No agent can use ${name} yet.</p><div class="pv-acts"><button type="button" class="get" data-pv-choose>Choose an agent</button></div></div>`;
}
