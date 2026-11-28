// Install sheet recommends private AI (wizard-ux issue 1802; on for everyone, no switch): the card's rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { nudgeDue, nudgeHtml, nudgeStatus, personalApp, providerWord, personalSentence, standardOf, withStandard } from '../web/store/store-private-nudge.js';

const MAIN = { id: 'hermes', label: 'Wizard', privacy: 'standard', is_default: true };
const WORK = { id: 'work', label: 'Work', privacy: 'standard', is_default: false };
const PRIV = { id: 'private', label: 'Private', privacy: 'private', is_default: false };
const view = (privacy, agents, extra = {}) => ({ privacy, ...(privacy === 'private' ? { needs_private_agent: !agents.some(a => a.privacy === 'private') } : {}), agents, ...extra });
test('the card is due only for a personal-data app on a box with no private agent that nobody has yet', () => {
  assert.equal(nudgeDue(view('private', [{ ...MAIN, enabled: false }])), true);
  assert.equal(nudgeDue(view('standard', [{ ...MAIN, enabled: true }])), false, 'no declaration: no card');
  assert.equal(nudgeDue(view('private', [{ ...MAIN, enabled: false }, { ...PRIV, enabled: true }])), false, 'a private agent already: no card');
  assert.equal(nudgeDue(view('private', [{ ...MAIN, enabled: true }])), false, 'already chosen: no card again');
  assert.equal(nudgeDue(null), false);
});

test('Use … for now names the standard provider and adds the standard agent', () => {
  assert.equal(providerWord('anthropic'), 'Claude');
  assert.equal(providerWord('claude-subscription-directsdk-experimental'), 'Claude');
  assert.equal(providerWord('openai-codex'), 'ChatGPT');
  assert.equal(providerWord('nous'), '');
  const v = view('private', [{ ...WORK, enabled: false }, { ...MAIN, enabled: false }]);
  assert.equal(standardOf(v).id, 'hermes', 'the default standard agent');
  assert.equal(standardOf(view('private', [{ ...WORK, enabled: false }, { ...MAIN, is_default: false, enabled: false }])).id, 'hermes', 'else the main agent');
  assert.equal(standardOf(view('private', [{ ...PRIV, is_default: true, enabled: false }, { ...WORK, enabled: false }])).id, 'work', 'a private default is never the standard one');
  assert.deepEqual(withStandard(view('private', [{ ...WORK, enabled: true }, { ...MAIN, enabled: false }])), ['work', 'hermes']);
  assert.equal(withStandard(view('private', [])), null);
  assert.match(nudgeHtml({ id: 'messenger', name: 'Messenger', provider: 'Claude' }), /Use Claude for now/);
  assert.match(nudgeHtml({ id: 'messenger', name: 'Messenger', provider: '' }), /Use your standard agent for now/);
});

test('the card: the sentence, the three ways out, Why it matters only while its page exists', () => {
  const html = nudgeHtml({ id: 'messenger', name: 'Messenger', provider: 'Claude', why: true });
  assert.match(html, /Messenger holds personal data\. We recommend private AI for apps like this, so no AI company sees it\./);
  assert.match(html, /data-pn-setup[^>]*>Set up private AI</);
  assert.match(html, /data-pn-why/);
  assert.doesNotMatch(nudgeHtml({ id: 'm', name: 'M', provider: 'Claude', why: false }), /data-pn-why/);
  assert.match(nudgeHtml({ id: 'm', name: '', provider: '' }), /This app holds personal data\./);
  assert.match(nudgeHtml({ id: 'm', name: '<b>', provider: 'Claude' }), /&lt;b&gt; holds/);
  assert.match(nudgeHtml({ id: 'm', name: 'M', waiting: true }), /Finish setting up private AI/);
});

test('after a choice the sheet says which agent has the app', () => {
  assert.match(nudgeStatus({ id: 'm', name: 'Notes' }, view('private', [{ ...MAIN, enabled: false }, { ...PRIV, enabled: true }])), /data-pn-done="private"[^]*Notes is on Private, your private agent/);
  assert.match(nudgeStatus({ id: 'm', name: 'Notes', provider: 'Claude' }, view('private', [{ ...MAIN, enabled: true }])), /data-pn-done="standard"[^]*Notes is on Wizard with Claude for now/);
  assert.match(nudgeStatus({ id: 'm', name: 'Notes' }, view('private', [{ ...MAIN, enabled: false }, { ...PRIV, enabled: false }])), /data-pn-done="none"[^]*data-pv-choose/);
});

test('wizard-os#929: an app with only the personal_data label gets the card, and its own line of what it reads', () => {
  const mail = (agents, extra = {}) => view('standard', agents, { personal_data: true, personal_data_reads: 'reads your email', ...extra });
  assert.equal(personalApp(mail([])), true);
  assert.equal(personalApp(view('private', [])), true);
  assert.equal(personalApp(view('standard', [])), false, 'no declaration: not personal');
  assert.equal(nudgeDue(mail([{ ...MAIN, enabled: true }])), true, 'already on the standard agent: the card still recommends private AI');
  assert.equal(nudgeDue(mail([{ ...MAIN, enabled: true }, { ...PRIV, enabled: false }])), false, 'a private agent already: no card');
  assert.equal(nudgeDue(view('standard', [{ ...MAIN, enabled: true }], { personal_data: false })), false);
  assert.deepEqual(withStandard(mail([{ ...MAIN, enabled: true }])), ['hermes'], 'Use Claude for now keeps it where it is');
  const html = nudgeHtml({ id: 'wizard-mail', name: 'Mail', reads: 'reads your email', provider: 'Claude' });
  assert.match(html, /Mail reads your email\. We recommend private AI for apps like this, so no AI company sees it\./);
  assert.equal(personalSentence('Mail', ' reads  your email. '), 'Mail reads your email.');
  assert.equal(personalSentence('Photos', ''), 'Photos holds personal data.');
  assert.match(nudgeHtml({ id: 'm', name: 'M', reads: '<img src=x>' }), /M &lt;img src=x&gt;\./, 'the line is escaped');
});
