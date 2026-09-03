import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

await import('../lib.js');

let storage, listeners, fetchCalls;

function setupChrome() {
  // These suites step the clock by 1600 ms per tick — pin the fixed beat.
  // Jitter itself is under test in content-pace.test.js.
  storage = { lcPace: { jitter: false } };
  listeners = [];
  globalThis.chrome = {
    runtime: { id: 'test-extension-id', lastError: null, onMessage: { addListener(fn) { listeners.push(fn); } } },
    storage: { local: {
      get(keys, cb) { const out = {}; for (const k of keys) if (k in storage) out[k] = storage[k]; cb(out); },
      set(obj, cb) { Object.assign(storage, obj); if (cb) cb(); },
      remove(key) { delete storage[key]; }
    } }
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
function setPath(p) { window.history.replaceState({}, '', p); }

describe('durable duplicate guard (lcSeen)', () => {
  beforeEach(() => {
    vi.useFakeTimers(); document.body.innerHTML = ''; document.cookie = 'JSESSIONID="ajax:1"';
    setupChrome(); fetchCalls = []; setPath('/search/results/people/');
    globalThis.fetch = vi.fn((url, init) => { fetchCalls.push({ url, init }); return Promise.resolve({ ok: true, status: 200, text: async () => '' }); });
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('records the profile id in lcSeen on success', async () => {
    card('ACoAAB1', 'Max Mustermann', 'max');
    const h = await load();
    h({ action: 'toggle', enabled: true }, null, () => {});
    await vi.advanceTimersByTimeAsync(1600); await flush();
    expect(storage.lcSeen).toEqual(['ACoAAB1']);
  });

  it('skips a profile that is in lcSeen even when the log has forgotten it', async () => {
    // the log rotated the person out; the seen-list did not
    storage.lcLog = [];
    storage.lcSeen = ['ACoAAB1'];
    card('ACoAAB1', 'Max Mustermann', 'max');
    const h = await load();
    h({ action: 'toggle', enabled: true }, null, () => {});
    await vi.advanceTimersByTimeAsync(1600); await flush();
    expect(fetchCalls.length).toBe(0);
  });

  it('seeds lcSeen from the log on the first run after the upgrade, once', async () => {
    storage.lcLog = [{ ts: 't', profileId: 'A1' }, { ts: 't', profileId: 'B2' }];
    await load();
    expect(storage.lcSeen).toEqual(['A1', 'B2']);
    storage.lcSeen = [];                       // user cleared — must not come back
    await load();
    expect(storage.lcSeen).toEqual([]);
  });

  it('Clear Log lifts the guard: lcSeen goes too', async () => {
    storage.lcSeen = ['ACoAAB1'];
    storage.lcLog = [{ ts: 't', profileId: 'ACoAAB1' }];
    card('ACoAAB1', 'Max Mustermann', 'max');
    const h = await load();
    h({ action: 'clearLog' }, null, () => {});
    expect(storage.lcSeen).toEqual([]);
    h({ action: 'toggle', enabled: true }, null, () => {});
    await vi.advanceTimersByTimeAsync(1600); await flush();
    expect(fetchCalls.length).toBe(1);
  });
});

describe('pending-state detection in every locale', () => {
  beforeEach(() => {
    vi.useFakeTimers(); document.body.innerHTML = ''; document.cookie = 'JSESSIONID="ajax:1"';
    setupChrome(); setPath('/search/results/people/');
    // API fails → click fallback; the button then flips to a localized "pending"
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 500, text: async () => 'boom' }));
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it.each(['Pendiente', 'In attesa', 'En attente', 'Pendente', 'In afwachting'])('counts "%s" as a sent request', async (label) => {
    const el = card('ACoAAB1', 'Max Mustermann', 'max');
    const link = el.querySelector('a[aria-label]');
    link.addEventListener('click', () => { link.textContent = label; });
    const h = await load();
    h({ action: 'toggle', enabled: true }, null, () => {});
    await vi.advanceTimersByTimeAsync(1600); await flush();
    await vi.advanceTimersByTimeAsync(2000); await flush();
    expect(storage.lcCount).toBe(1);
    expect(storage.lcLog[0].method).toBe('click');
  });
});

describe('consecutive-failure circuit breaker', () => {
  beforeEach(() => {
    vi.useFakeTimers(); document.body.innerHTML = ''; document.cookie = 'JSESSIONID="ajax:1"';
    setupChrome(); setPath('/search/results/people/');
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 400, text: async () => '{"message":"limit"}' }));
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  async function runTicks(n) {
    for (let i = 0; i < n; i++) { await vi.advanceTimersByTimeAsync(1600); await flush(); await vi.advanceTimersByTimeAsync(7000); await flush(); }
  }

  it('halts the run after MAX_CONSECUTIVE_FAILS cards fail API and click', async () => {
    const LC = window.LC;
    for (let i = 0; i < LC.MAX_CONSECUTIVE_FAILS + 3; i++) card('P' + i, 'Person ' + i, 'p' + i);
    const h = await load();
    h({ action: 'toggle', enabled: true }, null, () => {});
    await runTicks(LC.MAX_CONSECUTIVE_FAILS + 3);

    let st; h({ action: 'getStatus' }, null, (r) => { st = r; });
    expect(st.active).toBe(false);
    expect(st.halted).toMatch(/failures/i);
    expect(document.getElementById('lc-badge').textContent).toMatch(/stopped/i);
    // it stopped AT the threshold — not every card on the page was ground through
    expect(globalThis.fetch.mock.calls.length).toBe(LC.MAX_CONSECUTIVE_FAILS);
    expect(storage.lcHalt.fails).toBe(LC.MAX_CONSECUTIVE_FAILS);
  });

  it('keeps the last API error for diagnosis', async () => {
    card('P1', 'Person', 'p1');
    const h = await load();
    h({ action: 'toggle', enabled: true }, null, () => {});
    await runTicks(1);
    expect(storage.lcLastApiError.status).toBe(400);
    expect(storage.lcLastApiError.body).toContain('limit');
    expect(typeof storage.lcLastApiError.at).toBe('number');
  });

  it('a success resets the streak', async () => {
    const LC = window.LC;
    let calls = 0;
    globalThis.fetch = vi.fn(() => { calls++; return Promise.resolve(calls === 3
      ? { ok: true, status: 200, text: async () => '' }
      : { ok: false, status: 400, text: async () => 'x' }); });
    for (let i = 0; i < LC.MAX_CONSECUTIVE_FAILS + 2; i++) card('P' + i, 'Person ' + i, 'p' + i);
    const h = await load();
    h({ action: 'toggle', enabled: true }, null, () => {});
    await runTicks(LC.MAX_CONSECUTIVE_FAILS + 1);
    let st; h({ action: 'getStatus' }, null, (r) => { st = r; });
    expect(st.active).toBe(true);           // 2 fails, 1 success, then fewer than 5 fails in a row
  });

  it('switching the run on again clears the halt', async () => {
    const LC = window.LC;
    for (let i = 0; i < LC.MAX_CONSECUTIVE_FAILS; i++) card('P' + i, 'Person ' + i, 'p' + i);
    const h = await load();
    h({ action: 'toggle', enabled: true }, null, () => {});
    await runTicks(LC.MAX_CONSECUTIVE_FAILS);
    let st; h({ action: 'getStatus' }, null, (r) => { st = r; });
    expect(st.halted).toBeTruthy();
    h({ action: 'toggle', enabled: true }, null, () => {});
    h({ action: 'getStatus' }, null, (r) => { st = r; });
    expect(st.halted).toBe(null);
    expect(st.active).toBe(true);
    expect(storage.lcHalt).toBe(null);
  });
});

describe('badge visibility', () => {
  beforeEach(() => { vi.useFakeTimers(); document.body.innerHTML = ''; setupChrome(); globalThis.fetch = vi.fn(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('is hidden on a non-search page while paused', async () => {
    setPath('/feed/');
    await load();
    expect(document.getElementById('lc-badge').style.display).toBe('none');
  });
  it('shows on search result pages', async () => {
    setPath('/search/results/people/?keywords=x');
    await load();
    expect(document.getElementById('lc-badge').style.display).not.toBe('none');
  });
  it('shows anywhere once the run is active', async () => {
    setPath('/feed/');
    const h = await load();
    h({ action: 'toggle', enabled: true }, null, () => {});
    expect(document.getElementById('lc-badge').style.display).not.toBe('none');
  });
  it('follows in-app navigation on the next tick', async () => {
    setPath('/feed/');
    await load();
    expect(document.getElementById('lc-badge').style.display).toBe('none');
    setPath('/search/results/people/');
    await vi.advanceTimersByTimeAsync(1600);
    expect(document.getElementById('lc-badge').style.display).not.toBe('none');
  });
});
