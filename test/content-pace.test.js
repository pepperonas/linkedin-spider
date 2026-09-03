import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

await import('../lib.js');

let storage, listeners, fetchCalls, changeListeners;

// NOTE: unlike the other content-script suites this one does NOT pin
// `lcPace.jitter = false` in setupChrome — the jitter itself is under test.
function setupChrome() {
  storage = {};
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
const NOW = new Date(2026, 8, 3, 14, 30, 0).getTime();   // Thu 3 Sep 2026 14:30 local

describe('pacing in the content script', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    document.body.innerHTML = ''; document.cookie = 'JSESSIONID="ajax:1"';
    setupChrome(); fetchCalls = [];
    window.history.replaceState({}, '', '/search/results/people/');
    globalThis.fetch = vi.fn((url, init) => { fetchCalls.push({ url, init }); return Promise.resolve({ ok: true, status: 200, text: async () => '' }); });
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('jitters the beat by default: with random=1 the first tick waits 2100 ms, not 1500', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    card('A1', 'Anna', 'anna');
    const h = await load();
    h({ action: 'toggle', enabled: true }, null, () => {});
    await vi.advanceTimersByTimeAsync(1600); await flush();
    expect(fetchCalls.length).toBe(0);
    await vi.advanceTimersByTimeAsync(600); await flush();
    expect(fetchCalls.length).toBe(1);
  });

  it('ticks on the fixed 1.5-s beat when jitter is switched off', async () => {
    storage.lcPace = { jitter: false };
    vi.spyOn(Math, 'random').mockReturnValue(1);
    card('A1', 'Anna', 'anna');
    const h = await load();
    h({ action: 'toggle', enabled: true }, null, () => {});
    await vi.advanceTimersByTimeAsync(1499); await flush();
    expect(fetchCalls.length).toBe(0);
    await vi.advanceTimersByTimeAsync(2); await flush();
    expect(fetchCalls.length).toBe(1);
  });

  it('re-rolls the delay for every tick, so two consecutive gaps differ', async () => {
    const rolls = [0, 1, 0.5];
    vi.spyOn(Math, 'random').mockImplementation(() => rolls.shift() ?? 0.5);
    card('A1', 'Anna', 'anna'); card('B2', 'Ben', 'ben');
    const h = await load();
    h({ action: 'toggle', enabled: true }, null, () => {});
    await vi.advanceTimersByTimeAsync(900); await flush();       // 1st roll 0 → 900 ms
    expect(fetchCalls.length).toBe(1);
    await vi.advanceTimersByTimeAsync(2000); await flush();      // 2nd roll 1 → 2100 ms, not yet
    expect(fetchCalls.length).toBe(1);
    await vi.advanceTimersByTimeAsync(200); await flush();
    expect(fetchCalls.length).toBe(2);
  });

  it('holds the hourly cap: nothing is sent, the run is paused (not halted) and says so', async () => {
    storage.lcPace = { jitter: false, perHour: 2 };
    storage.lcEvents = [NOW - 50 * 60000, NOW - 10 * 60000];
    card('A1', 'Anna', 'anna');
    const h = await load();
    h({ action: 'toggle', enabled: true }, null, () => {});
    await vi.advanceTimersByTimeAsync(1600); await flush();
    expect(fetchCalls.length).toBe(0);
    const s = status(h);
    expect(s.active).toBe(true);
    expect(s.halted).toBe(null);
    expect(s.paused).toEqual({ reason: 'hour', resumeAt: NOW - 50 * 60000 + 3600000 });
    expect(document.getElementById('lc-badge').textContent).toMatch(/Pace.*hour.*14:40/);   // oldest of the hour (13:40) + 1 h
  });

  it('lifts the pause by itself once the window has moved on', async () => {
    storage.lcPace = { jitter: false, perHour: 1 };
    storage.lcEvents = [NOW - 59 * 60000];
    card('A1', 'Anna', 'anna');
    const h = await load();
    h({ action: 'toggle', enabled: true }, null, () => {});
    await vi.advanceTimersByTimeAsync(1600); await flush();
    expect(fetchCalls.length).toBe(0);
    await vi.advanceTimersByTimeAsync(2 * 60000); await flush();   // the event falls out of the hour
    expect(fetchCalls.length).toBe(1);
    // ...and the send just made fills the cap again for the next hour
    const s = status(h);
    expect(s.paused.reason).toBe('hour');
    expect(s.paused.resumeAt).toBeGreaterThan(NOW + 60 * 60000);
  });

  it('counts the sends of this very run against the cap', async () => {
    storage.lcPace = { jitter: false, perHour: 1 };
    card('A1', 'Anna', 'anna'); card('B2', 'Ben', 'ben');
    const h = await load();
    h({ action: 'toggle', enabled: true }, null, () => {});
    await vi.advanceTimersByTimeAsync(1600); await flush();
    expect(fetchCalls.length).toBe(1);
    await vi.advanceTimersByTimeAsync(3200); await flush();
    expect(fetchCalls.length).toBe(1);
    expect(status(h).paused.reason).toBe('hour');
  });

  it('holds the daily cap on the calendar day and resumes at midnight', async () => {
    storage.lcPace = { jitter: false, perDay: 1 };
    storage.lcEvents = [new Date(2026, 8, 3, 8, 0).getTime()];
    card('A1', 'Anna', 'anna');
    const h = await load();
    h({ action: 'toggle', enabled: true }, null, () => {});
    await vi.advanceTimersByTimeAsync(1600); await flush();
    expect(fetchCalls.length).toBe(0);
    expect(status(h).paused.reason).toBe('day');
    expect(document.getElementById('lc-badge').textContent).toMatch(/day.*00:00/);
  });

  it('stops at the configured share of the weekly allowance', async () => {
    storage.lcPace = { jitter: false, stopAtPercent: 80 };
    storage.lcEvents = Array.from({ length: 160 }, () => new Date(2026, 8, 1, 10).getTime());
    card('A1', 'Anna', 'anna');
    const h = await load();
    h({ action: 'toggle', enabled: true }, null, () => {});
    await vi.advanceTimersByTimeAsync(1600); await flush();
    expect(fetchCalls.length).toBe(0);
    expect(status(h).paused.reason).toBe('quota');
    expect(document.getElementById('lc-badge').textContent).toMatch(/80 %.*07\.09\./);
  });

  it('picks up a settings change from the options page without a reload', async () => {
    storage.lcPace = { jitter: false };
    card('A1', 'Anna', 'anna'); card('B2', 'Ben', 'ben');
    const h = await load();
    h({ action: 'toggle', enabled: true }, null, () => {});
    await vi.advanceTimersByTimeAsync(1600); await flush();
    expect(fetchCalls.length).toBe(1);
    expect(changeListeners.length).toBe(1);
    changeListeners[0]({ lcPace: { newValue: { jitter: false, perHour: 1 } } }, 'local');
    await vi.advanceTimersByTimeAsync(1600); await flush();
    expect(fetchCalls.length).toBe(1);
    expect(status(h).paused.reason).toBe('hour');
  });

  it('a pace pause still handles an open confirm dialog first', async () => {
    storage.lcPace = { jitter: false, perHour: 1 };
    storage.lcEvents = [NOW - 60000];
    const dlg = document.createElement('div');
    dlg.setAttribute('role', 'dialog');
    dlg.innerHTML = '<button aria-label="Ohne Notiz senden">Ohne Notiz senden</button>';
    document.body.appendChild(dlg);
    const clicked = vi.fn();
    dlg.querySelector('button').addEventListener('click', clicked);
    const h = await load();
    h({ action: 'toggle', enabled: true }, null, () => {});
    await vi.advanceTimersByTimeAsync(1600); await flush();
    expect(clicked).toHaveBeenCalled();
  });

  it('stop() cancels the pending jittered tick', async () => {
    card('A1', 'Anna', 'anna');
    const h = await load();
    h({ action: 'toggle', enabled: true }, null, () => {});
    const before = vi.getTimerCount();
    h({ action: 'toggle', enabled: false }, null, () => {});
    expect(vi.getTimerCount()).toBe(before - 1);
    await vi.advanceTimersByTimeAsync(5000); await flush();
    expect(fetchCalls.length).toBe(0);
  });
});
