// Read-only "Your system" overview: agents, routines, agent apps/tools and connections, for the System app.
// Every value is rebuilt from validated scalars. Secrets never leave this module: credential files are read for the
// NAMES of configured services only, and unrecognized key names are dropped rather than shown.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const H = homedir();
const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');
const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

// Known key names → the service a person recognises. Anything not listed here is never shown.
export const KEY_SERVICES = [
  [/^BRIGHTDATA_/, 'brightdata', 'Bright Data', 'Web data'],
  [/^CLOUDFLARE_/, 'cloudflare', 'Cloudflare', 'Hosting'],
  [/^TINFOIL_/, 'tinfoil', 'Tinfoil', 'Private AI'],
  [/^FAL_/, 'fal', 'fal.ai', 'Images and video'],
  [/^CAL_API/, 'calcom', 'Cal.com', 'Calendar'],
  [/^TYPESAFE_/, 'typesafe', 'TypeSafe', 'AI tools'],
  [/^APIFY_/, 'apify', 'Apify', 'Web data'],
  [/^XERO_/, 'xero', 'Xero', 'Accounting'],
  [/^API_KEY_21ST$/, '21st', '21st.dev', 'Design'],
  [/^BWS_/, 'bitwarden', 'Bitwarden Secrets', 'Passwords'],
  [/^FIRECRAWL_/, 'firecrawl', 'Firecrawl', 'Web data'],
  [/^BROWSERBASE_/, 'browserbase', 'Browserbase', 'Browser'],
  [/^TELEGRAM_/, 'telegram', 'Telegram', 'Messaging'],
  [/^COMPANY_WIZARD_/, 'company-wizard', 'Company Wizard', 'Company'],
  [/^OPENROUTER_/, 'openrouter', 'OpenRouter', 'AI models'],
  [/^ELEVENLABS_/, 'elevenlabs', 'ElevenLabs', 'Voice'],
  [/^GITHUB_/, 'github', 'GitHub', 'Code'],
];
const PROVIDERS = {
  'openai-codex': ['chatgpt', 'ChatGPT', 'AI account'], 'xai-oauth': ['xai', 'xAI Grok', 'AI account'], copilot: ['copilot', 'GitHub Copilot', 'AI account'],
  openrouter: ['openrouter', 'OpenRouter', 'AI models'], anthropic: ['claude', 'Claude', 'AI account'], 'custom:tinfoil-private-operator': ['tinfoil', 'Tinfoil', 'Private AI'],
  nous: ['nous', 'Nous Portal', 'AI models'], gemini: ['gemini', 'Google Gemini', 'AI models'],
};
// MCP server names → friendly tool names (tool → connection it relies on).
const TOOLS = {
  privacy: ['Privacy', 'Keeps private data on private models', null], excalidraw: ['Excalidraw', 'Draws diagrams', null],
  firecrawl: ['Firecrawl', 'Reads websites', 'firecrawl'], brightdata: ['Bright Data', 'Searches and scrapes the web', 'brightdata'],
  'company-wizard': ['Company Wizard', 'Works with the company agent', 'company-wizard'], calcom: ['Cal.com', 'Books meetings', 'calcom'],
};
const MODEL_NAMES = [[/opus-5-5/, 'Claude Opus 5.5'], [/opus/, 'Claude Opus'], [/sonnet/, 'Claude Sonnet'], [/gpt-5\.6-sol/, 'GPT-5.6 Sol'], [/gpt-5\.5/, 'GPT-5.5'],
  [/grok-4\.5/, 'Grok 4.5'], [/grok-4\.3/, 'Grok 4.3'], [/kimi-k3/, 'Kimi K3'], [/glm-5-3/, 'GLM 5.3']];
export const modelName = m => { const s = str(m, 80); for (const [re, n] of MODEL_NAMES) if (re.test(s)) return n; return s.replace(/^[\w-]+\//, ''); };

// Tiny YAML reader for the two scalar fields we need (model.default/provider and mcp_servers keys). No secrets read.
export function configFacts(text) {
  const lines = String(text || '').split('\n');
  let model = '', provider = '', inModel = false, inMcp = false; const mcp = [];
  for (const l of lines) {
    if (/^\S/.test(l)) { inModel = /^model:\s*$/.test(l); inMcp = /^mcp_servers:\s*$/.test(l); const m = l.match(/^model:\s*(\S.*)$/); if (m) model = m[1]; continue; }
    if (inModel) { const d = l.match(/^\s{2}default:\s*(\S+)/); if (d) model = d[1]; const p = l.match(/^\s{2}provider:\s*(\S+)/); if (p) provider = p[1]; }
    if (inMcp) { const k = l.match(/^\s{2}([A-Za-z0-9_-]+):\s*$/); if (k) mcp.push(k[1]); }
  }
  return { model: model.replace(/['"]/g, ''), provider: provider.replace(/['"]/g, ''), mcp };
}
export const envKeyNames = text => String(text || '').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#') && l.includes('='))
  .filter(l => l.slice(l.indexOf('=') + 1).trim() !== '').map(l => l.slice(0, l.indexOf('=')).replace(/^export\s+/, '').trim());

export function buildOverview(src) {
  const facts = configFacts(src.config);
  const agentName = str(src.settings?.agent?.name, 40) || 'Hermes';
  const agents = [{ id: 'main', name: agentName, kind: 'Hermes Agent', model: modelName(facts.model), status: src.gatewayUp ? 'running' : 'unknown', main: true }];
  for (const p of src.profiles || []) if (ID.test(p.name)) agents.push({ id: 'p-' + p.name, name: p.name, kind: 'Agent profile', model: modelName(p.model), status: 'idle' });

  const routines = (src.jobs || []).filter(j => j && j.enabled === true && typeof j.name === 'string').slice(0, 200).map(j => ({
    id: str(j.id, 40) || str(j.name, 40), name: str(j.name, 90), when: str(j.schedule_display || (typeof j.schedule === 'string' ? j.schedule : ''), 40),
    status: ['ok', 'error'].includes(j.last_status) ? j.last_status : 'new', lastRun: str(j.last_run_at, 40), nextRun: str(j.next_run_at, 40),
  }));

  // Connections: AI accounts (live status), signed-in providers and API keys, de-duplicated by service id.
  const conns = new Map();
  const add = (id, name, group, extra = {}) => { if (!conns.has(id)) conns.set(id, { id, name, group, status: 'connected', ...extra }); };
  for (const p of src.aiUsage?.providers || []) {
    const id = str(p.id, 40); if (!ID.test(id)) continue;
    const name = str(p.name, 40), plan = str(p.plan, 20);
    add(id, name, 'AI account', { status: p.status === 'ok' ? 'connected' : 'attention', detail: plan ? plan + ' plan' : '', ai: true });
  }
  const aiIds = [...conns.keys()];
  for (const prov of src.providers || []) { const m = PROVIDERS[prov]; if (!m) continue; if (m[0] === 'chatgpt' && aiIds.some(i => i.startsWith('codex'))) continue; if (m[0] === 'claude' && conns.has('claude')) continue; add(m[0], m[1], m[2]); }
  for (const k of src.envKeys || []) { const hit = KEY_SERVICES.find(([re]) => re.test(k)); if (hit) add(hit[1], hit[2], hit[3]); }

  // Agent apps: installed Runtipi apps (one per id, running copy preferred) plus agent tools (MCP servers).
  const apps = new Map();
  for (const x of src.installed || []) {
    const id = str(x?.info?.id, 64); if (!ID.test(id)) continue;
    const prev = apps.get(id), status = str(x?.app?.status, 20) || 'unknown';
    if (prev && prev.status === 'running') continue;
    apps.set(id, { id, name: str(x.info.name, 60).replace(/\s*\(Testing\)$/, '') || id, kind: 'Agent app', summary: str(x.info.short_desc, 160), status, screen: x.info.no_gui === false, uses: [] });
  }
  for (const a of src.appsJson?.apps || []) {
    const id = str(a?.id, 64); if (!ID.test(id)) continue;
    const cur = apps.get(id) || { id, name: str(a.name, 60) || id, kind: 'Agent app', status: str(a.status, 20) || 'unknown', screen: false };
    cur.summary = cur.summary || str(a.summary, 160);
    cur.uses = (Array.isArray(a.uses) ? a.uses : []).filter(u => typeof u === 'string' && ID.test(u)).slice(0, 12);
    apps.set(id, cur);
  }
  for (const name of facts.mcp) {
    const t = TOOLS[name]; if (!t || !ID.test(name)) continue;
    apps.set('tool-' + name, { id: 'tool-' + name, name: t[0], kind: 'Agent tool', summary: t[1], status: 'connected', screen: false, uses: t[2] && conns.has(t[2]) ? ['conn:' + t[2]] : [] });
  }
  const views = (src.views || []).filter(v => v && ID.test(v.id || '') && v.url).map(v => ({ id: v.id, name: str(v.name, 40) }));
  return {
    schema: 1, generatedAt: new Date(src.now || Date.now()).toISOString(),
    views, agents, routines, apps: [...apps.values()], connections: [...conns.values()],
  };
}

const read = (p, fallback = '') => { try { return readFileSync(p, 'utf8'); } catch { return fallback; } };
const readJson = (p, fallback = null) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fallback; } };

/** Gathers real sources. fetchJson is used for loopback Agent Service reads only. */
export async function gatherSources({ fetchJson, readInstalled } = {}) {
  const hermes = join(H, '.hermes');
  const profiles = [];
  try {
    for (const name of readdirSync(join(hermes, 'profiles')).sort()) {
      const facts = configFacts(read(join(hermes, 'profiles', name, 'config.yaml')));
      profiles.push({ name, model: facts.model });
    }
  } catch {}
  const jobsDoc = readJson(join(hermes, 'cron', 'jobs.json'), {});
  const auth = readJson(join(hermes, 'auth.json'), {});
  const settled = async (p) => { try { return await p; } catch { return null; } };
  const [aiUsage, viewsDoc, installed] = await Promise.all([
    settled(fetchJson?.('/wizard/ai-usage')), settled(fetchJson?.('/wizard/v1/apps')), settled(readInstalled?.()),
  ]);
  return {
    config: read(join(hermes, 'config.yaml')), settings: readJson(join(H, '.wizard-os', 'settings.json'), {}), profiles,
    jobs: Array.isArray(jobsDoc) ? jobsDoc : jobsDoc?.jobs || [],
    providers: [...new Set([...Object.keys(auth?.providers || {}), ...Object.keys(auth?.credential_pool || {})])],
    envKeys: envKeyNames(read(join(hermes, '.env'))), aiUsage, views: viewsDoc?.apps || [], installed: installed?.installed || [],
    appsJson: readJson(join(H, '.wizard-os', 'apps.json'), {}), gatewayUp: existsSync(join(hermes, 'gateway.pid')) || !!aiUsage,
  };
}
