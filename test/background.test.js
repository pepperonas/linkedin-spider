import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The worker calls importScripts('lib.js') and reads self.LC — in jsdom, self
// is window, so loading lib.js up front and stubbing importScripts is enough.
await import('../lib.js');
globalThis.importScripts = () => {};

let storage, messageListeners, changeListeners, fetchCalls, fetchImpl;

function setupChrome() {
  storage = {};
  messageListeners = [];
  changeListeners = [];
  globalThis.chrome = {
    runtime: {
      lastError: null,
      onMessage: { addListener(fn) { messageListeners.push(fn); } }
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

function okServer() {
  return async (url, init) => {
    const body = JSON.parse(init.body);
    fetchCalls.push({ url, auth: init.headers.Authorization, body });
    return { ok: true, status: 200, json: async () => ({
      created: body.rows.length, updated: 0, unchanged: 0, invalid: 0, errors: 0,
      results: body.rows.map((r, i) => ({ index: i, decision: 'create', lead_id: 'L' + i, changes: [] })) }) };
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
    fetchImpl = okServer();
    globalThis.fetch = vi.fn((...a) => fetchImpl(...a));
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('pushes pending contacts on request and records the outcome', async () => {
    storage.lcOps = { baseUrl: 'https://ops.celox.io', token: TOKEN, auto: false };
    storage.lcLog = [rec('A'), rec('B')];
    const handle = await loadWorker();
    const resp = await send(handle, { action: 'opsSync' });

    expect(fetchCalls.length).toBe(1);
    expect(fetchCalls[0].url).toBe('https://ops.celox.io/api/rainmaker/leads/import/linkedin-spider');
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
    expect(fetchCalls.length).toBe(1);            // one run for the burst
    expect(fetchCalls[0].body.rows.length).toBe(2);
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
    fetchImpl = (url, init) => new Promise((resolve) => {
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
