import { describe, it, expect, vi } from 'vitest';
import LC from '../lib.js';

const {
  opsRecordKey, opsRowFor, opsPending, opsBatches, applyOpsResult, opsNormalizeUrl,
  opsValidToken, opsSyncRun, OPS_DEFAULT_URL, OPS_BATCH_SIZE, OPS_ROW_VERSION,
  OPS_TALLY_PATH, opsTallyRows, opsPushTally, opsCapsFrom, opsCapsGained, opsClearRowVersions
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
    expect(opsRowFor(rec(), ['Berlin'])).toEqual({
      profile_url: 'https://www.linkedin.com/in/max-mustermann', name: 'Max Mustermann',
      company: 'Acme', headline: 'Dev bei Acme', location: 'Berlin', degree: '2.',
      profile_id: 'ACoAAB1', method: 'api',
      page_url: 'https://www.linkedin.com/search/results/people/?keywords=hausverwaltung%20Berlin',
      search_query: 'hausverwaltung Berlin',
      search_term: 'hausverwaltung',
      search_city: 'Berlin',
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
    expect(opsPending([a, b], { ACoAAB1: { status: 'ok', v: OPS_ROW_VERSION } })).toEqual([b]);
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
    expect(state.ACoAAB1).toEqual({ status: 'ok', decision: 'create', leadId: 'L1', at: 1000, v: OPS_ROW_VERSION });
    expect(state.B).toEqual({ status: 'invalid', decision: 'invalid', leadId: null, at: 1000, v: OPS_ROW_VERSION, error: 'keine LinkedIn-Profil-URL' });
  });
  it('matches by the index ops echoes, even when the response is out of order', () => {
    const shuffled = { ...result, results: [result.results[1], result.results[0]] };
    const state = applyOpsResult({}, sent, shuffled, 3);
    expect(state.ACoAAB1.status).toBe('ok');        // row 0 → still Max
    expect(state.B.status).toBe('invalid');         // row 1 → still B
  });

  it('does not mutate the previous state', () => {
    const prev = { OLD: { status: 'ok', v: OPS_ROW_VERSION } };
    const next = applyOpsResult(prev, sent, result, 1);
    expect(prev).toEqual({ OLD: { status: 'ok', v: OPS_ROW_VERSION } });
    expect(next.OLD).toEqual({ status: 'ok', v: OPS_ROW_VERSION });
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
    expect(out.summary).toEqual({ at: 7, sent: 2, created: 2, updated: 0, unchanged: 0, invalid: 0, errors: 0,
      error: null, tally: null, caps: null });
  });

  it('sends nothing when nothing is pending', async () => {
    const seen = [];
    const out = await opsSyncRun({ settings, log, state: { ACoAAB1: { status: 'ok', v: OPS_ROW_VERSION }, B: { status: 'ok', v: OPS_ROW_VERSION } }, fetchFn: okFetch(seen), now: 1 });
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

// Fixtures for the blocks below (the older suites keep their own, scoped ones).
const settings = { baseUrl: 'https://ops.example', token: 'ops_' + 'x'.repeat(40) };
function okFetch(seen) {
  return vi.fn(async (url, init) => {
    const body = JSON.parse(init.body);
    seen.push({ url, auth: init.headers.Authorization, commit: body.commit, rows: body.rows });
    return {
      ok: true, status: 200,
      json: async () => ({
        created: body.rows.length, updated: 0, unchanged: 0, invalid: 0, errors: 0,
        results: body.rows.map((r, i) => ({ index: i, decision: 'create', lead_id: 'L' + i }))
      })
    };
  });
}

describe('position and city as their own fields', () => {
  it('splits the search term against the user\'s own cities', () => {
    const row = opsRowFor(rec({ searchQuery: 'Kaufmännischer Leiter berlin' }), ['Berlin']);
    expect(row.search_term).toBe('Kaufmännischer Leiter');
    expect(row.search_city).toBe('Berlin');       // the list's spelling, not the query's
    expect(row.search_query).toBe('Kaufmännischer Leiter berlin');
  });

  it('sends no city rather than a guessed one', () => {
    const row = opsRowFor(rec({ searchQuery: 'Leiter Digitalisierung' }), ['Berlin']);
    expect(row.search_term).toBe('Leiter Digitalisierung');
    expect(row.search_city).toBe(null);
  });

  // ⚠️ `batch.map(opsRowFor)` would hand the ARRAY INDEX to `cities`, and
  // `normalizeCities(0)` answers with the defaults — every city outside the
  // delivered five would silently vanish from the push.
  it('uses the configured cities in a real run, not the row index', async () => {
    const seen = [];
    const log = [rec({ profileId: 'K', profileUrl: 'https://www.linkedin.com/in/k', searchQuery: 'CTO Kiel' })];
    await opsSyncRun({ settings, log, state: {}, cities: ['Kiel'], fetchFn: okFetch(seen), now: 1 });
    expect(seen[0].rows[0].search_city).toBe('Kiel');
  });
});

describe('a contact already acknowledged, after the row shape grew', () => {
  it('is pending once more when its stamp predates the current shape', () => {
    expect(opsPending([rec()], { ACoAAB1: { status: 'ok' } }).length).toBe(1);
    expect(opsPending([rec()], { ACoAAB1: { status: 'ok', v: 1 } }).length).toBe(1);
    expect(opsPending([rec()], { ACoAAB1: { status: 'ok', v: OPS_ROW_VERSION } }).length).toBe(0);
  });

  // Invalid is final — a URL that is not a profile does not become one because
  // the extension learned to send more.
  it('leaves an invalid row alone whatever the stamp says', () => {
    expect(opsPending([rec()], { ACoAAB1: { status: 'invalid' } })).toEqual([]);
  });

  it('is re-pushed exactly once, not on every run', async () => {
    const seen = [];
    const log = [rec()];
    const first = await opsSyncRun({ settings, log, state: { ACoAAB1: { status: 'ok' } }, fetchFn: okFetch(seen), now: 1 });
    expect(seen.length).toBe(1);
    const second = await opsSyncRun({ settings, log, state: first.state, fetchFn: okFetch(seen), now: 2 });
    expect(seen.length).toBe(1);                 // nothing more to say
    expect(second.summary.sent).toBe(0);
  });
});

describe('the tally on the wire', () => {
  const stats = {
    'kaufmännischer leiter|berlin': { term: 'Kaufmännischer Leiter', city: 'Berlin', n: 100, first: 1000, last: 2000 },
    'leiter digitalisierung|': { term: 'Leiter Digitalisierung', city: '', n: 64, first: 1000, last: 3000 }
  };

  it('reports term, city and count, most sent first', () => {
    const rows = opsTallyRows(stats);
    expect(rows[0]).toEqual({
      term: 'Kaufmännischer Leiter', city: 'Berlin', sent: 100,
      first_at: new Date(1000).toISOString(), last_at: new Date(2000).toISOString()
    });
    expect(rows[1].city).toBe(null);             // no city is null, never ''
  });

  it('posts to the tally endpoint with the bearer token', async () => {
    const calls = [];
    const fetchFn = (url, init) => { calls.push({ url, init }); return Promise.resolve({ ok: true, status: 200 }); };
    const out = await opsPushTally({ settings, stats, fetchFn });
    expect(out).toMatchObject({ ok: true, sent: 2 });
    expect(calls[0].url).toBe(settings.baseUrl + OPS_TALLY_PATH);
    expect(JSON.parse(calls[0].init.body).rows.length).toBe(2);
  });

  it('says nothing to say instead of posting an empty tally', async () => {
    const calls = [];
    const out = await opsPushTally({ settings, stats: {}, fetchFn: (u, i) => { calls.push(u); return Promise.resolve({ ok: true }); } });
    expect(out.ok).toBe(true);
    expect(calls.length).toBe(0);
  });

  // An ops that does not have the route yet is a known state, not a fault.
  it('reads 404/405/501 as "this ops cannot take it yet"', async () => {
    for (const status of [404, 405, 501]) {
      const out = await opsPushTally({ settings, stats, fetchFn: () => Promise.resolve({ ok: false, status }) });
      expect(out).toMatchObject({ ok: false, unsupported: true, status });
    }
  });

  it('reports a real failure as one', async () => {
    const out = await opsPushTally({ settings, stats, fetchFn: () => Promise.resolve({ ok: false, status: 500 }) });
    expect(out.unsupported).toBeUndefined();
    expect(out.error).toContain('500');
    const dead = await opsPushTally({ settings, stats, fetchFn: () => Promise.reject(new Error('offline')) });
    expect(dead.error).toContain('offline');
  });
});

describe('the tally inside a run', () => {
  const stats = { 'cto|berlin': { term: 'CTO', city: 'Berlin', n: 3, first: 1, last: 2 } };

  it('goes out after the leads and lands in the summary', async () => {
    const urls = [];
    const fetchFn = (url, init) => {
      urls.push(url);
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ results: [{ index: 0, decision: 'create', lead_id: 'L1' }], created: 1 }) });
    };
    const out = await opsSyncRun({ settings, log: [rec()], state: {}, stats, fetchFn, now: 7 });
    expect(urls[urls.length - 1]).toContain(OPS_TALLY_PATH);
    expect(out.summary.tally).toMatchObject({ ok: true, sent: 1 });
  });

  // The leads are the work, the counts are the report: an ops without the
  // route must not turn a successful push into a failed sync.
  it('never fails the sync because the tally could not be delivered', async () => {
    const fetchFn = (url) => url.includes('/tally')
      ? Promise.resolve({ ok: false, status: 404 })
      : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ results: [{ index: 0, decision: 'create' }], created: 1 }) });
    const out = await opsSyncRun({ settings, log: [rec()], state: {}, stats, fetchFn, now: 7 });
    expect(out.error).toBe(null);
    expect(out.summary.created).toBe(1);
    expect(out.summary.tally).toMatchObject({ unsupported: true });
  });

  it('does not report counts when the leads did not get through', async () => {
    const urls = [];
    const fetchFn = (url) => { urls.push(url); return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({ detail: 'nope' }) }); };
    const out = await opsSyncRun({ settings, log: [rec()], state: {}, stats, fetchFn, now: 7 });
    expect(out.error).toContain('401');
    expect(urls.some((u) => u.includes('/tally'))).toBe(false);
    expect(out.summary.tally).toBe(null);
  });
});

describe('what ops says it understood', () => {
  it('reads the echoed field list, and stays silent when there is none', () => {
    expect(opsCapsFrom({})).toBe(null);
    expect(opsCapsFrom({ accepted_fields: ['profile_url'] })).toMatchObject({ searchFields: false });
    expect(opsCapsFrom({ accepted_fields: ['search_term', 'search_city'] })).toMatchObject({ searchFields: true });
  });

  // Only the transition counts. Re-pushing on every run because ops keeps
  // saying "yes" would be a loop, and re-pushing on first contact is pointless
  // — that run already sent the fields.
  it('is a gain only when ops previously said no', () => {
    expect(opsCapsGained({ searchFields: false }, { searchFields: true })).toBe(true);
    expect(opsCapsGained(null, { searchFields: true })).toBe(false);
    expect(opsCapsGained({ searchFields: true }, { searchFields: true })).toBe(false);
    expect(opsCapsGained({ searchFields: false }, { searchFields: false })).toBe(false);
  });

  it('drops the stamp off acknowledged rows only', () => {
    const next = opsClearRowVersions({
      A: { status: 'ok', v: 2 }, B: { status: 'invalid' }, C: { status: 'error' }
    });
    expect(next.A.v).toBe(0);
    expect(next.B).toEqual({ status: 'invalid' });
    expect(next.C).toEqual({ status: 'error' });
  });
});

describe('the capability probe', () => {
  const stats = {};

  it('asks once when ops said no and there is nothing to push — rows empty, commit false', async () => {
    const calls = [];
    const fetchFn = vi.fn(async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({ accepted_fields: ['search_term', 'search_city'] }) };
    });
    const out = await opsSyncRun({ settings, log: [], state: {}, stats, caps: { searchFields: false }, fetchFn, now: 1 });
    expect(calls.length).toBe(1);
    expect(calls[0].body).toEqual({ rows: [], commit: false });   // writes nothing
    expect(out.summary.caps).toMatchObject({ searchFields: true });
  });

  // An ops that never echoes anything must not be pinged on every click for a
  // signal it does not send.
  it('stays silent when ops has never said anything about the fields', async () => {
    const fetchFn = vi.fn();
    await opsSyncRun({ settings, log: [], state: {}, stats, caps: null, fetchFn, now: 1 });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('stays silent once ops confirmed it reads them', async () => {
    const fetchFn = vi.fn();
    await opsSyncRun({ settings, log: [], state: {}, stats, caps: { searchFields: true }, fetchFn, now: 1 });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('does not probe when there is real work to do — the push answers anyway', async () => {
    const seen = [];
    await opsSyncRun({ settings, log: [rec()], state: {}, caps: { searchFields: false }, fetchFn: okFetch(seen), now: 1 });
    expect(seen.length).toBe(1);
    expect(seen[0].commit).toBe(true);
  });

  it('a failing probe changes nothing', async () => {
    const out = await opsSyncRun({
      settings, log: [], state: {}, caps: { searchFields: false },
      fetchFn: () => Promise.reject(new Error('offline')), now: 1
    });
    expect(out.error).toBe(null);
    expect(out.summary.caps).toBe(null);
  });
});

