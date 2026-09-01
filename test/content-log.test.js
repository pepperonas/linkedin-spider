import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

await import('../lib.js');

let storage;
let listeners;
let fetchCalls;

function setupChrome() {
  storage = {};
  listeners = [];
  globalThis.chrome = {
    runtime: {
      lastError: null,
      onMessage: { addListener(fn) { listeners.push(fn); } }
    },
    storage: {
      local: {
        get(keys, cb) {
          const out = {};
          for (const k of keys) if (k in storage) out[k] = storage[k];
          cb(out);
        },
        set(obj, cb) { Object.assign(storage, obj); if (cb) cb(); },
        remove(key) { delete storage[key]; }
      }
    }
  };
}

function buildSearchCard() {
  const card = document.createElement('div');
  card.setAttribute('componentkey', 'SearchResultsACoAAB1');
  card.innerHTML = `
    <a href="/in/max-mustermann-1a2b3c/"><span>Max Mustermann</span></a>
    <span>· 2.</span>
    <span><span>Senior Backend Engineer bei Acme GmbH</span></span>
    <span>Berlin, Deutschland</span>
    <a href="/in/max-mustermann-1a2b3c/" aria-label="Max Mustermann als Kontakt einladen">Vernetzen</a>`;
  document.body.appendChild(card);
  return card;
}

async function loadContentScript() {
  vi.resetModules();
  await import('../content.js');
}

// Let the async tick() chain (fetch -> storage) run to completion.
async function flush() {
  for (let i = 0; i < 40; i++) await Promise.resolve();
}

describe('content script contact log', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    document.cookie = 'JSESSIONID="ajax:1234567890"';
    setupChrome();
    fetchCalls = [];
    globalThis.fetch = vi.fn((url, init) => {
      fetchCalls.push({ url, init });
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('') });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function runOneTick() {
    await loadContentScript();
    const handle = listeners[listeners.length - 1];
    handle({ action: 'toggle', enabled: true }, null, () => {});
    await vi.advanceTimersByTimeAsync(1600);
    await flush();
    return handle;
  }

  it('writes a log record for a successful invitation', async () => {
    buildSearchCard();
    await runOneTick();

    expect(fetchCalls.length).toBe(1);
    expect(storage.lcLog).toBeDefined();
    expect(storage.lcLog.length).toBe(1);

    const rec = storage.lcLog[0];
    expect(rec.name).toBe('Max Mustermann');
    expect(rec.profileId).toBe('ACoAAB1');
    expect(rec.profileUrl).toBe('https://www.linkedin.com/in/max-mustermann-1a2b3c');
    expect(rec.headline).toBe('Senior Backend Engineer bei Acme GmbH');
    expect(rec.company).toBe('Acme GmbH');
    expect(rec.location).toBe('Berlin, Deutschland');
    expect(rec.degree).toBe('2.');
    expect(rec.method).toBe('api');
    expect(Number.isNaN(Date.parse(rec.ts))).toBe(false);
  });

  it('records the page the request was sent from', async () => {
    buildSearchCard();
    await runOneTick();
    expect(storage.lcLog[0].pageUrl).toBe(location.href);
  });

  it('writes nothing when the invitation fails', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('boom') }));
    buildSearchCard();
    await loadContentScript();
    listeners[listeners.length - 1]({ action: 'toggle', enabled: true }, null, () => {});
    await vi.advanceTimersByTimeAsync(1600);
    await flush();

    expect(storage.lcLog === undefined || storage.lcLog.length === 0).toBe(true);
  });

  it('never asks a profile that is already in the stored log', async () => {
    storage.lcLog = [{ ts: '2026-08-01T00:00:00.000Z', name: 'Max Mustermann', profileId: 'ACoAAB1' }];
    buildSearchCard();
    await runOneTick();

    expect(fetchCalls.length).toBe(0);
    expect(storage.lcLog.length).toBe(1);
  });

  it('clearLog empties the store and lifts the skip list', async () => {
    storage.lcLog = [{ ts: 't', name: 'Max Mustermann', profileId: 'ACoAAB1' }];
    buildSearchCard();
    const handle = await runOneTick();
    expect(fetchCalls.length).toBe(0); // skipped, as expected

    handle({ action: 'clearLog' }, null, () => {});
    expect(storage.lcLog).toEqual([]);

    // same person, same page — now reachable again
    await vi.advanceTimersByTimeAsync(1600);
    await flush();
    expect(fetchCalls.length).toBe(1);
  });

  it('records a send timestamp so the weekly quota can count it', async () => {
    buildSearchCard();
    await runOneTick();

    expect(Array.isArray(storage.lcEvents)).toBe(true);
    expect(storage.lcEvents.length).toBe(1);
    expect(storage.lcEvents[0]).toBe(Date.parse(storage.lcLog[0].ts));
  });

  it('writes no timestamp when the invitation fails', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('boom') }));
    buildSearchCard();
    await loadContentScript();
    listeners[listeners.length - 1]({ action: 'toggle', enabled: true }, null, () => {});
    await vi.advanceTimersByTimeAsync(1600);
    await flush();

    expect(storage.lcEvents === undefined || storage.lcEvents.length === 0).toBe(true);
  });

  it('seeds the quota history from an existing log on first run after the upgrade', async () => {
    storage.lcLog = [
      { ts: '2026-08-30T10:00:00.000Z', name: 'A', profileId: 'A1' },
      { ts: '2026-08-31T10:00:00.000Z', name: 'B', profileId: 'B1' }
    ];
    await loadContentScript();
    expect(storage.lcEvents).toEqual([
      Date.parse('2026-08-30T10:00:00.000Z'),
      Date.parse('2026-08-31T10:00:00.000Z')
    ]);
  });

  it('does not re-seed once the history exists, not even when it is empty', async () => {
    storage.lcLog = [{ ts: '2026-08-30T10:00:00.000Z', name: 'A', profileId: 'A1' }];
    storage.lcEvents = [];
    await loadContentScript();
    expect(storage.lcEvents).toEqual([]);
  });

  it('shows the weekly quota on the in-page badge', async () => {
    buildSearchCard();
    await runOneTick();
    const badge = document.getElementById('lc-badge');
    expect(badge.textContent).toMatch(/1\/200/);
  });

  it('keeps the quota history when the contact log is cleared', async () => {
    buildSearchCard();
    const handle = await runOneTick();
    expect(storage.lcEvents.length).toBe(1);

    handle({ action: 'clearLog' }, null, () => {});
    expect(storage.lcLog).toEqual([]);
    expect(storage.lcEvents.length).toBe(1);
  });

  it('keeps the log when only the counter is reset', async () => {
    buildSearchCard();
    const handle = await runOneTick();
    expect(storage.lcLog.length).toBe(1);

    handle({ action: 'resetCount' }, null, () => {});
    expect(storage.lcCount).toBe(0);
    expect(storage.lcLog.length).toBe(1);
  });
});
