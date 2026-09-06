import { describe, it, expect, vi } from 'vitest';
import LC from '../lib.js';

const {
  opsRecordKey, opsRowFor, opsPending, opsBatches, applyOpsResult, opsNormalizeUrl,
  opsValidToken, opsSyncRun, OPS_DEFAULT_URL, OPS_BATCH_SIZE
} = LC;

const rec = (over) => ({
  ts: '2026-09-01T12:32:00.000Z', name: 'Max Mustermann',
  profileUrl: 'https://www.linkedin.com/in/max-mustermann', headline: 'Dev bei Acme',
  company: 'Acme', location: 'Berlin', degree: '2.', profileId: 'ACoAAB1',
  method: 'api',
  pageUrl: 'https://www.linkedin.com/search/results/people/?keywords=hausverwaltung%20Berlin', ...over
});

describe('record identity for the sync state', () => {
  it('keys on the profile id, falling back to the URL', () => {
    expect(opsRecordKey(rec())).toBe('ACoAAB1');
    expect(opsRecordKey(rec({ profileId: '' }))).toBe('https://www.linkedin.com/in/max-mustermann');
    expect(opsRecordKey({})).toBe('');
  });
});

describe('opsRowFor — the shape ops expects', () => {
  it('maps every column by name, snake_case', () => {
    expect(opsRowFor(rec())).toEqual({
      profile_url: 'https://www.linkedin.com/in/max-mustermann', name: 'Max Mustermann',
      company: 'Acme', headline: 'Dev bei Acme', location: 'Berlin', degree: '2.',
      profile_id: 'ACoAAB1', method: 'api',
      page_url: 'https://www.linkedin.com/search/results/people/?keywords=hausverwaltung%20Berlin',
      search_query: 'hausverwaltung Berlin',
      ts: '2026-09-01T12:32:00.000Z'
    });
  });
  it('sends null, not undefined or empty strings, for what it does not know', () => {
    const r = opsRowFor(rec({ company: '', location: undefined, degree: null }));
    expect(r.company).toBe(null);
    expect(r.location).toBe(null);
    expect(r.degree).toBe(null);
  });
});

describe('opsPending', () => {
  const a = rec(), b = rec({ profileId: 'B', profileUrl: 'https://www.linkedin.com/in/b' });
  it('returns everything not yet acknowledged by ops', () => {
    expect(opsPending([a, b], {})).toEqual([a, b]);
    expect(opsPending([a, b], { ACoAAB1: { status: 'ok' } })).toEqual([b]);
  });
  it('retries records that failed last time', () => {
    expect(opsPending([a], { ACoAAB1: { status: 'error', error: 'boom' } })).toEqual([a]);
  });
  it('never sends a record without a profile URL — ops has no key for it', () => {
    expect(opsPending([rec({ profileUrl: '', profileId: 'X' })], {})).toEqual([]);
  });
  it('survives junk', () => {
    expect(opsPending(null, null)).toEqual([]);
    expect(opsPending([null, undefined, 'x'], {})).toEqual([]);
  });
});

describe('opsBatches', () => {
  it('splits at the batch size, keeps order', () => {
    const items = Array.from({ length: 7 }, (_, i) => i);
    expect(opsBatches(items, 3)).toEqual([[0, 1, 2], [3, 4, 5], [6]]);
    expect(opsBatches([], 3)).toEqual([]);
  });
  it('defaults to a size ops accepts (max 2000 rows per request)', () => {
    expect(OPS_BATCH_SIZE).toBeGreaterThan(0);
    expect(OPS_BATCH_SIZE).toBeLessThanOrEqual(2000);
  });
});

describe('applyOpsResult', () => {
  const sent = [rec(), rec({ profileId: 'B', profileUrl: 'https://www.linkedin.com/in/b' })];
  const result = {
    commit: true, total: 2, created: 1, updated: 0, unchanged: 0, invalid: 1, errors: 0,
    results: [
      { index: 0, profile_url: 'x', decision: 'create', lead_id: 'L1', changes: [], error: null },
      { index: 1, profile_url: 'y', decision: 'invalid', lead_id: null, changes: [], error: 'keine LinkedIn-Profil-URL' }
    ]
  };
  it('marks each sent record by its own index in the response', () => {
    const state = applyOpsResult({}, sent, result, 1000);
    expect(state.ACoAAB1).toEqual({ status: 'ok', decision: 'create', leadId: 'L1', at: 1000 });
    expect(state.B).toEqual({ status: 'invalid', decision: 'invalid', leadId: null, at: 1000, error: 'keine LinkedIn-Profil-URL' });
  });
  it('matches by the index ops echoes, even when the response is out of order', () => {
    const shuffled = { ...result, results: [result.results[1], result.results[0]] };
    const state = applyOpsResult({}, sent, shuffled, 3);
    expect(state.ACoAAB1.status).toBe('ok');        // row 0 → still Max
    expect(state.B.status).toBe('invalid');         // row 1 → still B
  });

  it('does not mutate the previous state', () => {
    const prev = { OLD: { status: 'ok' } };
    const next = applyOpsResult(prev, sent, result, 1);
    expect(prev).toEqual({ OLD: { status: 'ok' } });
    expect(next.OLD).toEqual({ status: 'ok' });
  });
  it('treats unchanged and update as acknowledged too', () => {
    const r = { ...result, results: [{ index: 0, decision: 'unchanged', lead_id: 'L1', changes: [] }] };
    expect(applyOpsResult({}, [rec()], r, 5).ACoAAB1.status).toBe('ok');
  });
});

describe('settings validation', () => {
  it('normalizes the base URL', () => {
    expect(opsNormalizeUrl(' https://ops.celox.io/ ')).toBe('https://ops.celox.io');
    expect(opsNormalizeUrl('https://ops.celox.io/api/')).toBe('https://ops.celox.io');
    expect(opsNormalizeUrl('')).toBe(OPS_DEFAULT_URL);
    expect(OPS_DEFAULT_URL).toBe('https://ops.celox.io');
  });
  it('refuses plain http except on localhost', () => {
    expect(opsNormalizeUrl('http://ops.celox.io')).toBe(null);
    expect(opsNormalizeUrl('http://localhost:8000')).toBe('http://localhost:8000');
    expect(opsNormalizeUrl('http://127.0.0.1:8000/')).toBe('http://127.0.0.1:8000');
    expect(opsNormalizeUrl('not a url')).toBe(null);
  });
  it('recognizes an ops token and nothing else', () => {
    expect(opsValidToken('ops_' + 'a'.repeat(40))).toBe(true);
    expect(opsValidToken('eyJhbGciOi.jwt.here')).toBe(false);
    expect(opsValidToken('ops_short')).toBe(false);
    expect(opsValidToken('')).toBe(false);
  });
});

describe('opsSyncRun — the whole round trip with fetch injected', () => {
  const settings = { baseUrl: 'https://ops.example', token: 'ops_' + 'x'.repeat(40) };
  const log = [rec(), rec({ profileId: 'B', profileUrl: 'https://www.linkedin.com/in/b', name: 'Bea' })];

  function okFetch(rowsSeen) {
    return vi.fn(async (url, init) => {
      const body = JSON.parse(init.body);
      rowsSeen.push({ url, auth: init.headers.Authorization, commit: body.commit, rows: body.rows });
      return {
        ok: true, status: 200,
        json: async () => ({
          commit: true, total: body.rows.length, created: body.rows.length, updated: 0, unchanged: 0, invalid: 0, errors: 0,
          results: body.rows.map((r, i) => ({ index: i, profile_url: r.profile_url, decision: 'create', lead_id: 'L' + i, changes: [], error: null }))
        })
      };
    });
  }

  it('posts pending records with the bearer token to the import endpoint and commits', async () => {
    const seen = [];
    const out = await opsSyncRun({ settings, log, state: {}, fetchFn: okFetch(seen), now: 7 });
    expect(seen.length).toBe(1);
    expect(seen[0].url).toBe('https://ops.example/api/rainmaker/leads/import/linkedin-spider');
    expect(seen[0].auth).toBe('Bearer ' + settings.token);
    expect(seen[0].commit).toBe(true);
    expect(seen[0].rows.map((r) => r.name)).toEqual(['Max Mustermann', 'Bea']);
    expect(out.error).toBe(null);
    expect(out.state.ACoAAB1.status).toBe('ok');
    expect(out.state.B.status).toBe('ok');
    expect(out.summary).toEqual({ at: 7, sent: 2, created: 2, updated: 0, unchanged: 0, invalid: 0, errors: 0, error: null });
  });

  it('sends nothing when nothing is pending', async () => {
    const seen = [];
    const out = await opsSyncRun({ settings, log, state: { ACoAAB1: { status: 'ok' }, B: { status: 'ok' } }, fetchFn: okFetch(seen), now: 1 });
    expect(seen).toEqual([]);
    expect(out.summary.sent).toBe(0);
  });

  it('batches large backlogs and keeps every acknowledgement', async () => {
    const big = Array.from({ length: OPS_BATCH_SIZE * 2 + 5 }, (_, i) =>
      rec({ profileId: 'P' + i, profileUrl: 'https://www.linkedin.com/in/p' + i }));
    const seen = [];
    const out = await opsSyncRun({ settings, log: big, state: {}, fetchFn: okFetch(seen), now: 1 });
    expect(seen.length).toBe(3);
    expect(Object.keys(out.state).length).toBe(big.length);
    expect(out.summary.sent).toBe(big.length);
  });

  it('on a 401 leaves the state untouched and names the problem', async () => {
    const f = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ detail: 'API-Token ungültig oder widerrufen' }) }));
    const out = await opsSyncRun({ settings, log, state: {}, fetchFn: f, now: 1 });
    expect(out.state).toEqual({});
    expect(out.error).toMatch(/401/);
    expect(out.error).toMatch(/Token/);
    expect(out.summary.error).toBe(out.error);
  });

  it('on a network failure leaves the state untouched so the next run retries', async () => {
    const f = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    const out = await opsSyncRun({ settings, log, state: {}, fetchFn: f, now: 1 });
    expect(out.state).toEqual({});
    expect(out.error).toMatch(/Failed to fetch/);
  });

  it('keeps what earlier batches acknowledged when a later batch fails', async () => {
    const big = Array.from({ length: OPS_BATCH_SIZE + 1 }, (_, i) =>
      rec({ profileId: 'P' + i, profileUrl: 'https://www.linkedin.com/in/p' + i }));
    let calls = 0;
    const f = vi.fn(async (url, init) => {
      calls++;
      if (calls === 2) return { ok: false, status: 500, json: async () => ({}) };
      const rows = JSON.parse(init.body).rows;
      return { ok: true, status: 200, json: async () => ({ created: rows.length, updated: 0, unchanged: 0, invalid: 0, errors: 0,
        results: rows.map((r, i) => ({ index: i, decision: 'create', lead_id: 'L', changes: [] })) }) };
    });
    const out = await opsSyncRun({ settings, log: big, state: {}, fetchFn: f, now: 1 });
    expect(Object.keys(out.state).length).toBe(OPS_BATCH_SIZE);
    expect(out.error).toMatch(/500/);
    expect(out.summary.sent).toBe(OPS_BATCH_SIZE);
  });

  it('refuses to run without a usable token or URL', async () => {
    const f = vi.fn();
    const a = await opsSyncRun({ settings: { baseUrl: 'https://ops.example', token: 'nope' }, log, state: {}, fetchFn: f, now: 1 });
    const b = await opsSyncRun({ settings: { baseUrl: 'http://ops.example', token: settings.token }, log, state: {}, fetchFn: f, now: 1 });
    expect(f).not.toHaveBeenCalled();
    expect(a.error).toMatch(/token/i);
    expect(b.error).toMatch(/url/i);
  });

  it('marks rows ops calls invalid so they are not retried forever', async () => {
    const f = vi.fn(async (url, init) => {
      const rows = JSON.parse(init.body).rows;
      return { ok: true, status: 200, json: async () => ({ created: 0, updated: 0, unchanged: 0, invalid: rows.length, errors: 0,
        results: rows.map((r, i) => ({ index: i, decision: 'invalid', lead_id: null, changes: [], error: 'keine LinkedIn-Profil-URL' })) }) };
    });
    const out = await opsSyncRun({ settings, log: [rec()], state: {}, fetchFn: f, now: 1 });
    expect(out.state.ACoAAB1.status).toBe('invalid');
    expect(opsPending([rec()], out.state)).toEqual([]);
  });
});
