import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The worker calls importScripts('lib.js') and reads self.LC — in jsdom, self
// is window, so loading lib.js up front and stubbing importScripts is enough.
await import('../lib.js');
globalThis.importScripts = () => {};

let storage, messageListeners, changeListeners, fetchCalls, fetchImpl;

let permissions;

function setupChrome() {
  storage = {};
  messageListeners = [];
  changeListeners = [];
  permissions = { granted: new Set() };
  globalThis.chrome = {
    runtime: {
      lastError: null,
      getManifest: () => ({ version: '2.11.0' }),
      onMessage: { addListener(fn) { messageListeners.push(fn); } }
    },
    permissions: {
      contains(q, cb) { cb(q.origins.every((o) => permissions.granted.has(o))); }
    },
    storage: {
      local: {
        get(keys, cb) { const out = {}; for (const k of keys) if (k in storage) out[k] = storage[k]; cb(out); },
        set(obj, cb) { Object.assign(storage, obj); if (cb) cb(); }
      },
      onChanged: { addListener(fn) { changeListeners.push(fn); } }
    }
  };
}

const TOKEN = 'ops_' + 'k'.repeat(40);
const rec = (id) => ({ ts: '2026-09-01T12:00:00.000Z', name: 'P' + id, profileUrl: 'https://www.linkedin.com/in/p' + id, profileId: id, method: 'api' });

// ops answers the import POST and — since 2.12.0 — the blocklist GET.
let blocklistReply = { norms: ['linkedin.com/in/closed-one'], count: 1, generated_at: 't' };
// Since 2.15.0: the tally route, and what ops echoes about the fields it read.
let tallyReply = null;
let acceptedFields = null;
function okServer() {
  return async (url, init) => {
    if ((init.method || 'GET') === 'GET') {
      fetchCalls.push({ url, auth: init.headers.Authorization, method: 'GET' });
      if (blocklistReply instanceof Error) throw blocklistReply;
      if (typeof blocklistReply === 'number') return { ok: false, status: blocklistReply, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => blocklistReply };
    }
    const body = JSON.parse(init.body);
    fetchCalls.push({ url, auth: init.headers.Authorization, body });
    if (url.includes('/tally')) {
      if (typeof tallyReply === 'number') return { ok: false, status: tallyReply };
      return { ok: true, status: 200, json: async () => ({ stored: body.rows.length }) };
    }
    const answer = { created: body.rows.length, updated: 0, unchanged: 0, invalid: 0, errors: 0,
      results: body.rows.map((r, i) => ({ index: i, decision: 'create', lead_id: 'L' + i, changes: [] })) };
    if (acceptedFields) answer.accepted_fields = acceptedFields;
    return { ok: true, status: 200, json: async () => answer };
  };
}

async function loadWorker() {
  vi.resetModules();
  await import('../background.js');
  return messageListeners[messageListeners.length - 1];
}

function send(handle, msg) {
  return new Promise((resolve) => { handle(msg, null, resolve); });
}

describe('background worker: ops sync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setupChrome();
    fetchCalls = [];
    tallyReply = null;
    acceptedFields = null;
    fetchImpl = okServer();
    globalThis.fetch = vi.fn((...a) => fetchImpl(...a));
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('pushes pending contacts on request and records the outcome', async () => {
    storage.lcOps = { baseUrl: 'https://ops.celox.io', token: TOKEN, auto: false };
    storage.lcLog = [rec('A'), rec('B')];
    const handle = await loadWorker();
    const resp = await send(handle, { action: 'opsSync' });

    const posts = fetchCalls.filter((c) => c.body);
    expect(posts.length).toBe(1);
    expect(posts[0].url).toBe('https://ops.celox.io/api/rainmaker/leads/import/linkedin-spider');
    expect(fetchCalls[0].auth).toBe('Bearer ' + TOKEN);
    expect(fetchCalls[0].body.commit).toBe(true);
    expect(resp.ok).toBe(true);
    expect(resp.summary.sent).toBe(2);
    expect(storage.lcOpsState.A.status).toBe('ok');
    expect(storage.lcOpsState.B.status).toBe('ok');
    expect(storage.lcOpsLast.sent).toBe(2);
    expect(storage.lcOpsLast.trigger).toBe('manual');
  });

  it('does nothing — not even a request — when ops is not set up', async () => {
    storage.lcLog = [rec('A')];
    const handle = await loadWorker();
    const resp = await send(handle, { action: 'opsSync' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(resp.ok).toBe(false);
    expect(resp.error).toMatch(/not configured/);
    expect(storage.lcOpsState).toBeUndefined();
  });

  it('never rewrites the contact log itself', async () => {
    storage.lcOps = { baseUrl: 'https://ops.celox.io', token: TOKEN, auto: false };
    const log = [rec('A')];
    storage.lcLog = log;
    const handle = await loadWorker();
    await send(handle, { action: 'opsSync' });
    expect(storage.lcLog).toBe(log);            // same array, untouched
    expect(storage.lcLog[0].ops).toBeUndefined();
  });

  it('keeps the state untouched and reports the error on a 401', async () => {
    storage.lcOps = { baseUrl: 'https://ops.celox.io', token: TOKEN, auto: false };
    storage.lcLog = [rec('A')];
    fetchImpl = async () => ({ ok: false, status: 401, json: async () => ({ detail: 'API-Token ungültig oder widerrufen' }) });
    const handle = await loadWorker();
    const resp = await send(handle, { action: 'opsSync' });
    expect(resp.ok).toBe(false);
    expect(resp.error).toMatch(/401/);
    expect(storage.lcOpsState).toEqual({});
    expect(storage.lcOpsLast.error).toMatch(/Token/);
  });

  it('tests a connection with an empty preview — no rows, no commit', async () => {
    const handle = await loadWorker();
    const resp = await send(handle, { action: 'opsTest', settings: { baseUrl: 'https://ops.celox.io/', token: TOKEN } });
    expect(resp.ok).toBe(true);
    expect(fetchCalls[0].body).toEqual({ rows: [], commit: false });
    expect(fetchCalls[0].auth).toBe('Bearer ' + TOKEN);
  });

  it('rejects a test with a bad token before touching the network', async () => {
    const handle = await loadWorker();
    const resp = await send(handle, { action: 'opsTest', settings: { baseUrl: 'https://ops.celox.io', token: 'nope' } });
    expect(resp.ok).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('auto-syncs a few seconds after a new log entry, once per burst', async () => {
    storage.lcOps = { baseUrl: 'https://ops.celox.io', token: TOKEN, auto: true };
    storage.lcLog = [rec('A')];
    await loadWorker();
    const onChanged = changeListeners[changeListeners.length - 1];

    onChanged({ lcLog: { newValue: storage.lcLog } }, 'local');
    storage.lcLog = [rec('A'), rec('B')];
    onChanged({ lcLog: { newValue: storage.lcLog } }, 'local');
    expect(fetchCalls.length).toBe(0);            // debounced, nothing yet

    await vi.advanceTimersByTimeAsync(3100);
    const posts = fetchCalls.filter((c) => c.body);
    expect(posts.length).toBe(1);                 // one run for the burst
    expect(posts[0].body.rows.length).toBe(2);
    expect(storage.lcOpsLast.trigger).toBe('auto');
  });

  it('stays quiet on log changes while auto-sync is off', async () => {
    storage.lcOps = { baseUrl: 'https://ops.celox.io', token: TOKEN, auto: false };
    storage.lcLog = [rec('A')];
    await loadWorker();
    changeListeners[changeListeners.length - 1]({ lcLog: { newValue: storage.lcLog } }, 'local');
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchCalls.length).toBe(0);
  });

  it('ignores changes to unrelated keys and other storage areas', async () => {
    storage.lcOps = { baseUrl: 'https://ops.celox.io', token: TOKEN, auto: true };
    storage.lcLog = [rec('A')];
    await loadWorker();
    const onChanged = changeListeners[changeListeners.length - 1];
    onChanged({ lcCount: { newValue: 5 } }, 'local');
    onChanged({ lcLog: { newValue: [] } }, 'sync');
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchCalls.length).toBe(0);
  });

  it('never runs two syncs at once — a second request waits for the first', async () => {
    storage.lcOps = { baseUrl: 'https://ops.celox.io', token: TOKEN, auto: false };
    storage.lcLog = [rec('A')];
    let release;
    fetchImpl = (url, init) => new Promise((resolve, reject) => {
      if (init.method === 'GET') { reject(new Error('no blocklist in this test')); return; }
      const body = JSON.parse(init.body);
      fetchCalls.push({ url, body });
      release = () => resolve({ ok: true, status: 200, json: async () => ({ created: body.rows.length, updated: 0, unchanged: 0, invalid: 0, errors: 0,
        results: body.rows.map((r, i) => ({ index: i, decision: 'create', lead_id: 'L', changes: [] })) }) });
    });
    const handle = await loadWorker();
    const p1 = send(handle, { action: 'opsSync' });
    const p2 = send(handle, { action: 'opsSync' });
    await Promise.resolve(); await Promise.resolve();
    expect(fetchCalls.length).toBe(1);            // second did not start a parallel request
    release();
    await p1; await p2;
    await vi.advanceTimersByTimeAsync(10);
    // the queued rerun found nothing pending, so no second request was needed
    expect(fetchCalls.length).toBe(1);
  });
});

describe('background worker: ops blocklist (the back channel)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setupChrome();
    fetchCalls = [];
    blocklistReply = { norms: ['linkedin.com/in/closed-one', 'linkedin.com/in/customer'], count: 2, generated_at: 't' };
    fetchImpl = okServer();
    globalThis.fetch = vi.fn((...a) => fetchImpl(...a));
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('every sync also fetches the blocklist and stores it under lcBlock', async () => {
    storage.lcOps = { baseUrl: 'https://ops.celox.io', token: TOKEN, auto: false };
    storage.lcLog = [rec('A')];
    const handle = await loadWorker();
    const resp = await send(handle, { action: 'opsSync' });
    const gets = fetchCalls.filter((c) => c.method === 'GET');
    expect(gets.length).toBe(1);
    expect(gets[0].url).toBe('https://ops.celox.io/api/rainmaker/leads/import/linkedin-spider/blocklist');
    expect(gets[0].auth).toBe('Bearer ' + TOKEN);
    expect(storage.lcBlock.norms).toEqual(['linkedin.com/in/closed-one', 'linkedin.com/in/customer']);
    expect(storage.lcBlock.count).toBe(2);
    expect(typeof storage.lcBlock.at).toBe('number');
    expect(resp.ok).toBe(true);
    expect(resp.blocklist).toEqual({ ok: true, count: 2 });
    expect(storage.lcOpsLast.blocklist).toEqual({ ok: true, count: 2 });
  });

  it('a failing blocklist fetch neither fails the sync nor drops the old list', async () => {
    storage.lcOps = { baseUrl: 'https://ops.celox.io', token: TOKEN, auto: false };
    storage.lcLog = [rec('A')];
    storage.lcBlock = { at: 1, norms: ['linkedin.com/in/old'], count: 1 };
    blocklistReply = 500;
    const handle = await loadWorker();
    const resp = await send(handle, { action: 'opsSync' });
    expect(resp.ok).toBe(true);                          // the push went through
    expect(storage.lcOpsState.A.status).toBe('ok');
    expect(storage.lcBlock.norms).toEqual(['linkedin.com/in/old']);
    expect(resp.blocklist.ok).toBe(false);
    expect(resp.blocklist.error).toMatch(/500/);
  });

  it('refreshes the list alone on request — no import POST', async () => {
    storage.lcOps = { baseUrl: 'https://ops.celox.io', token: TOKEN, auto: false };
    storage.lcLog = [rec('A')];
    const handle = await loadWorker();
    const resp = await send(handle, { action: 'opsBlocklist' });
    expect(fetchCalls.filter((c) => c.body).length).toBe(0);
    expect(fetchCalls.filter((c) => c.method === 'GET').length).toBe(1);
    expect(resp).toEqual({ ok: true, count: 2 });
    expect(storage.lcBlock.count).toBe(2);
    expect(storage.lcOpsState).toBeUndefined();          // nothing was pushed
  });

  it('does not fetch without a configured token', async () => {
    const handle = await loadWorker();
    const resp = await send(handle, { action: 'opsBlocklist' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(resp.ok).toBe(false);
    expect(storage.lcBlock).toBeUndefined();
  });

  it('never stores a payload that is not a blocklist', async () => {
    storage.lcOps = { baseUrl: 'https://ops.celox.io', token: TOKEN, auto: false };
    storage.lcBlock = { at: 1, norms: ['linkedin.com/in/old'], count: 1 };
    blocklistReply = { detail: 'something else entirely' };
    const handle = await loadWorker();
    const resp = await send(handle, { action: 'opsBlocklist' });
    expect(resp.ok).toBe(false);
    expect(storage.lcBlock.norms).toEqual(['linkedin.com/in/old']);
  });
});

describe('background worker: update check (opt-in)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setupChrome();
    fetchCalls = [];
    fetchImpl = async (url) => { fetchCalls.push({ url }); return { ok: true, status: 200, json: async () => ({ tag_name: 'v2.12.0', html_url: 'https://github.com/pepperonas/linkedin-spider/releases/tag/v2.12.0' }) }; };
    globalThis.fetch = vi.fn((...a) => fetchImpl(...a));
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('does not touch the network without the api.github.com permission', async () => {
    const handle = await loadWorker();
    const resp = await send(handle, { action: 'checkUpdate' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(resp.ok).toBe(false);
    expect(resp.reason).toBe('permission');
    expect(storage.lcUpdate).toBeUndefined();
  });

  it('asks GitHub once permission is there and records what it learned', async () => {
    permissions.granted.add('https://api.github.com/*');
    const handle = await loadWorker();
    const resp = await send(handle, { action: 'checkUpdate' });
    expect(fetchCalls[0].url).toBe('https://api.github.com/repos/pepperonas/linkedin-spider/releases/latest');
    expect(resp.ok).toBe(true);
    expect(resp.latest).toBe('2.12.0');
    expect(resp.available).toBe(true);
    expect(storage.lcUpdate.latest).toBe('2.12.0');
    expect(storage.lcUpdate.url).toMatch(/releases\/tag\/v2\.12\.0$/);
    expect(storage.lcUpdate.available).toBe(true);
    expect(typeof storage.lcUpdate.checkedAt).toBe('number');
  });

  it('says "up to date" when the latest release is the installed one', async () => {
    permissions.granted.add('https://api.github.com/*');
    fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ tag_name: 'v2.11.0', html_url: 'https://github.com/pepperonas/linkedin-spider/releases/tag/v2.11.0' }) });
    const handle = await loadWorker();
    const resp = await send(handle, { action: 'checkUpdate' });
    expect(resp.available).toBe(false);
    expect(storage.lcUpdate.available).toBe(false);
  });

  it('asks at most once a day unless forced', async () => {
    permissions.granted.add('https://api.github.com/*');
    storage.lcUpdate = { checkedAt: Date.now() - 60_000, latest: '2.11.0', available: false, url: 'https://github.com/pepperonas/linkedin-spider/releases' };
    const handle = await loadWorker();
    const cached = await send(handle, { action: 'checkUpdate' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(cached.ok).toBe(true);
    expect(cached.cached).toBe(true);
    await send(handle, { action: 'checkUpdate', force: true });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the old answer and reports the problem when GitHub is unreachable', async () => {
    permissions.granted.add('https://api.github.com/*');
    fetchImpl = async () => { throw new TypeError('Failed to fetch'); };
    storage.lcUpdate = { checkedAt: 0, latest: '2.11.0', available: false, url: 'x' };
    const handle = await loadWorker();
    const resp = await send(handle, { action: 'checkUpdate' });
    expect(resp.ok).toBe(false);
    expect(resp.error).toMatch(/Failed to fetch/);
    expect(storage.lcUpdate.latest).toBe('2.11.0');   // untouched
  });

  it('ignores a malformed or off-site payload', async () => {
    permissions.granted.add('https://api.github.com/*');
    fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ tag_name: 'v9.9.9', html_url: 'https://evil.example/download' }) });
    const handle = await loadWorker();
    const resp = await send(handle, { action: 'checkUpdate' });
    expect(resp.ok).toBe(false);
    expect(storage.lcUpdate).toBeUndefined();
  });
});

describe('background worker: positions and the tally', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setupChrome();
    fetchCalls = [];
    tallyReply = null;
    acceptedFields = null;
    fetchImpl = okServer();
    globalThis.fetch = vi.fn((...a) => fetchImpl(...a));
    storage.lcOps = { baseUrl: 'https://ops.celox.io', token: TOKEN, auto: false };
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  const posts = (part) => fetchCalls.filter((c) => c.body && c.url.includes(part));

  it('sends the position and the city with every contact', async () => {
    storage.lcLog = [{ ...rec('A'), searchQuery: 'Kaufmännischer Leiter berlin' }];
    storage.lcCities = ['Berlin'];
    const handle = await loadWorker();
    await send(handle, { action: 'opsSync' });
    const row = posts('/import/linkedin-spider').find((c) => Array.isArray(c.body.rows) && c.body.rows.length).body.rows[0];
    expect(row.search_term).toBe('Kaufmännischer Leiter');
    expect(row.search_city).toBe('Berlin');
  });

  // The worker must hand the CONFIGURED cities down, not let Array.map pass an
  // index into that argument — with the defaults, "Kiel" would vanish.
  it('uses the cities the user configured, not the delivered ones', async () => {
    storage.lcLog = [{ ...rec('A'), searchQuery: 'CTO Kiel' }];
    storage.lcCities = ['Kiel'];
    const handle = await loadWorker();
    await send(handle, { action: 'opsSync' });
    expect(posts('/import/linkedin-spider')[0].body.rows[0].search_city).toBe('Kiel');
  });

  it('reports the tally after the contacts and remembers the outcome', async () => {
    storage.lcLog = [rec('A')];
    storage.lcStats = { 'cto|berlin': { term: 'CTO', city: 'Berlin', n: 12, first: 1, last: 2 } };
    const handle = await loadWorker();
    const resp = await send(handle, { action: 'opsSync' });
    const tally = posts('/tally');
    expect(tally.length).toBe(1);
    expect(tally[0].body.rows[0]).toMatchObject({ term: 'CTO', city: 'Berlin', sent: 12 });
    expect(resp.ok).toBe(true);
    expect(storage.lcOpsLast.tally).toMatchObject({ ok: true, sent: 1 });
  });

  it('still counts the sync a success when ops has no tally route', async () => {
    storage.lcLog = [rec('A')];
    storage.lcStats = { 'cto|berlin': { term: 'CTO', city: 'Berlin', n: 1, first: 1, last: 2 } };
    tallyReply = 404;
    const handle = await loadWorker();
    const resp = await send(handle, { action: 'opsSync' });
    expect(resp.ok).toBe(true);
    expect(storage.lcOpsLast.created).toBe(1);
    expect(storage.lcOpsLast.tally).toMatchObject({ unsupported: true });
  });

  it('remembers what ops said it understood', async () => {
    storage.lcLog = [rec('A')];
    acceptedFields = ['profile_url', 'search_query'];
    const handle = await loadWorker();
    await send(handle, { action: 'opsSync' });
    expect(storage.lcOpsCaps).toMatchObject({ searchFields: false });
  });

  // The one case worth automating: ops gains the fields, so everything it
  // acknowledged before was stored without them.
  it('re-pushes the acknowledged contacts once when ops learns the fields', async () => {
    storage.lcLog = [rec('A')];
    storage.lcOpsState = { A: { status: 'ok', v: globalThis.LC.OPS_ROW_VERSION } };
    storage.lcOpsCaps = { searchFields: false, at: 1 };
    acceptedFields = ['search_term', 'search_city'];
    const handle = await loadWorker();
    await send(handle, { action: 'opsSync' });
    await vi.advanceTimersByTimeAsync(50);
    // First run had nothing pending; the gain cleared the stamps and the
    // follow-up run delivered the contact again.
    const rows = posts('/import/linkedin-spider').flatMap((c) => c.body.rows);
    expect(rows.length).toBe(1);
    expect(storage.lcOpsState.A.v).toBe(globalThis.LC.OPS_ROW_VERSION);
  });

  it('does not re-push while ops keeps saying yes', async () => {
    storage.lcLog = [rec('A')];
    storage.lcOpsState = { A: { status: 'ok', v: globalThis.LC.OPS_ROW_VERSION } };
    storage.lcOpsCaps = { searchFields: true, at: 1 };
    acceptedFields = ['search_term', 'search_city'];
    const handle = await loadWorker();
    await send(handle, { action: 'opsSync' });
    await vi.advanceTimersByTimeAsync(50);
    expect(posts('/import/linkedin-spider').flatMap((c) => c.body.rows).length).toBe(0);
  });
});

