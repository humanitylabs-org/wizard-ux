/* Wizard OS — Chats kit: message parsing, Markdown, Bangkok time, per-thread drafts,
 * copy/share, and the in-app media viewer. Loaded before app.js, which wires it into the
 * Chats window. Behaviour follows wizard-mobile ff86db8c (normalizers.ts, MarkdownMessage.tsx,
 * MediaViewers.tsx, CopyableTextBlock.tsx, sharing.ts, threadTimestamp.ts). */
(() => {
  'use strict';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const K = { notify: () => {}, onChange: () => {} };

  /* ================= message parsing ================= */
  const INTERNAL = ['[IMPORTANT: Background process ', '[ASYNC DELEGATION BATCH COMPLETE', '[Wizard follow-through] The delegated results', '[CONTEXT COMPACTION', '[CONTEXT SUMMARY]:', '[PRIOR CONTEXT', '[Your active task list was preserved', '[Your previous agent loop was paused', '[James requested recovery', '[OUT-OF-BAND', '[SYSTEM:'];
  const partsText = c => typeof c === 'string' ? c
    : Array.isArray(c) ? c.map(p => typeof p === 'string' ? p : p && typeof p === 'object' && typeof p.text === 'string' ? p.text : '').filter(Boolean).join('\n')
    : c && typeof c === 'object' ? String(c.text || c.content || '') : '';
  const SAFE_ID = /^[A-Za-z0-9._:-]+$/;
  function chipFiles(s) {
    const out = [];
    for (const m of String(s).matchAll(/\[WIZARD_FILE_CHIPS_V1\]\s*([\s\S]*?)\s*\[\/WIZARD_FILE_CHIPS_V1\]/g)) {
      try {
        for (const f of JSON.parse(m[1])) {
          const id = SAFE_ID.test(String(f?.id || '')) ? String(f.id) : '';
          if (id && out.some(x => x.id === id)) continue;
          out.push({ id, name: String(f?.filename || f?.name || 'file'), mime: String(f?.mime || ''), bytes: Number(f?.bytes) || 0 });
        }
      } catch (e) { /* a malformed marker is hidden, not shown */ }
    }
    return out.slice(0, 8);
  }
  // <helm_attachments>{"items":[…]}</helm_attachments>: port of normalizers.ts helmPresentation.
  const HELM = /<\s*(\/?)\s*helm_attachments\s*>/gi;
  const HELM_ID = /^[0-9a-f]{32}$/;
  const kindOf = (mime, kind) => mime.startsWith('image/') ? 'image' : mime.startsWith('audio/') ? 'audio' : mime.startsWith('video/') ? 'video' : kind === 'video' ? 'video' : 'file';
  function helm(value) {
    const source = String(value || '').replace(/^\[Workspace::v1: [^\]\r\n]+\]\s*/, '').trim();
    const blocks = [], visible = []; let cursor = 0, start = null, found = false;
    for (const m of source.matchAll(HELM)) {
      found = true; const end = m.index + m[0].length;
      if (m[1] !== '/') { if (start === null) visible.push(source.slice(cursor, m.index)); start = end; continue; }
      if (start === null) { cursor = end; continue; }
      blocks.push(source.slice(start, m.index)); start = null; cursor = end;
    }
    if (!found) return { text: source, attachments: [] };
    if (start === null) visible.push(source.slice(cursor));
    const attachments = [];
    for (const raw of blocks) {
      try {
        const p = JSON.parse(raw);
        for (const it of Array.isArray(p?.items) ? p.items : []) {
          if (!it || typeof it !== 'object') continue;
          const id = typeof it.id === 'string' ? it.id : '', name = typeof it.name === 'string' ? it.name.trim().slice(0, 120) : '';
          const mime = typeof it.mime === 'string' ? it.mime.trim().toLowerCase().slice(0, 160) : '';
          if (!HELM_ID.test(id) || !name || !mime || attachments.some(a => a.id === id)) continue;
          attachments.push({ id, name, mime, kind: kindOf(mime, typeof it.kind === 'string' ? it.kind : ''), bytes: Number(it.bytes) || 0, url: `/wizard/attachments/${id}`,
            transcript: mime.startsWith('audio/') && typeof it.transcript === 'string' ? it.transcript.replace(/\s+/g, ' ').trim().slice(0, 4000) : '' });
          if (attachments.length === 16) break;
        }
      } catch (e) { /* malformed metadata stays hidden */ }
    }
    return { text: visible.join('').replace(/\n{3,}/g, '\n\n').trim(), attachments };
  }
  /* This Wizard's own addresses. Links into it are written as paths ("/cinequeue/") so they open on whatever
   * address this device reached Wizard through (localhost on the Mac, the tailnet name on a phone). Absolute
   * links to this box's other names (the current host, or a retired custom domain listed in the bootstrap's
   * network.aliases) are folded back to paths, so old messages keep opening in place after a rename. */
  const LEGACY_HOME_HOSTS = ['legacy.wizard.example'];
  function homeHosts() {
    const out = new Set([location.hostname, ...LEGACY_HOME_HOSTS]);
    try { for (const h of (window.WizConfig?.raw?.network?.aliases || [])) if (typeof h === 'string' && h) out.add(h.toLowerCase()); } catch (e) {}
    return out;
  }
  // Absolute https link to this Wizard → '/path?query#hash'; anything else unchanged.
  function homePath(href) {
    const s = String(href || '').trim();
    if (!/^https:\/\//i.test(s)) return s;
    let u; try { u = new URL(s); } catch (e) { return s; }
    return homeHosts().has(u.hostname.toLowerCase()) && (!u.port || u.port === location.port) ? u.pathname + u.search + u.hash : s;
  }
  const isHomeUrl = u => !!u && (u.origin === location.origin || (u.protocol === 'https:' && homeHosts().has(u.hostname.toLowerCase())));
  const SAFE_IMG = /^(data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$|\/(?![\/\\]))/i; // inline data, or a path on this Wizard
  // Inline image parts: OpenAI image_url / input_image, Anthropic base64 image, legacy image_urls.
  function imagesOf(m, content) {
    const urls = [];
    const add = u => { u = typeof u === 'string' ? u : u && typeof u === 'object' ? (u.url || u.image_url || '') : ''; if (typeof u === 'string') u = homePath(u); if (typeof u === 'string' && u && SAFE_IMG.test(u) && !urls.includes(u)) urls.push(u); };
    if (Array.isArray(content)) for (const p of content) {
      if (!p || typeof p !== 'object') continue;
      if (p.type === 'image_url') add(p.image_url);
      else if (p.type === 'input_image') add(p.image_url ?? p.url);
      else if (p.type === 'image') { if (p.source?.type === 'base64' && p.source.data) add(`data:${p.source.media_type || 'image/png'};base64,${p.source.data}`); else add(p.url ?? p.image_url ?? p.image); }
    }
    for (const k of ['image_urls', 'imageUrls', 'images']) if (Array.isArray(m?.[k])) m[k].forEach(add);
    return urls.slice(0, 8);
  }
  const cleanText = s => String(s || '')
    .replace(/\[WIZARD_FILES_V1\][\s\S]*?\[\/WIZARD_FILES_V1\]/g, '')
    .replace(/\[WIZARD_FILE_CHIPS_V1\][\s\S]*?\[\/WIZARD_FILE_CHIPS_V1\]/g, '')
    .replace(/\[WIZARD_CLOSE_AND_FILE_V1\][\s\S]*?\[\/WIZARD_CLOSE_AND_FILE_V1\]/g, '')
    .replace(/\[WIZARD_IMAGE_INTENT_V1\][\s\S]*?\[\/WIZARD_IMAGE_INTENT_V1\]/g, '')
    .replace(/<memory-context>[\s\S]*?<\/memory-context>/g, '')
    .replace(/^\[Workspace::v1: [^\]\r\n]+\]\s*/, '')
    .replace(/\n*\[Browser dogfooding policy[\s\S]*$/, '')
    .trim();
  // Hermes delivers a steer as its own user row wrapped in this marker (agent/prompt_builder.py STEER_MARKER_*).
  const STEER_OPEN = '[OUT-OF-BAND USER MESSAGE';
  const steerText = s => cleanText(String(s || '')
    .replace(/^\s*\[OUT-OF-BAND USER MESSAGE[^\]\n]*\]\s*/, '')
    .replace(/\s*\[\/OUT-OF-BAND USER MESSAGE\]\s*$/, ''));
  // A note another agent thread wrote into this one (a coordinator's "[Wizard follow-through] Cross-thread note from
  // the "X" thread…", or the same note delivered mid-run as a steer). It is not the owner speaking: it gets its own
  // labelled row, and a note that started a turn opens a new turn so the reply sits under the note that prompted it,
  // never under the owner's last real message (which then read as hours of work and a reply to the wrong thing).
  const NOTE_FROM_Q = /^Cross-thread note from (?:the )?["\u201c]([^"\u201d\n]{1,80})["\u201d]/i;
  const NOTE_FROM = /^Cross-thread note from (?:the )?([^.:(\n"\u201c]{1,60}?) (?:thread|coordinator)\b/i;
  function agentNote(raw) {
    const s0 = String(raw || '').trimStart();
    const ft = s0.startsWith('[Wizard follow-through]');
    if (ft && /^\[Wizard follow-through\]\s*The delegated results/.test(s0)) return null; // the watcher's own nudge stays internal
    const body = (s0.startsWith(STEER_OPEN) ? steerText(s0) : cleanText(s0.replace(/^\[Wizard follow-through\]\s*/, ''))).replace(/^\[(Cross-thread note[^\]\n]{0,120})\]\s*/i, '$1. ');
    if (!ft && !/^Cross-thread note\b/i.test(body)) return null;
    if (!body) return null;
    const m = body.match(NOTE_FROM_Q) || body.match(NOTE_FROM);
    return { text: body, from: m ? m[1].trim() : '' };
  }
  const tsMs = v => typeof v === 'number' && isFinite(v) ? (Math.abs(v) < 1e12 ? v * 1000 : v) : (Date.parse(String(v ?? '')) || NaN);
  // The turn already ended with a final reply (no tool calls) and work starts again a while later with no new message
  // from the owner: a coordinator note, a helper finishing, or a watcher started a new run. That is a new turn. Folding
  // it into the old one hid the real answer under "Worked for 9h" and showed the late reply as the answer to the
  // owner's question. Recovery nudges within a minute of the reply stay in the same turn.
  const LATER_MS = 60000;
  const later = (cur, at) => !!(cur && cur.a && cur.a.final && isFinite(at) && isFinite(cur.a.at) && at - cur.a.at >= LATER_MS);
  // One turn = what the owner said (words, photos, files), the work in between, the answer and anything the agent sent.
  function parseRows(rows) {
    const out = []; let cur = null;
    const newTurn = u => { cur = { u, a: null, notes: [], steps: 0, media: [], at: u?.at, work: [], steers: [] }; out.push(cur); return cur; };
    for (const m of rows || []) {
      const kind = m.display_kind || '';
      const content = m.display_content ?? m.content;
      const raw = partsText(content);
      const at = tsMs(m.timestamp ?? m.created_at);
      if (m.role === 'user') {
        const isSteer = kind === 'steer' || raw.trimStart().startsWith(STEER_OPEN);
        const note = agentNote(raw);
        // An agent note that started a turn: its own turn, labelled, so the reply below answers it.
        if (note && !isSteer) { if (!(cur && cur.note && cur.note.text === note.text && !cur.a)) { newTurn(null); cur.at = at; cur.note = { ...note, at }; } continue; }
        // A mid-run steer the agent has taken in: shown inside the turn it steered, marked as received.
        if (isSteer) {
          const st = note ? note.text : steerText(raw);
          if (st && cur && !cur.steers.some(x => x.text === st)) cur.steers.push(note ? { text: st, at, files: [], note: true, from: note.from } : { text: st, at, files: chipFiles(raw) });
          if (cur) cur.steps++;
          continue;
        }
        if (kind || INTERNAL.some(p => raw.trimStart().startsWith(p))) { if (cur) cur.steps++; continue; }
        const files = chipFiles(raw), images = imagesOf(m, content);
        let t = helm(cleanText(raw)).text;
        const hasImage = images.length || files.some(f => /^image\//.test(f.mime));
        if ((files.length || images.length) && /^Please use the attached (file|files)\.$/.test(t)) t = '';
        if (hasImage) t = t.replace(/^\s*\[screenshot\]\s*$/gmi, '').replace(/\n{3,}/g, '\n\n').trim();
        if (!t && !files.length && !images.length) continue;
        newTurn({ text: t, files, images, at });
      } else if (m.role === 'assistant') {
        const h = helm(cleanText(raw));
        const t = h.text;
        if (!cur) newTurn(null);
        else if (later(cur, at)) { const prev = cur; newTurn(null); cur.at = at; cur.later = { at, after: prev.a.at }; }
        noteWork(cur, m, at);
        for (const a of h.attachments) if (!cur.media.some(x => x.id === a.id)) cur.media.push(a);
        for (const u of imagesOf(m, content)) if (!cur.media.some(x => x.url === u)) cur.media.push({ id: u.slice(-24), name: 'Image', mime: 'image/*', kind: 'image', url: u });
        if (h.attachments.length && !cur.mediaAt) cur.mediaAt = at;
        if (!t) { if (!h.attachments.length) cur.steps++; continue; }
        if (kind === 'commentary') { cur.notes.push(t); cur.steps++; continue; }
        if (cur.a) cur.notes.push(cur.a.text);
        cur.a = { text: t, at, final: !(Array.isArray(m.tool_calls) && m.tool_calls.length) };
      } else if (cur) { if (later(cur, at)) { const prev = cur; newTurn(null); cur.at = at; cur.later = { at, after: prev.a.at }; } cur.steps++; noteWork(cur, m, at); }
    }
    return out;
  }
  // What the work between a request and its answer was made of (the work receipt reads this, chat-work.js):
  // named tool calls (display_label from the Agent Service), their results, the plan and clarify questions.
  function noteWork(cur, m, at) {
    const calls = Array.isArray(m.tool_calls) ? m.tool_calls.map(c => ({ id: String(c?.id || ''), label: String(c?.display_label || c?.function?.name || ''), question: c?.question || null })).filter(c => c.id || c.label) : [];
    const ev = { at, role: m.role, kind: m.display_kind || '' };
    if (calls.length) ev.calls = calls;
    if (m.role === 'tool') { ev.callId = String(m.tool_call_id || ''); if (Array.isArray(m.plan)) ev.plan = m.plan; if (m.question && typeof m.question === 'object') ev.question = m.question; }
    if (cur.work.length < 2000) cur.work.push(ev);
  }

  /* ================= Markdown (GFM subset, no raw HTML) ================= */
  const SAFE_HREF = /^(https?:|mailto:|tel:)/i;
  // A path on this Wizard ("/cinequeue/"), never a protocol-relative "//host" or a "/\\host" trick.
  const HOME_PATH = /^\/(?![\/\\])[^\s]*$/;
  const SESSION_REF = /@session:default\/([A-Za-z0-9_](?:[A-Za-z0-9._:-]{0,178}[A-Za-z0-9_])?)/g;
  const SESSION_HREF = /^\/wizard\/\?session=([A-Za-z0-9._:%-]{1,240})$/;
  const PRIVATE_MEDIA = /^(\/wizard\/(?:files\/[A-Za-z0-9._:-]+\/content|attachments\/[0-9a-f]{32}))$/;
  function linkHtml(href, inner) {
    href = homePath(href);
    const sm = href.match(SESSION_HREF);
    if (sm) { let id = ''; try { id = decodeURIComponent(sm[1]); } catch (e) {} if (/^[A-Za-z0-9._:-]{1,200}$/.test(id)) return `<a href="/wizard/?session=${encodeURIComponent(id)}" class="wsl" data-session="${esc(id)}">${inner}</a>`; }
    const pm = href.match(PRIVATE_MEDIA);
    if (pm) return `<a href="${esc(pm[1])}" data-mlink="${esc(pm[1])}">${inner}</a>`;
    if (SAFE_HREF.test(href) || HOME_PATH.test(href)) return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
    return `<span class="badlink">${inner}</span>`;
  }
  function inline(src, noLinks) {
    const ph = []; const put = h => `\u0001${ph.push(h) - 1}\u0002`;
    let s = String(src);
    s = s.replace(/\\([\\`*_{}\[\]()#+\-.!~|>])/g, (_, c) => put(esc(c)));
    s = s.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_, _t, code) => put(`<code>${esc(code.replace(/^ ([\s\S]*) $/, '$1'))}</code>`));
    if (!noLinks) {
      s = s.replace(/!\[([^\]\n]*)\]\(\s*<?([^\s)>]+)>?(?:\s+"[^"]*")?\s*\)/g, (_, alt, url) => put(PRIVATE_MEDIA.test(url) ? linkHtml(url, esc(alt ? `[Image: ${alt}]` : '[Image]')) : `<span class="md-img">${esc(alt ? `[Image: ${alt}]` : '[Image]')}</span>`));
      s = s.replace(/\[((?:[^\[\]\n]|\[[^\]\n]*\])+)\]\(\s*<?([^\s)>]+?(?:\([^\s)]*\)[^\s)>]*)?)>?(?:\s+"[^"]*")?\s*\)/g, (_, text, url) => put(linkHtml(url, inline(text, true))));
      s = s.replace(/<((?:https?:\/\/|mailto:)[^\s>]+)>/g, (_, u) => put(linkHtml(u, esc(u))));
      s = s.replace(/(^|[\s(“"'])(https?:\/\/[^\s<>"']*[^\s<>"'.,;:!?)\]’”])/g, (_, pre, u) => pre + put(linkHtml(u, esc(u))));
      s = s.replace(SESSION_REF, (m, id) => put(`<a href="/wizard/?session=${encodeURIComponent(id)}" class="wsl" data-session="${esc(id)}">${esc(m)}</a>`));
    }
    let h = esc(s)
      .replace(/\*\*\*(?=\S)([\s\S]*?\S)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1<strong>$2</strong>')
      .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')
      .replace(/(^|[^*\w])\*(?=[^\s*])([\s\S]*?[^\s*\\])\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/(^|[^*\w])\*([^\s*])\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/(^|[^\w])_(?=[^\s_])([\s\S]*?[^\s_])_(?!\w)/g, '$1<em>$2</em>');
    for (let k = 0; k < 3 && /\u0001\d+\u0002/.test(h); k++) h = h.replace(/\u0001(\d+)\u0002/g, (_, n) => ph[+n]);
    return h;
  }
  const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/;
  const HEAD = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*#*[ \t]*$/;
  const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
  const QUOTE = /^ {0,3}> ?(.*)$/;
  const LI = /^( {0,16})([-*+•]|\d{1,9}[.)])(?:[ \t]+(.*)|$)/;
  const TSEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
  const isTable = (lines, i) => lines[i].includes('|') && i + 1 < lines.length && lines[i + 1].includes('|') && TSEP.test(lines[i + 1]);
  const startsBlock = (lines, i) => { const l = lines[i]; return FENCE.test(l) || HEAD.test(l) || HR.test(l) || QUOTE.test(l) || LI.test(l) || isTable(lines, i); };
  const cells = row => { let r = row.trim(); if (r.startsWith('|')) r = r.slice(1); if (r.endsWith('|') && !r.endsWith('\\|')) r = r.slice(0, -1); return r.split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|')); };
  function codeBlock(code, lang) {
    return `<div class="code"><div class="code-h"><span>${esc(lang || 'Code')}</span><button type="button" data-codecopy>Copy</button><button type="button" data-codeshare>Share</button></div><pre><code>${esc(code)}</code></pre></div>`;
  }
  function list(lines, i, depth) {
    const first = lines[i].match(LI), base = first[1].length, ordered = /\d/.test(first[2]);
    const start = ordered ? parseInt(first[2], 10) : 1;
    const items = []; let cur = null, loose = false;
    const sibling = m => m && m[1].length >= base && m[1].length < base + 2 && /\d/.test(m[2]) === ordered && !HR.test(m[0]);
    while (i < lines.length) {
      const l = lines[i], m = l.match(LI);
      if (m && m[1].length < base + 2 && !HR.test(l)) {
        if (!sibling(m)) break;
        cur = { lines: [m[3] || ''], ci: m[1].length + m[2].length + 1 }; items.push(cur); i++; continue;
      }
      if (!l.trim()) {
        let j = i + 1; while (j < lines.length && !lines[j].trim()) j++;
        if (j >= lines.length) break;
        const ind = lines[j].match(/^ */)[0].length;
        if (ind >= cur.ci || sibling(lines[j].match(LI))) { loose = loose || !(ind >= cur.ci && LI.test(lines[j])); cur.lines.push(''); i++; continue; }
        break;
      }
      const ind = l.match(/^ */)[0].length;
      if (ind > base) { cur.lines.push(l.slice(Math.min(ind, cur.ci))); i++; continue; }
      if (!startsBlock(lines, i) && cur.lines[cur.lines.length - 1].trim()) { cur.lines.push(l); i++; continue; }
      break;
    }
    const tag = ordered ? 'ol' : 'ul';
    const lis = items.map(it => {
      let task = '';
      const t = it.lines[0].match(/^\[([ xX])\][ \t]+(.*)$/);
      if (t) { task = `<span class="tick${t[1] === ' ' ? '' : ' on'}" aria-hidden="true"></span>`; it.lines[0] = t[2]; }
      while (it.lines.length && !it.lines[it.lines.length - 1].trim()) it.lines.pop();
      let h = blocks(it.lines, depth + 1);
      if (!loose) h = h.replace(/^<p>([\s\S]*?)<\/p>/, '$1');
      return `<li${task ? ' class="task"' : ''}>${task}${h}</li>`;
    }).join('');
    return { html: `<${tag}${ordered && start !== 1 ? ` start="${start}"` : ''}>${lis}</${tag}>`, i };
  }
  function blocks(lines, depth = 0) {
    let out = '', i = 0, m;
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) { i++; continue; }
      if (depth > 10) { out += `<p>${inline(lines.slice(i).join('\n')).replace(/\n/g, '<br>')}</p>`; break; }
      if ((m = l.match(FENCE))) {
        const close = new RegExp(`^ {0,3}${m[1][0] === '`' ? '`' : '~'}{${m[1].length},}\\s*$`);
        const body = []; i++;
        while (i < lines.length && !close.test(lines[i])) body.push(lines[i++]);
        i++; out += codeBlock(body.join('\n'), m[2]); continue;
      }
      if ((m = l.match(HEAD))) { const n = m[1].length; out += `<h${n}>${inline(m[2] || '')}</h${n}>`; i++; continue; }
      if (HR.test(l)) { out += '<hr>'; i++; continue; }
      if (QUOTE.test(l)) {
        const body = [];
        while (i < lines.length && lines[i].trim() && ((m = lines[i].match(QUOTE)) || !startsBlock(lines, i))) { body.push(m ? m[1] : lines[i]); m = null; i++; }
        out += `<blockquote>${blocks(body, depth + 1)}</blockquote>`; continue;
      }
      if (isTable(lines, i)) {
        const head = cells(lines[i]), al = cells(lines[i + 1]).map(c => /^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : /^:/.test(c) ? 'left' : '');
        const td = (tag, c, k) => `<${tag}${al[k] ? ` style="text-align:${al[k]}"` : ''}>${inline(c)}</${tag}>`;
        i += 2; const rows = [];
        while (i < lines.length && lines[i].trim() && lines[i].includes('|') && !FENCE.test(lines[i])) rows.push(cells(lines[i++]));
        out += `<div class="tbl"><table><thead><tr>${head.map((c, k) => td('th', c, k)).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${head.map((_, k) => td('td', r[k] ?? '', k)).join('')}</tr>`).join('')}</tbody></table></div>`;
        continue;
      }
      if (LI.test(l)) { const r = list(lines, i, depth); out += r.html; i = r.i; continue; }
      const para = [];
      while (i < lines.length && lines[i].trim() && !(para.length && startsBlock(lines, i))) para.push(lines[i++].trim());
      out += `<p>${inline(para.join('\n')).replace(/\n/g, '<br>')}</p>`;
    }
    return out;
  }
  const md = src => blocks(String(src || '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n'));

  /* ================= Bangkok time ================= */
  const TZ = () => (window.WizConfig && window.WizConfig.timeZone && window.WizConfig.timeZone()) || 'UTC';
  // Formatters are built per zone on first use, never at load: the settings zone (bootstrap) can land
  // after this file runs, and a first launch must not keep showing the device's zone.
  const O_DAY = [{ year: 'numeric', month: '2-digit', day: '2-digit' }, 'en-CA'], O_TIME = [{ hour: '2-digit', minute: '2-digit', hour12: false }];
  // Month first with commas (James, 11 Oct): "Thu, Oct 8", "Thu, Oct 8, 2025"; a stamp adds ", 20:48".
  const O_DATE = [{ weekday: 'short', month: 'short', day: 'numeric' }, 'en-US'], O_DATEY = [{ weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }, 'en-US'];
  const O_FULL = [{ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }];
  // Each formatter is rebuilt only when the zone changes.
  const F = o => { const z = TZ(); if (o.z !== z) { o.f = new Intl.DateTimeFormat(o[1] || 'en-GB', { timeZone: z, ...o[0] }); o.z = z; } return o.f; };
  const time = {
    ms: tsMs,
    dayKey: ms => isFinite(ms) ? F(O_DAY).format(ms) : '',
    clock: ms => isFinite(ms) ? F(O_TIME).format(ms) : '',
    day(ms, now = Date.now()) {
      if (!isFinite(ms)) return '';
      const D = F(O_DAY), k = D.format(ms);
      if (k === D.format(now)) return 'Today';
      if (k === D.format(now - 864e5)) return 'Yesterday';
      return F(k.slice(0, 4) === D.format(now).slice(0, 4) ? O_DATE : O_DATEY).format(ms);
    },
    full: ms => isFinite(ms) ? `${F(O_FULL).format(ms)} Bangkok` : '',
    // Message stamp (James, 11 Oct): today's messages show only the time; any other day shows its date
    // too ("Thu, Oct 8, 18:16"; year added outside the current year), so a scrolled-to message is never
    // ambiguous when its day divider is off screen.
    stamp(ms, now = Date.now()) {
      if (!isFinite(ms)) return '';
      const D = F(O_DAY), k = D.format(ms), clk = F(O_TIME).format(ms);
      if (k === D.format(now)) return clk;
      return `${F(k.slice(0, 4) === D.format(now).slice(0, 4) ? O_DATE : O_DATEY).format(ms)}, ${clk}`;
    },
  };

  /* ================= drafts: one per thread, kept across reloads ================= */
  const DRAFT_KEY = 'wos.chat.drafts.v1';
  const drafts = {
    all() { try { const v = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; } },
    get(k) {
      const d = this.all()[k];
      return { text: typeof d?.text === 'string' ? d.text : '', files: Array.isArray(d?.files) ? d.files.filter(f => f && SAFE_ID.test(String(f.id || ''))).slice(0, 8) : [] };
    },
    set(k, text, files) {
      if (!k) return;
      const all = this.all();
      const fs = (files || []).filter(f => f && f.id && !f.uploading).map(f => ({ id: f.id, name: f.name, mime: f.mime, bytes: f.bytes })).slice(0, 8);
      text = String(text || '');
      if (!text.trim() && !fs.length) delete all[k];
      else all[k] = { text: text.slice(0, 64000), files: fs, at: Date.now() };
      const keys = Object.keys(all).sort((a, b) => (all[b].at || 0) - (all[a].at || 0));
      for (const x of keys.slice(200)) delete all[x];
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify(all)); } catch (e) { /* a draft must never block typing */ }
    },
    clear(k) { this.set(k, '', []); },
  };

  /* ================= copy / share / save ================= */
  async function copyText(text) {
    text = String(text ?? '');
    try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; } } catch (e) { /* fall back below */ }
    const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0'; document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
    let ok = false; try { ok = document.execCommand('copy'); } catch (e) {} ta.remove(); return ok;
  }
  const native = () => window.WizardOSNative || null;
  // Native success needs a receipt, not a fire-and-forget invocation. Older Android
  // bridges still launch the sheet, but cannot attest selection/cancellation (unsupported).
  const shareOutcome = value => {
    if (typeof value === 'string') { try { value = JSON.parse(value); } catch (_) {} }
    const status = typeof value === 'object' && value ? value.status || value.outcome : value;
    return ['shared', 'copied', 'cancelled', 'unsupported'].includes(status) ? status : 'unsupported';
  };
  async function nativeShare(invoke) {
    let timer;
    try {
      const result = invoke(); // immediate, while transient user activation is live
      return shareOutcome(await Promise.race([Promise.resolve(result), new Promise(resolve => { timer = setTimeout(() => resolve('unsupported'), 15000); })]));
    } catch (e) { return e?.name === 'AbortError' ? 'cancelled' : 'unsupported'; }
    finally { clearTimeout(timer); }
  }
  async function sharePayload(data = {}) {
    if (!data || typeof data !== 'object') return 'unsupported';
    const payload = {};
    for (const k of ['text', 'title', 'url']) if (data[k] != null && String(data[k])) payload[k] = String(data[k]);
    if ((!payload.text && !payload.url) || (payload.text || '').length > 90000 || (payload.title || '').length > 1024 || (payload.url || '').length > 8192) return 'unsupported';
    if (payload.url) { try { const parsed = new URL(payload.url, location.href); if (!/^https?:$/.test(parsed.protocol)) return 'unsupported'; if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(payload.url)) payload.url = parsed.href; } catch (_) { return 'unsupported'; } }
    const n = native();
    if (n && typeof n.shareText === 'function') {
      // ACTION_SEND has one EXTRA_TEXT field: don't silently lose a URL or turn it into a title.
      const text = [payload.text, payload.url].filter(Boolean).join('\n');
      return nativeShare(() => n.shareText(text, payload.title || ''));
    }
    if (navigator.share) { try { await navigator.share(payload); return 'shared'; } catch (e) { if (e?.name === 'AbortError') return 'cancelled'; return 'unsupported'; } }
    return (await copyText([payload.text, payload.url].filter(Boolean).join('\n'))) ? 'copied' : 'unsupported';
  }
  function shareText(text, title) { return sharePayload({ text, title }); }
  async function fetchBlob(url) {
    if (url.startsWith('data:')) { const r = await fetch(url); return r.blob(); }
    const r = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.blob();
  }
  const b64 = blob => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.onerror = rej; fr.readAsDataURL(blob); });
  const extFor = mime => ({ 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' }[mime] || '');
  async function asFile(item) {
    const blob = await fetchBlob(item.url);
    const type = blob.type || item.mime || 'application/octet-stream';
    let name = item.name && item.name !== 'Image' ? item.name : `wizard-image${extFor(type) || '.png'}`;
    if (extFor(type) && !/\.[a-z0-9]{2,5}$/i.test(name)) name += extFor(type); // a search title has no extension
    return new File([blob], name, { type });
  }
  async function shareFile(item, { title } = {}) {
    let file;
    const isBlob = value => value && ['[object Blob]', '[object File]'].includes(Object.prototype.toString.call(value));
    try { file = isBlob(item) ? item : await asFile(item); } catch (_) { return 'unsupported'; }
    if (!isBlob(file) || file.size > 32 * 1024 * 1024) return 'unsupported';
    const n = native(), name = file.name || 'wizard-file';
    if (n && typeof n.shareFile === 'function') {
      let bytes; try { bytes = await b64(file); } catch (_) { return 'unsupported'; }
      return nativeShare(() => n.shareFile(bytes, name, file.type));
    }
    try {
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: title || name }); return 'shared';
      }
    } catch (e) { if (e?.name === 'AbortError') return 'cancelled'; }
    return 'unsupported';
  }
  // The Android app (0.8.4+) hands any download its WebView sees to Android's download manager: the file lands in
  // Downloads with a notification, and the app's own toast says so. The WebView can't save a blob it holds itself,
  // so Save points it at the file's real URL instead (item.download names the file, e.g. Wizard Search's ?dl=title).
  const appDownloads = () => {
    const m = /WizardOS-Android\/(\d+)\.(\d+)\.(\d+)/.exec(navigator.userAgent || '');
    return !!m && (+m[1] * 1e6 + +m[2] * 1e3 + +m[3]) >= 8004; // DownloadListener → DownloadManager since 0.8.4
  };
  function download(href, name) {
    const a = document.createElement('a'); a.href = href; a.download = name || ''; a.rel = 'noopener'; a.hidden = true;
    a.addEventListener('click', e => e.stopPropagation()); // the shell's link handlers never see it: only the download happens
    document.body.appendChild(a); a.click(); a.remove();
  }
  async function saveFile(item) {
    const n = native(), href = String(item.download || item.url || '');
    if (appDownloads() && !(n && typeof n.saveFile === 'function') && !/^(blob|data):/i.test(href)) { download(href, item.name); return 'downloading'; }
    const file = await asFile(item);
    if (n && typeof n.saveFile === 'function') { n.saveFile(await b64(file), file.name, file.type); return 'saved'; }
    if (n) { const r = await shareFile(item); return r === 'unsupported' ? 'unsupported' : r; } // old app: the share sheet saves
    const u = URL.createObjectURL(file); const a = document.createElement('a'); a.href = u; a.download = file.name; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 60000);
    return 'saved';
  }

  /* ================= media viewer: images (pinch, pan, swipe), video, audio, files ================= */
  const TEXTY = /^(text\/|application\/(json|xml|x-yaml|yaml|javascript|x-sh))/;
  const TEXT_EXT = /\.(md|markdown|txt|log|json|csv|tsv|ya?ml|xml|py|js|ts|tsx|jsx|sh|css|html?|toml|ini|cfg)$/i;
  const V = { el: null, items: [], i: 0, s: 1, x: 0, y: 0, ptr: new Map(), g: null, lastTap: 0 };
  function build() {
    if (V.el) return V.el;
    const el = document.createElement('div');
    el.className = 'mviewer'; el.hidden = true; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Media viewer');
    el.innerHTML = `<div class="mv-top"><button type="button" class="mv-x" data-mv="close" aria-label="Close">×</button><div class="mv-ti"><b></b><small></small></div></div>
      <div class="mv-stage"></div>
      <div class="mv-bar"><button type="button" data-mv="prev" aria-label="Previous">‹</button><button type="button" data-mv="copy" hidden>Copy</button><button type="button" data-mv="share">Share</button><button type="button" data-mv="save">Save</button><button type="button" data-mv="next" aria-label="Next">›</button></div>
      <div class="mv-menu" hidden><div class="mv-menu-b" role="menu"><b class="mv-menu-t"></b><button type="button" role="menuitem" data-mvm="save">⤓ <span>Save image</span></button><button type="button" role="menuitem" data-mvm="share">↗ <span>Share</span></button><button type="button" role="menuitem" data-mvm="cancel"><span>Cancel</span></button></div></div>`;
    (document.getElementById('device') || document.body).appendChild(el);
    el.addEventListener('click', e => {
      const mm = e.target.closest('.mv-menu');
      if (mm) {
        if (!V.menuArmed && e.detail !== 0) return; // the finger lifting off the long-press that opened it: only a fresh press counts
        const k = e.target.closest('[data-mvm]')?.dataset.mvm; const it = V.items[V.i];
        if (!k && e.target.closest('.mv-menu-b')) return;
        menu(false);
        if (it && k === 'save') save(it); else if (it && k === 'share') share(it);
        return;
      }
      const a = e.target.closest('[data-mv]')?.dataset.mv; if (!a) return;
      if (a === 'close') return viewer.close();
      if (a === 'prev') return go(-1);
      if (a === 'next') return go(1);
      const it = V.items[V.i]; if (!it) return;
      if (a === 'copy') return copyText(V.text || '').then(ok => K.notify(ok ? '⧉' : '!', ok ? 'Copied' : 'Couldn’t copy'));
      if (a === 'share') return share(it);
      if (a === 'save') return save(it);
    });
    // Long-press (or right-click) the photo: Save / Share, like holding an image in a browser.
    el.addEventListener('contextmenu', e => { if (e.target.closest('.mv-stage') && V.items[V.i]?.kind === 'image') { e.preventDefault(); menu(true); } });
    el.querySelector('.mv-menu').addEventListener('pointerdown', () => { V.menuArmed = true; });
    const stage = el.querySelector('.mv-stage');
    stage.addEventListener('pointerdown', e => {
      if (!V.items[V.i] || V.items[V.i].kind !== 'image') return;
      stage.setPointerCapture?.(e.pointerId);
      V.ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (V.ptr.size === 2) { const [a, b] = [...V.ptr.values()]; V.g = { pinch: true, d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, s0: V.s, x0: V.x, y0: V.y }; }
      else if (V.ptr.size === 1) V.g = { pinch: false, sx: e.clientX, sy: e.clientY, x0: V.x, y0: V.y, t: Date.now(), moved: false };
      clearTimeout(V.lp); V.lp = 0;
      if (V.ptr.size === 1) V.lp = setTimeout(() => { V.lp = 0; const g = V.g; if (g && !g.pinch && !g.moved && V.ptr.size === 1) { g.held = true; menu(true); } }, 500);
    });
    stage.addEventListener('pointermove', e => {
      if (!V.ptr.has(e.pointerId) || !V.g) return;
      V.ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (V.g.pinch && V.ptr.size >= 2) {
        const [a, b] = [...V.ptr.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
        V.s = Math.max(1, Math.min(6, V.g.s0 * d / V.g.d0)); V.x = V.g.x0 * V.s / V.g.s0; V.y = V.g.y0 * V.s / V.g.s0; paint(); return;
      }
      if (V.g.pinch) return;
      const dx = e.clientX - V.g.sx, dy = e.clientY - V.g.sy;
      if (Math.abs(dx) + Math.abs(dy) > 8) { V.g.moved = true; clearTimeout(V.lp); V.lp = 0; }
      if (V.g.held) return;
      if (V.s > 1.02) { V.x = V.g.x0 + dx; V.y = V.g.y0 + dy; paint(); }
      else { V.g.dx = dx; V.g.dy = dy; const img = stage.querySelector('img'); if (img) { img.style.transition = 'none'; img.style.transform = Math.abs(dx) > Math.abs(dy) ? `translateX(${dx}px)` : `translateY(${Math.max(0, dy)}px)`; el.style.setProperty('--fade', String(Math.max(.35, 1 - Math.max(0, dy) / 400))); } }
    });
    const up = e => {
      if (!V.ptr.has(e.pointerId)) return;
      V.ptr.delete(e.pointerId); clearTimeout(V.lp); V.lp = 0;
      const g = V.g; if (!g) return;
      if (g.held) { V.g = null; el.style.removeProperty('--fade'); paint(); return; } // a long-press is never also a tap/swipe
      if (g.pinch) { if (V.ptr.size === 0) { V.g = null; if (V.s < 1.05) reset(); } else { const p = [...V.ptr.values()][0]; V.g = { pinch: false, sx: p.x, sy: p.y, x0: V.x, y0: V.y, t: Date.now(), moved: true }; } return; }
      V.g = null; el.style.removeProperty('--fade');
      if (!g.moved && Date.now() - g.t < 300) {
        if (g.t - V.lastTap < 350) { V.lastTap = 0; if (V.s > 1.02) reset(); else { V.s = 2.5; V.x = 0; V.y = 0; paint(); } return; }
        V.lastTap = Date.now(); return;
      }
      if (V.s > 1.02) return;
      const dx = g.dx || 0, dy = g.dy || 0;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) && V.items.length > 1) { go(dx < 0 ? 1 : -1); return; }
      if (dy > 110 && dy > Math.abs(dx)) { viewer.close(); return; }
      paint();
    };
    stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
    document.addEventListener('keydown', e => { if (!viewer.isOpen()) return; if (e.key === 'ArrowLeft') go(-1); else if (e.key === 'ArrowRight') go(1); });
    V.el = el; return el;
  }
  function menu(on) {
    const m = V.el?.querySelector('.mv-menu'); if (!m) return false;
    if (!on) { if (m.hidden) return false; m.hidden = true; V.el.classList.remove('menu-open'); return true; }
    const it = V.items[V.i]; if (!it || it.kind !== 'image') return false;
    m.querySelector('.mv-menu-t').textContent = it.name || 'Photo';
    m.hidden = false; V.menuArmed = false; V.el.classList.add('menu-open');
    try { navigator.vibrate?.(12); } catch (e) {}
    return true;
  }
  const save = it => saveFile(it).then(r => r === 'downloading' ? null : K.notify(r === 'unsupported' ? '!' : '⤓', r === 'saved' ? 'Saved' : r === 'shared' ? 'Choose where to save' : r === 'cancelled' ? 'Not saved' : 'Saving isn’t available here')).catch(() => K.notify('!', 'Couldn’t save this file'));
  const share = async it => {
    try {
      let result = await shareFile(it);
      // An old native bridge may already have opened the file chooser without an
      // outcome receipt. Never open a second text chooser or claim Shared then.
      if (result === 'unsupported' && typeof native()?.shareFile !== 'function') {
        result = await sharePayload({ url: new URL(it.url, location.href).href, title: it.name });
      }
      if (result === 'shared') K.notify('↗', 'Shared');
      else if (result === 'copied') K.notify('⧉', 'Link copied');
      else if (result === 'unsupported') K.notify('!', 'Sharing unavailable or not confirmed');
    } catch (_) { K.notify('!', 'Couldn’t share this file'); }
  };
  function reset() { V.s = 1; V.x = 0; V.y = 0; paint(); }
  function paint() {
    const img = V.el?.querySelector('.mv-stage img'); if (!img) return;
    img.style.transition = V.g ? 'none' : ''; img.style.transform = `translate(${V.x}px, ${V.y}px) scale(${V.s})`;
    V.el.classList.toggle('zoomed', V.s > 1.02);
  }
  function go(d) { if (V.items.length < 2) return; V.i = (V.i + d + V.items.length) % V.items.length; show(); }
  const sizeLabel = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : b >= 1024 ? Math.round(b / 1024) + ' KB' : b ? b + ' B' : '';
  function show() {
    const el = build(), it = V.items[V.i]; if (!it) return;
    V.s = 1; V.x = 0; V.y = 0; V.text = ''; menu(false);
    const stage = el.querySelector('.mv-stage');
    for (const m of stage.querySelectorAll('video,audio')) { try { m.pause(); } catch (e) {} }
    el.dataset.kind = it.kind;
    el.querySelector('.mv-ti b').textContent = it.name || (it.kind === 'image' ? 'Photo' : 'File');
    el.querySelector('.mv-ti small').textContent = V.items.length > 1 ? `${V.i + 1} of ${V.items.length}` : sizeLabel(it.bytes);
    el.querySelector('[data-mv="prev"]').hidden = el.querySelector('[data-mv="next"]').hidden = V.items.length < 2;
    el.querySelector('[data-mv="copy"]').hidden = true;
    if (it.kind === 'image') stage.innerHTML = `<img src="${esc(it.url)}" alt="${esc(it.name || 'Photo')}" draggable="false">`;
    else if (it.kind === 'video') stage.innerHTML = `<video src="${esc(it.url)}" controls playsinline autoplay preload="metadata"></video>`;
    else if (it.kind === 'audio') stage.innerHTML = `<div class="mv-file"><span class="mv-ic">♪</span><b>${esc(it.name || 'Audio')}</b><audio src="${esc(it.url)}" controls autoplay preload="metadata"></audio>${it.transcript ? `<p class="mv-tx">${esc(it.transcript)}</p>` : ''}</div>`;
    else if (TEXTY.test(it.mime || '') || TEXT_EXT.test(it.name || '')) {
      stage.innerHTML = '<div class="mv-doc"><p class="mv-wait">Opening…</p></div>';
      const want = it;
      fetchBlob(it.url).then(b => b.size > 2 * 1048576 ? Promise.reject(new Error('big')) : b.text()).then(t => {
        if (V.items[V.i] !== want || !viewer.isOpen()) return;
        V.text = t; el.querySelector('[data-mv="copy"]').hidden = false;
        const isMd = /markdown/.test(it.mime || '') || /\.(md|markdown)$/i.test(it.name || '');
        stage.innerHTML = `<div class="mv-doc">${isMd ? `<div class="bub md-doc">${md(t)}</div>` : `<pre>${esc(t)}</pre>`}</div>`;
      }).catch(() => { if (V.items[V.i] === want) stage.innerHTML = fileCard(it, 'Can’t preview this file here. Share or save it to open it.'); });
    } else stage.innerHTML = fileCard(it, /pdf/.test(it.mime || '') ? 'Share or save it to open it in a PDF app.' : 'Share or save it to open it in another app.');
    paint();
  }
  const fileCard = (it, hint) => `<div class="mv-file"><span class="mv-ic">📄</span><b>${esc(it.name || 'File')}</b><small>${esc([it.mime, sizeLabel(it.bytes)].filter(Boolean).join(' · '))}</small><p>${esc(hint)}</p></div>`;
  const viewer = {
    open(items, i = 0) {
      items = (items || []).filter(x => x && x.url); if (!items.length) return false;
      V.items = items; V.i = Math.max(0, Math.min(items.length - 1, i));
      const el = build(); el.hidden = false; requestAnimationFrame(() => el.classList.add('open'));
      show(); K.onChange(true); return true;
    },
    close() {
      if (!V.el || V.el.hidden) return false;
      if (menu(false)) return true; // Back/Esc: the Save/Share menu first, the photo stays open
      for (const m of V.el.querySelectorAll('video,audio')) { try { m.pause(); } catch (e) {} }
      V.el.classList.remove('open', 'zoomed'); V.el.hidden = true; V.el.querySelector('.mv-stage').innerHTML = ''; V.items = []; V.ptr.clear(); V.g = null;
      K.onChange(false); return true;
    },
    isOpen: () => !!V.el && !V.el.hidden,
    menu: () => viewer.isOpen() && menu(true),
    get state() { return { open: viewer.isOpen(), i: V.i, n: V.items.length, scale: V.s, kind: V.items[V.i]?.kind || '', name: V.items[V.i]?.name || '', menu: !!V.el && !V.el.querySelector('.mv-menu').hidden }; },
  };

  /* ================= approvals (normalizers.ts) ================= */
  const KNOWN = { once: 'Allow once', allow_once: 'Allow once', session: 'Allow for this chat', always: 'Always allow', deny: 'Deny', allow: 'Allow', reject: 'Deny' };
  const friendlyChoice = v => KNOWN[v] ?? String(v).replace(/[_-]+/g, ' ').replace(/^./, c => c.toUpperCase());
  function choiceReceipt(v) {
    if (v === 'once' || v === 'allow_once') return 'Allowed once';
    if (v === 'session') return 'Allowed for this chat';
    if (v === 'always') return 'Always allowed';
    if (v === 'deny' || v === 'reject') return 'Denied';
    if (v === 'closed') return 'Approval no longer waiting';
    return friendlyChoice(v);
  }
  function normalizeApproval(value) {
    const it = value && typeof value === 'object' ? value : {};
    const str = (...v) => v.find(x => typeof x === 'string' && x.trim()) || '';
    const action = str(it.command, it.redacted_action, it.action, it.description);
    const choices = (Array.isArray(it.choices) ? it.choices : []).map(c => {
      if (typeof c === 'string') return { value: c, label: friendlyChoice(c) };
      const v = str(c?.value, c?.choice, c?.id); return v ? { value: v, label: str(c?.label, c?.name) || friendlyChoice(v) } : null;
    }).filter(Boolean);
    return action && choices.length ? { requestId: str(it.request_id, it.id) || undefined, action, choices } : null;
  }

  window.WosChat = { K, esc, homePath, isHomeUrl, parseRows, helm, imagesOf, chipFiles, md, inline, time, drafts, copyText, sharePayload, shareText, shareFile, saveFile, viewer, normalizeApproval, friendlyChoice, choiceReceipt };
})();
