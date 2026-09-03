import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

await import('../lib.js');

let storage, listeners, fetchCalls, changeListeners;

function setupChrome() {
  storage = { lcPace: { jitter: false } };
  listeners = [];
  changeListeners = [];
  globalThis.chrome = {
    runtime: { id: 'test-extension-id', lastError: null, onMessage: { addListener(fn) { listeners.push(fn); } } },
    storage: {
      onChanged: { addListener(fn) { changeListeners.push(fn); } },
      local: {
        get(keys, cb) { const out = {}; for (const k of keys) if (k in storage) out[k] = storage[k]; cb(out); },
        set(obj, cb) { Object.assign(storage, obj); if (cb) cb(); },
        remove(key) { delete storage[key]; }
      }
    }
  };
}

function card(id, name, vanity) {
  const el = document.createElement('div');
  el.setAttribute('componentkey', 'SearchResults' + id);
  el.innerHTML = `<a href="/in/${vanity}/"><span>${name}</span></a>
    <a href="/in/${vanity}/" aria-label="${name} als Kontakt einladen">Vernetzen</a>`;
  document.body.appendChild(el);
  return el;
}

async function load() {
  vi.resetModules();
  await import('../content.js');
  return listeners[listeners.length - 1];
}
async function flush() { for (let i = 0; i < 60; i++) await Promise.resolve(); }
function status(h) { let out; h({ action: 'getStatus' }, null, (r) => { out = r; }); return out; }

describe('ops blocklist in the content script', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = ''; document.cookie = 'JSESSIONID="ajax:1"';
    setupChrome(); fetchCalls = [];
    window.history.replaceState({}, '', '/search/results/people/');
    globalThis.fetch = vi.fn((url, init) => { fetchCalls.push({ url, init }); return Promise.resolve({ ok: true, status: 200, text: async () => '' }); });
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('skips a card ops has closed and moves on to the next', async () => {
    storage.lcBlock = { at: 1, norms: ['linkedin.com/in/anna-closed'], count: 1 };
    card('A1', 'Anna', 'anna-closed'); card('B2', 'Ben', 'ben');
    const h = await load();
    h({ action: 'toggle', enabled: true }, null, () => {});
    await vi.advanceTimersByTimeAsync(1600); await flush();
    expect(fetchCalls.length).toBe(0);                            // Anna: nothing sent
    expect(document.getElementById('lc-badge').textContent).toMatch(/ops.*Anna/);
    expect(storage.lcLog).toBeUndefined();                         // no log entry either
    await vi.advanceTimersByTimeAsync(1600); await flush();
    expect(fetchCalls.length).toBe(1);                            // Ben goes out
    expect(fetchCalls[0].init.body).toMatch(/B2/);
    expect(status(h).blocked).toBe(1);
  });

  it('walks past a blocked card that carries no profile id (the mark on the element does it)', async () => {
    // ⚠️ With a profile id the seen-set alone would skip the card on the next
    // tick — the first probe removed the data-lc-blocked mark and stayed green.
    // Without an id only the mark keeps the scan from returning the same card.
    storage.lcBlock = { at: 1, norms: ['linkedin.com/in/anna-closed'], count: 1 };
    const el = card('A1', 'Anna', 'anna-closed');
    el.removeAttribute('componentkey');
    card('B2', 'Ben', 'ben');
    const h = await load();
    h({ action: 'toggle', enabled: true }, null, () => {});
    await vi.advanceTimersByTimeAsync(1600); await flush();
    expect(fetchCalls.length).toBe(0);
    await vi.advanceTimersByTimeAsync(1600); await flush();
    expect(fetchCalls.length).toBe(1);
    expect(fetchCalls[0].init.body).toMatch(/B2/);
    expect(status(h).blocked).toBe(1);                            // counted once, not every tick
  });

  it('matches the way ops normalises: country subdomain, tracking junk, case', async () => {
    storage.lcBlock = { at: 1, norms: ['linkedin.com/in/manfred-van-asten-b25ba020a'], count: 1 };
    const el = card('M1', 'Manfred', 'Manfred-Van-Asten-B25BA020A');
    el.querySelectorAll('a').forEach((a) => a.setAttribute('href', 'https://de.linkedin.com/in/Manfred-Van-Asten-B25BA020A/?miniProfileUrn=x'));
    const h = await load();
    h({ action: 'toggle', enabled: true }, null, () => {});
    await vi.advanceTimersByTimeAsync(1600); await flush();
    expect(fetchCalls.length).toBe(0);
  });

  it('picks up a refreshed list without a page reload', async () => {
    card('A1', 'Anna', 'anna'); card('B2', 'Ben', 'ben');
    const h = await load();
    h({ action: 'toggle', enabled: true }, null, () => {});
    await vi.advanceTimersByTimeAsync(1600); await flush();
    expect(fetchCalls.length).toBe(1);                            // Anna sent (list empty)
    changeListeners[0]({ lcBlock: { newValue: { at: 2, norms: ['linkedin.com/in/ben'], count: 1 } } }, 'local');
    await vi.advanceTimersByTimeAsync(1600); await flush();
    expect(fetchCalls.length).toBe(1);                            // Ben skipped
    expect(status(h).blocked).toBe(1);
  });

  it('with no list at all nothing changes', async () => {
    card('A1', 'Anna', 'anna');
    const h = await load();
    h({ action: 'toggle', enabled: true }, null, () => {});
    await vi.advanceTimersByTimeAsync(1600); await flush();
    expect(fetchCalls.length).toBe(1);
    expect(status(h).blocked).toBe(0);
  });

  it('a blocked card does not count as a failure for the circuit breaker', async () => {
    storage.lcBlock = { at: 1, norms: Array.from({ length: 6 }, (_, i) => 'linkedin.com/in/p' + i), count: 6 };
    for (let i = 0; i < 6; i++) card('P' + i, 'P' + i, 'p' + i);
    card('Z9', 'Zoe', 'zoe');
    const h = await load();
    h({ action: 'toggle', enabled: true }, null, () => {});
    await vi.advanceTimersByTimeAsync(1600 * 8); await flush();
    expect(status(h).halted).toBe(null);
    expect(status(h).active).toBe(true);
    expect(fetchCalls.length).toBe(1);                            // Zoe
    expect(status(h).blocked).toBe(6);
  });
});
