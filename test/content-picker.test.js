import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

await import('../lib.js');

let storage;
let listeners;
let sent;          // messages the content script sent to the worker

function setupChrome() {
  storage = { lcPace: { jitter: false } };
  listeners = [];
  sent = [];
  globalThis.chrome = {
    runtime: {
      id: 'test-extension-id',
      lastError: null,
      onMessage: { addListener(fn) { listeners.push(fn); } },
      sendMessage(msg) { sent.push(msg); }
    },
    storage: {
      local: {
        get(keys, cb) { const out = {}; for (const k of keys) if (k in storage) out[k] = storage[k]; cb(out); },
        set(obj, cb) { Object.assign(storage, obj); if (cb) cb(); },
        remove(key) { delete storage[key]; }
      },
      onChanged: { addListener() {} }
    }
  };
}

function setPath(path) {
  window.history.replaceState({}, '', path);
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
}

async function load() {
  vi.resetModules();
  await import('../content.js');
  await Promise.resolve();
}

async function flush() { for (let i = 0; i < 40; i++) await Promise.resolve(); }

function openPicker() {
  document.getElementById('lc-badge').click();
  return document.getElementById('lc-picker');
}

const terms = (el) => Array.from(el.querySelectorAll('.lc-p-item .lc-p-term')).map((n) => n.textContent);

describe('the search picker in the page', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    document.cookie = 'JSESSIONID="ajax:1234567890"';
    setupChrome();
    setPath('/feed/');
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('') }));
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); setPath('/'); });

  it('opens from the badge and offers the catalogue', async () => {
    await load();
    const p = openPicker();
    expect(p).toBeTruthy();
    expect(p.classList.contains('lc-open')).toBe(true);
    expect(terms(p)).toContain('Kaufmännischer Leiter');
    expect(terms(p).length).toBe(69);
    expect(Array.from(p.querySelectorAll('.lc-p-city')).map((b) => b.textContent))
      .toEqual(['—', 'Berlin', 'Darmstadt', 'Frankfurt', 'Hamburg', 'Düsseldorf']);
  });

  // Real links: the browser navigates, so there is nothing to stub — and the
  // URL is exactly what the log will read back as the search term.
  it('links each term to its search, with the chosen city', async () => {
    storage.lcCity = 'Hamburg';
    await load();
    const p = openPicker();
    const item = Array.from(p.querySelectorAll('.lc-p-item'))
      .find((a) => a.querySelector('.lc-p-term').textContent === 'CTO');
    expect(item.getAttribute('href'))
      .toBe('https://www.linkedin.com/search/results/people/?keywords=CTO%20Hamburg&origin=GLOBAL_SEARCH_HEADER');
  });

  it('switches the whole list to another city', async () => {
    await load();
    const p = openPicker();
    Array.from(p.querySelectorAll('.lc-p-city')).find((b) => b.textContent === 'Berlin').click();
    expect(storage.lcCity).toBe('Berlin');
    const item = Array.from(p.querySelectorAll('.lc-p-item'))
      .find((a) => a.querySelector('.lc-p-term').textContent === 'CTO');
    expect(item.getAttribute('href')).toContain('keywords=CTO%20Berlin');
  });

  it('shows the tally next to a combination that has been worked', async () => {
    storage.lcCity = 'Berlin';
    storage.lcStats = { 'cto|berlin': { term: 'CTO', city: 'Berlin', n: 100, first: 1, last: 2 } };
    await load();
    const p = openPicker();
    const item = Array.from(p.querySelectorAll('.lc-p-item'))
      .find((a) => a.querySelector('.lc-p-term').textContent === 'CTO');
    expect(item.querySelector('.lc-p-n').textContent).toBe('100');
    // …and only there: a different city is a different combination.
    Array.from(p.querySelectorAll('.lc-p-city')).find((b) => b.textContent === 'Hamburg').click();
    const other = Array.from(p.querySelectorAll('.lc-p-item'))
      .find((a) => a.querySelector('.lc-p-term').textContent === 'CTO');
    expect(other.querySelector('.lc-p-n')).toBe(null);
  });

  it('filters the catalogue as you type', async () => {
    await load();
    const p = openPicker();
    const f = p.querySelector('.lc-p-filter');
    f.value = 'steuer';
    f.dispatchEvent(new Event('input'));
    expect(terms(p)).toEqual(['Steuerberatung', 'Steuerberater']);
  });

  it('says so when nothing matches', async () => {
    await load();
    const p = openPicker();
    const f = p.querySelector('.lc-p-filter');
    f.value = 'zzzz';
    f.dispatchEvent(new Event('input'));
    expect(p.querySelectorAll('.lc-p-item').length).toBe(0);
    expect(p.querySelector('.lc-p-empty')).toBeTruthy();
  });

  it('closes on Escape and on a click elsewhere', async () => {
    await load();
    const p = openPicker();
    p.querySelector('.lc-p-filter').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(p.classList.contains('lc-open')).toBe(false);

    openPicker();
    document.body.click();
    expect(p.classList.contains('lc-open')).toBe(false);
  });

  // Picking a search navigates. It must never arm sending — that stays the
  // one deliberate switch in the popup.
  it('never turns the run on', async () => {
    await load();
    const p = openPicker();
    p.querySelector('.lc-p-item').click();
    expect(storage.lcEnabled).toBeUndefined();
    expect(p.querySelector('.lc-p-state').textContent).toContain('Run is off');
  });

  it('asks the worker to open the options page', async () => {
    await load();
    const p = openPicker();
    p.querySelector('.lc-p-opts').click();
    expect(sent).toEqual([{ action: 'openOptions' }]);
  });
});

describe('counting per combination', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    document.cookie = 'JSESSIONID="ajax:1234567890"';
    setupChrome();
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('') }));
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); setPath('/'); });

  async function runOneTick() {
    await load();
    listeners[listeners.length - 1]({ action: 'toggle', enabled: true }, null, () => {});
    await vi.advanceTimersByTimeAsync(1600);
    await flush();
  }

  it('books a sent request on "term + city"', async () => {
    setPath('/search/results/people/?keywords=Kaufm%C3%A4nnischer%20Leiter%20berlin');
    buildSearchCard();
    await runOneTick();
    const rows = globalThis.LC.statsRows(storage.lcStats);
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ term: 'Kaufmännischer Leiter', city: 'Berlin', n: 1 });
  });

  it('books a search without a city under no city, not under a guessed one', async () => {
    setPath('/search/results/people/?keywords=Leiter%20Digitalisierung');
    buildSearchCard();
    await runOneTick();
    expect(globalThis.LC.statsRows(storage.lcStats)[0]).toMatchObject({ term: 'Leiter Digitalisierung', city: '', n: 1 });
  });

  it('seeds the tally once from the existing log', async () => {
    storage.lcLog = [
      { ts: '2026-09-01T10:00:00.000Z', profileId: 'A', searchQuery: 'CTO Berlin' },
      { ts: '2026-09-01T10:01:00.000Z', profileId: 'B', searchQuery: 'CTO Berlin' }
    ];
    setPath('/feed/');
    await load();
    await flush();
    expect(globalThis.LC.statCountFor(storage.lcStats, 'CTO', 'Berlin')).toBe(2);
  });

  // An emptied tally is the user's reset, not damage — re-seeding would undo it.
  it('leaves an emptied tally empty', async () => {
    storage.lcStats = {};
    storage.lcLog = [{ ts: '2026-09-01T10:00:00.000Z', profileId: 'A', searchQuery: 'CTO Berlin' }];
    setPath('/feed/');
    await load();
    await flush();
    expect(storage.lcStats).toEqual({});
  });
});
