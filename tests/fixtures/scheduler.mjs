// Owner API #81 fixture; never connects to an agent runtime or a real scheduler.
export function schedulerFixture() {
  let jobs = [
    { id: 'morning', name: 'Morning brief', when: { cron: '0 7 * * *' }, timezone: 'Europe/London', agent: 'main', model: 'kept-model', prompt: 'Summarise the day ahead.', thread: 'chat-brief', enabled: true, nextAt: '2026-10-22T06:00:00Z' },
    { id: 'digest', name: 'Topic digest', when: { every: 5 }, timezone: 'UTC', agent: 'main', prompt: 'Read my topics.', thread: null, enabled: false, nextAt: null }
  ];
  const calls = [], importRows = [{ id: 'legacy-brief', name: 'Weekly review', status: 'would import (paused)', schedule: { when: { cron: '0 9 * * 1' } } }, { id: 'script-job', name: 'Disk cleanup', status: 'not imported: script job' }];
  let imported = false;
  return {
    calls, get jobs() { return jobs; }, missing: false, fail: null,
    handle(path, method = 'GET', body = {}) {
      calls.push({ path, method, body });
      if (this.missing) return { status: 404, body: { error: 'Not found' } };
      if (this.fail && method !== 'GET') return { status: 503, body: { error: this.fail } };
      const suffix = path.slice('/wizard/v1/schedules'.length);
      const out = (body, status = 200) => ({ status, body });
      if (!suffix && method === 'GET') return out({ schedules: structuredClone(jobs) });
      if (suffix === '/import-hermes' && method === 'POST') {
        if (!body.dryRun && !imported) { jobs.push({ id: 'imported', name: 'Weekly review', enabled: false, when: { cron: '0 9 * * 1' }, prompt: 'Review this week', thread: null, agent: 'main' }); imported = true; }
        return out({ dryRun: body.dryRun, results: importRows.map((r, i) => i ? r : { ...r, status: body.dryRun ? imported ? 'already imported' : 'would import (paused)' : 'imported (paused)' }) });
      }
      if (!suffix && method === 'POST') { const j = { ...body, id: 'created' }; jobs.push(j); return out({ schedule: j }, 201); }
      const id = decodeURIComponent(suffix.split('/')[1]), j = jobs.find(j => j.id === id);
      if (!j) return out({ error: 'Schedule not found' }, 404);
      if (suffix.endsWith('/run') && method === 'POST') return out({ schedule: j, requested: true }, 202);
      if (method === 'PATCH') { Object.assign(j, body); return out({ schedule: j }); }
      if (method === 'DELETE') { jobs = jobs.filter(j => j.id !== id); return out({ deleted: true }); }
      return out({ error: 'Not found' }, 404);
    }
  };
}
