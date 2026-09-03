import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import LC from '../lib.js';

// --- the backfill that runs on every LinkedIn page load ---------------------
describe('backfillEvents', () => {
  const now = Date.parse('2026-09-01T12:00:00.000Z');
  const log = (n) => Array.from({ length: n }, (_, i) => ({
    ts: new Date(now - i * 60000).toISOString(), profileId: 'P' + i
  }));

  it('turns a contact log into a sorted timestamp series', () => {
    const out = LC.backfillEvents(log(3), { now });
    expect(out).toEqual([now - 120000, now - 60000, now]);
  });

  it('skips records without a usable timestamp instead of writing NaN', () => {
    const out = LC.backfillEvents(
      [{ ts: new Date(now).toISOString() }, {}, null, { ts: 'not a date' }], { now });
    expect(out).toEqual([now]);
  });

  it('drops records older than the retention window', () => {
    const old = { ts: new Date(now - 500 * 86400000).toISOString() };
    expect(LC.backfillEvents([old, { ts: new Date(now).toISOString() }], { now })).toEqual([now]);
  });

  it('keeps the newest entries when the log exceeds the cap', () => {
    const out = LC.backfillEvents(log(5), { now, cap: 2 });
    expect(out).toEqual([now - 60000, now]);
  });

  it('survives an empty or missing log', () => {
    expect(LC.backfillEvents([], { now })).toEqual([]);
    expect(LC.backfillEvents(undefined, { now })).toEqual([]);
  });

  it('stays linear-ish: a full 5000-entry log must not stall the page', () => {
    // Appending one at a time re-sorted the whole series per record — measured
    // 619ms for 5000 entries, and it grew as n². This runs synchronously in the
    // content script on every LinkedIn page load.
    const big = log(5000);
    const t0 = performance.now();
    const out = LC.backfillEvents(big, { now });
    const ms = performance.now() - t0;
    expect(out.length).toBe(5000);
    expect(ms).toBeLessThan(100);
  });
});

// --- the content script surviving an extension reload -----------------------
describe('content script: extension context invalidated', () => {
  let storage, listeners, badge, opts;

  function setupChrome(options) {
    const o = opts = options || {};
    storage = { lcPace: { jitter: false } };   // fixed beat; jitter is tested in content-pace.test.js
    listeners = [];
    globalThis.chrome = {
      runtime: {
        get id() { return o.contextGone ? undefined : 'abc'; },
        lastError: null,
        onMessage: { addListener(fn) { listeners.push(fn); } }
      },
      storage: {
        local: {
          get(keys, cb) {
            if (o.throwOnGet) throw new Error('Extension context invalidated.');
            const out = {};
            for (const k of keys) if (k in storage) out[k] = storage[k];
            cb(out);
          },
          set(obj, cb) {
            if (o.throwOnSet) throw new Error('Extension context invalidated.');
            Object.assign(storage, obj);
            if (cb) cb();
          },
          remove(key) { delete storage[key]; }
        }
      }
    };
  }

  function buildCard() {
    const card = document.createElement('div');
    card.setAttribute('componentkey', 'SearchResultsACoAAB1');
    card.innerHTML = `
      <a href="/in/max-mustermann/"><span>Max Mustermann</span></a>
      <a href="/in/max-mustermann/" aria-label="Max Mustermann als Kontakt einladen">Vernetzen</a>`;
    document.body.appendChild(card);
  }

  async function load() {
    vi.resetModules();
    await import('../content.js');
    badge = document.getElementById('lc-badge');
    return listeners[listeners.length - 1];
  }

  async function flush() { for (let i = 0; i < 40; i++) await Promise.resolve(); }

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    document.cookie = 'JSESSIONID="ajax:1"';
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('') }));
  });

  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  // Break storage only AFTER startup, so the failing call is the one inside the
  // tick. Otherwise the load-time write throws first and its own guard reports
  // the problem — which would let a missing guard on the write path pass.
  async function runUntilItGivesUp() {
    setupChrome({});
    buildCard();
    const handle = await load();
    handle({ action: 'toggle', enabled: true }, null, () => {});
    opts.throwOnSet = true;
    await vi.advanceTimersByTimeAsync(1600);
    await flush();
    return handle;
  }

  it('says "reload the page" on the badge instead of failing silently', async () => {
    await runUntilItGivesUp();
    expect(badge.textContent).toMatch(/reload/i);
  });

  it('tears down its own scan timer rather than leaving it running', async () => {
    setupChrome({});
    buildCard();
    const handle = await load();
    handle({ action: 'toggle', enabled: true }, null, () => {});
    const running = vi.getTimerCount();
    opts.throwOnSet = true;
    await vi.advanceTimersByTimeAsync(1600);
    await flush();
    expect(vi.getTimerCount()).toBeLessThan(running);
  });

  it('stops scanning once the context is gone, rather than spinning forever', async () => {
    await runUntilItGivesUp();
    const callsAfterFirstTick = globalThis.fetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10000);
    await flush();
    expect(globalThis.fetch.mock.calls.length).toBe(callsAfterFirstTick);
  });

  it('reports "inactive" to the popup once it has given up', async () => {
    const handle = await runUntilItGivesUp();
    let status = null;
    handle({ action: 'getStatus' }, null, (r) => { status = r; });
    expect(status.active).toBe(false);
    expect(status.contextGone).toBe(true);
  });

  it('does not even start when the context is already gone at load', async () => {
    setupChrome({ contextGone: true, throwOnGet: true });
    buildCard();
    const handle = await load();
    handle({ action: 'toggle', enabled: true }, null, () => {});
    await vi.advanceTimersByTimeAsync(5000);
    await flush();

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(badge.textContent).toMatch(/reload/i);
  });

  it('runs normally while the context is healthy', async () => {
    setupChrome({});
    buildCard();
    const handle = await load();
    handle({ action: 'toggle', enabled: true }, null, () => {});
    await vi.advanceTimersByTimeAsync(1600);
    await flush();

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(badge.textContent).not.toMatch(/reload/i);
    expect(storage.lcEvents.length).toBe(1);
  });
});
