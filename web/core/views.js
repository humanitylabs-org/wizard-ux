/* Shared approved review and Maps renderers. Shells own placement and gestures only. */
(() => {
  'use strict';
  const { esc, clip } = window.WizCore;
  const D = window.WIZ_DATA || { threads: [], projects: {} };
  const S = window.WIZ_SUMM || { days: {}, weeks: {}, month: '' };
  const TODAY = (D.generated || new Date().toISOString()).slice(0, 10);
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DOWL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dt = d => new Date(d + 'T00:00:00Z');
  const iso = x => x.toISOString().slice(0, 10);
  const addDays = (d, n) => { const x = dt(d); x.setUTCDate(x.getUTCDate() + n); return iso(x); };
  const weekOf = d => { const x = dt(d); return addDays(d, -((x.getUTCDay() + 6) % 7)); };
  const fmtDay = d => { const x = dt(d); return `${DOW[x.getUTCDay()]} ${x.getUTCDate()} ${MON[x.getUTCMonth()]}`; };
  const fmtDayLong = d => { const x = dt(d); return `${DOWL[x.getUTCDay()]} ${x.getUTCDate()} ${MON[x.getUTCMonth()]}`; };
  const fmtRange = (a, b) => { const x = dt(a), y = dt(b); return x.getUTCMonth() === y.getUTCMonth() ? `${x.getUTCDate()} – ${y.getUTCDate()} ${MON[y.getUTCMonth()]}` : `${x.getUTCDate()} ${MON[x.getUTCMonth()]} – ${y.getUTCDate()} ${MON[y.getUTCMonth()]}`; };
  const YESTERDAY = addDays(TODAY, -1);

  /* ---------------- data ---------------- */
  const PCOL = { 'wizard-os': '#b99bff', 'wizard-app': '#7c5cff', mizel: '#3fe0ff', clips: '#ffbe55', signal: '#ff5ccf', music: '#4ff0b0', wisdom: '#a6e35f', business: '#ff8a5c', infra: '#8aa0c8', life: '#e9dcff' };
  const PICON = { 'wizard-os': window.WizBrand.html, 'wizard-app': '◈', mizel: '◉', clips: '▶', signal: '◎', music: '♫', wisdom: '☯', business: '◆', infra: '⌬', life: '✺' };
  const byDay = {}, byId = {};
  for (const t of D.threads) { (byDay[t.day] = byDay[t.day] || []).push(t); byId[t.id] = t; }
  const allDays = []; { let d = weekOf(D.threads.length ? D.threads.reduce((m, t) => t.day < m ? t.day : m, TODAY) : TODAY); while (d <= TODAY) { allDays.push(d); d = addDays(d, 1); } }
  const weeks = [...new Set(allDays.map(weekOf))].sort();
  const threadsIn = days => days.flatMap(d => byDay[d] || []);
  const msgCount = ts => ts.reduce((s, t) => s + (t.n || 0), 0);
  function projMix(ts) {
    const m = {}; for (const t of ts) m[t.p] = (m[t.p] || 0) + (t.n || 1);
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }
  function bars(ts) {
    const mix = projMix(ts), tot = mix.reduce((s, x) => s + x[1], 0) || 1;
    return `<div class="bars">${mix.map(([p, v]) => `<i style="flex:${v / tot};background:${PCOL[p]}"></i>`).join('')}</div>`;
  }

  const LEVELS = ['month', 'week', 'day', 'group', 'thread'];
  const LNAME = { month: 'Month', week: 'Week', day: 'Day', group: 'Focus', thread: 'Thread' };
  function renderReviewShell(i) {
    return `<div class="review" data-review="${i}">
      <div class="zoom-rail">${LEVELS.map(l => `<button class="lvl" data-rail="${l}">${LNAME[l]}</button>`).join('')}</div>
      <div class="crumb"></div>
      <div class="zstage"></div>
      <div class="pinch-hint ${0 > 1 ? 'gone' : ''}">🤏 Pinch to zoom · tap to dive</div>
    </div>`;
  }
  function groupThreads(z) {
    const ts = byDay[z.day] || [];
    if (z.type === 'project') return ts.filter(t => t.p === z.key);
    if (z.type === 'person') return ts.filter(t => (t.people || []).includes(z.key));
    if (z.type === 'calls') return ts.filter(t => t.call);
    return ts;
  }
  function zs(o) { return esc(JSON.stringify(o)); }
  function renderLevel(z) {
    if (z.level === 'month') {
      const ts = threadsIn(allDays), active = allDays.filter(d => byDay[d]).length;
      return `<div class="summary"><div class="eyebrow"><span class="spark"></span>Month in review</div><h3>${fmtRange(allDays[0], allDays[allDays.length - 1])}</h3><p>${esc(S.month || '')}</p>
        <div class="stats"><span><b>${ts.length}</b>threads</span><span><b>${msgCount(ts).toLocaleString()}</b>messages</span><span><b>${active}</b>active days</span></div>${bars(ts)}</div>
        <div class="sec-title"><span>Weeks</span><span>pinch in</span></div><div class="zgrid">
        ${weeks.slice().reverse().map(w => { const wd = Array.from({ length: 7 }, (_, k) => addDays(w, k)).filter(d => d <= TODAY); const wt = threadsIn(wd);
          return `<button class="zcard ${wd.includes(TODAY) ? 'today' : ''}" data-z="${zs({ level: 'week', week: w })}"><div class="dow">Week of ${fmtDay(w).slice(4)}</div><div class="row"><span class="t">${fmtRange(w, wd[wd.length - 1])}</span><span class="c">${wt.length} threads</span></div><div class="s">${esc(S.weeks[w] || '')}</div>${bars(wt)}</button>`; }).join('')}
        </div>
        <div class="sec-title"><span>Projects this month</span></div><div class="chips">${projMix(ts).map(([p, v]) => `<span class="chip"><i class="pdot" style="color:${PCOL[p]};background:${PCOL[p]}"></i>${esc(D.projects[p])} · ${v.toLocaleString()}</span>`).join('')}</div>`;
    }
    if (z.level === 'week') {
      const wd = Array.from({ length: 7 }, (_, k) => addDays(z.week, k)); const shown = wd.filter(d => d <= TODAY); const ts = threadsIn(shown);
      return `<div class="summary"><div class="eyebrow"><span class="spark"></span>Week in review</div><h3>${fmtRange(z.week, wd[6])}</h3><p>${esc(S.weeks[z.week] || '')}</p>
        <div class="stats"><span><b>${ts.length}</b>threads</span><span><b>${msgCount(ts).toLocaleString()}</b>messages</span><span><b>${projMix(ts).length}</b>projects</span></div>${bars(ts)}</div>
        <div class="sec-title"><span>Days</span><span>pinch in</span></div><div class="zgrid">
        ${shown.slice().reverse().map(d => { const t = byDay[d] || [];
          return `<button class="zcard ${d === TODAY ? 'today' : ''} ${t.length ? '' : 'empty'}" data-z="${zs({ level: 'day', day: d })}"><div class="row"><span class="t">${fmtDay(d)}</span><span class="c">${t.length} threads</span></div><div class="s">${esc(S.days[d] || (t.length ? t.slice(0, 3).map(x => x.title).join(' · ') : 'Quiet day'))}</div>${t.length ? bars(t) : ''}</button>`; }).join('')}
        </div>`;
    }
    if (z.level === 'day') {
      const ts = byDay[z.day] || [], mix = projMix(ts);
      const people = {}; ts.forEach(t => (t.people || []).forEach(p => people[p] = (people[p] || 0) + 1));
      const calls = ts.filter(t => t.call);
      return `<div class="summary"><div class="eyebrow"><span class="spark"></span>${z.day === YESTERDAY ? 'Yesterday' : z.day === TODAY ? 'Today' : 'Day in review'}</div><h3>${fmtDayLong(z.day)}</h3><p>${esc(S.days[z.day] || (ts.length ? `${ts.length} threads.` : 'A quiet day. Nothing ran.'))}</p>
        <div class="stats"><span><b>${ts.length}</b>threads</span><span><b>${msgCount(ts).toLocaleString()}</b>messages</span><span><b>${mix.length}</b>projects</span></div>${ts.length ? bars(ts) : ''}</div>
        ${mix.length ? `<div class="sec-title"><span>Projects</span><span>pinch in</span></div><div class="zgrid two">${mix.map(([p]) => { const g = ts.filter(t => t.p === p);
          return `<button class="zcard" data-z="${zs({ level: 'group', day: z.day, type: 'project', key: p })}"><div class="row"><span class="t"><i class="pdot" style="color:${PCOL[p]};background:${PCOL[p]}"></i>${esc(D.projects[p])}</span></div><div class="big">${g.length}</div><div class="s">${esc(clip(g.map(x => x.title).join(' · '), 80))}</div></button>`; }).join('')}</div>` : ''}
        ${Object.keys(people).length ? `<div class="sec-title"><span>People</span></div><div class="zgrid">${Object.entries(people).map(([p, n]) =>
          `<button class="zcard" data-z="${zs({ level: 'group', day: z.day, type: 'person', key: p })}"><div class="row"><span class="t"><span class="ticon">◍</span> ${esc(p)}</span><span class="c">${n} thread${n > 1 ? 's' : ''}</span></div></button>`).join('')}</div>` : ''}
        ${calls.length ? `<div class="sec-title"><span>Calls &amp; meetings</span></div><div class="zgrid">${calls.map(t =>
          `<button class="zcard" data-z="${zs({ level: 'thread', day: z.day, id: t.id })}"><div class="row"><span class="t"><span class="ticon">☏</span> ${esc(t.title)}</span><span class="when">${esc(t.t)}</span></div></button>`).join('')}</div>` : ''}`;
    }
    if (z.level === 'group') {
      const ts = groupThreads(z).slice().sort((a, b) => a.t.localeCompare(b.t));
      const name = z.type === 'project' ? D.projects[z.key] : z.type === 'person' ? z.key : 'Calls';
      const top = ts.slice().sort((a, b) => b.n - a.n)[0];
      return `<div class="summary"><div class="eyebrow"><span class="spark" style="background:${PCOL[z.key] || 'var(--pink)'}"></span>${esc(fmtDay(z.day))} · ${z.type}</div><h3>${esc(name)}</h3>
        <p>${ts.length} thread${ts.length === 1 ? '' : 's'}, ${msgCount(ts)} messages.${top ? ` Most of the work went into “${esc(top.title)}”.` : ''}</p>
        <div class="stats"><span><b>${ts.length}</b>threads</span><span><b>${msgCount(ts)}</b>messages</span><span><b>${ts[0]?.t || '—'}</b>first</span></div></div>
        <div class="sec-title"><span>Threads</span><span>pinch in</span></div><div class="zgrid">${ts.map(t =>
          `<button class="zcard" data-z="${zs({ level: 'thread', day: z.day, id: t.id, from: { type: z.type, key: z.key } })}"><div class="row"><span class="when">${esc(t.t)}</span><span class="t">${esc(t.title)}</span><span class="c">${t.n}</span></div>${t.a ? `<div class="s">${esc(clip(t.a, 150))}</div>` : ''}</button>`).join('')}</div>`;
    }
    if (z.level === 'thread') {
      const t = byId[z.id] || {};
      return `<div class="summary"><div class="eyebrow"><span class="spark" style="background:${PCOL[t.p]}"></span>${esc(fmtDay(z.day))} · ${esc(t.t)} · ${esc(t.src)}</div><h3>${esc(t.title)}</h3>
        <div class="chips"><span class="chip"><i class="pdot" style="color:${PCOL[t.p]};background:${PCOL[t.p]}"></i>${esc(D.projects[t.p])}</span><span class="chip">${t.n} messages</span>${(t.people || []).map(p => `<span class="chip">${esc(p)}</span>`).join('')}</div></div>
        ${t.u ? `<div class="bubble u"><span class="who">You</span>${esc(t.u)}</div>` : ''}${t.a ? `<div class="bubble a"><span class="who">${window.WizConfig.agent()}</span>${esc(t.a)}</div>` : ''}
        <button class="cta" data-wizthread="${esc(z.id)}">Open the full thread in Wizard</button>`;
    }
    return '';
  }
  function parentOf(z) {
    if (z.level === 'thread') return z.from ? { level: 'group', day: z.day, type: z.from.type, key: z.from.key } : { level: 'day', day: z.day };
    if (z.level === 'group') return { level: 'day', day: z.day };
    if (z.level === 'day') return { level: 'week', week: weekOf(z.day) };
    if (z.level === 'week') return { level: 'month' };
    return null;
  }
  function chain(z) { const c = []; let x = z; while (x) { c.unshift(x); x = parentOf(x); } return c; }
  function crumbLabel(z) {
    if (z.level === 'month') return 'Month';
    if (z.level === 'week') return 'Wk ' + fmtDay(z.week).slice(4);
    if (z.level === 'day') return fmtDay(z.day).slice(0, 6).trim();
    if (z.level === 'group') return z.type === 'project' ? D.projects[z.key] : z.type === 'person' ? z.key : 'Calls';
    return 'Thread';
  }
  function renderMaps(w) {
    const q = w.dest || '';
    const link = w.mode === 'dir' ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}&travelmode=driving`
      : q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : 'https://www.google.com/maps';
    const roads = Array.from({ length: 9 }, (_, i) => `<path d="M${-20 + i * 55} -10 L${40 + i * 48} 360" stroke="rgba(120,140,200,.16)" stroke-width="${i % 3 ? 2 : 6}"/>`).join('') +
      Array.from({ length: 8 }, (_, i) => `<path d="M-10 ${20 + i * 46} L420 ${-10 + i * 52}" stroke="rgba(120,140,200,.13)" stroke-width="${i % 3 ? 2 : 5}"/>`).join('');
    return `<div class="desk-scroll"><form class="map-query"><input aria-label="Place or destination" name="destination" value="${esc(q)}" placeholder="Place or destination"><button name="mode" value="search">Search</button><button name="mode" value="dir">Directions</button></form>
      <div class="map" aria-label="Illustration, not a live map"><svg viewBox="0 0 360 330" preserveAspectRatio="xMidYMid slice">
        <path d="M-10 250 C 80 230, 120 300, 210 270 S 330 250, 380 300 L380 340 L-10 340Z" fill="rgba(63,120,255,.13)"/>
        ${roads}
        ${w.mode === 'dir' ? '<path class="route" d="M70 260 C 110 210, 120 190, 170 170 S 250 120, 282 82" fill="none" stroke="#3fe0ff" stroke-width="5" stroke-linecap="round" stroke-dasharray="7 9"><animate attributeName="stroke-dashoffset" from="64" to="0" dur="1.4s" repeatCount="indefinite"/></path>' : ''}
      </svg>
      ${w.mode === 'dir' ? '<span class="me" style="left:62px;top:252px"></span>' : ''}<span class="pin" style="left:${w.mode === 'dir' ? 274 : 170}px;top:${w.mode === 'dir' ? 64 : 140}px"></span>
      <div class="eta"><b>${w.mode === 'dir' ? 'Directions' : q ? 'Search' : 'Maps'}</b><span>${w.mode === 'dir' ? 'Live ETA comes from Google Maps' : 'Preview'}</span></div></div>
      <div class="map-dest"><h3>${esc(q || 'Google Maps')}</h3><p>${w.mode === 'dir' ? 'Driving directions' : 'Search results'} · opens Google Maps on this device</p></div>
      <a class="cta" href="${esc(link)}" target="_blank" rel="noopener">${w.mode === 'dir' ? 'Start navigation in Maps' : 'Open in Maps'}</a></div>`;
  }

  function bindMaps(root, w, changed) { const form = root.querySelector('.map-query'); if (!form) return; form.onsubmit = e => { e.preventDefault(); w.dest = form.elements.destination.value.trim(); w.mode = e.submitter?.value || 'search'; const body = root.querySelector('.wbody') || root; body.innerHTML = renderMaps(w); bindMaps(root, w, changed); changed?.(); }; }
  window.WosViews = { bindMaps, TODAY, YESTERDAY, weekOf, LEVELS, LNAME, renderReviewShell, renderLevel, parentOf, chain, crumbLabel, renderMaps };
})();
