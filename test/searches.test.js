import { describe, it, expect } from 'vitest';

await import('../lib.js');
const {
  TERM_GROUPS, DEFAULT_TERMS, DEFAULT_CITIES, STATS_CAP,
  normalizeTerms, normalizeCities, termCount,
  searchQueryFor, searchUrlFor, searchQueryFrom, splitQuery,
  statsKey, normalizeStats, bumpStat, backfillStats, statCountFor, statsRows
} = globalThis.LC;

describe('the catalogue that ships with the extension', () => {
  it('carries all three groups the user works in', () => {
    expect(TERM_GROUPS.map((g) => g.key)).toEqual(['direkt', 'branchen', 'multi']);
    for (const g of TERM_GROUPS) expect(DEFAULT_TERMS[g.key].length).toBeGreaterThan(0);
    expect(termCount()).toBe(69);
  });

  it('has no duplicate inside a group', () => {
    for (const g of TERM_GROUPS) {
      const lower = DEFAULT_TERMS[g.key].map((t) => t.toLowerCase());
      expect(new Set(lower).size).toBe(lower.length);
    }
  });

  it('starts with the cities that are actually worked', () => {
    expect(DEFAULT_CITIES).toContain('Berlin');
    expect(normalizeCities()).toEqual(DEFAULT_CITIES);
  });
});

describe('normalizeTerms / normalizeCities', () => {
  it('falls back to the default for a group that is not there', () => {
    expect(normalizeTerms({ direkt: ['CTO'] }).branchen).toEqual(DEFAULT_TERMS.branchen);
  });

  // Deleting a whole group is a decision, not damage — re-seeding it would
  // fight the user every time they save.
  it('leaves an emptied group empty', () => {
    expect(normalizeTerms({ direkt: [] }).direkt).toEqual([]);
    expect(normalizeCities([])).toEqual([]);
  });

  it('trims, drops blanks and dedupes case-insensitively', () => {
    expect(normalizeTerms({ direkt: ['  CTO ', 'cto', '', '   ', 'CIO'] }).direkt).toEqual(['CTO', 'CIO']);
    expect(normalizeCities(['Berlin', 'berlin', ' Hamburg '])).toEqual(['Berlin', 'Hamburg']);
  });

  it('survives junk', () => {
    expect(normalizeTerms(null).direkt).toEqual(DEFAULT_TERMS.direkt);
    expect(normalizeTerms('nope').multi).toEqual(DEFAULT_TERMS.multi);
    expect(normalizeCities('nope')).toEqual(DEFAULT_CITIES);
  });
});

describe('building a search', () => {
  it('puts the city into the keywords, as it was typed by hand before', () => {
    expect(searchQueryFor('Hausverwaltung', 'Berlin')).toBe('Hausverwaltung Berlin');
    expect(searchUrlFor('Hausverwaltung', 'Berlin'))
      .toBe('https://www.linkedin.com/search/results/people/?keywords=Hausverwaltung%20Berlin&origin=GLOBAL_SEARCH_HEADER');
  });

  it('works without a city', () => {
    expect(searchQueryFor('Hausverwaltung', '')).toBe('Hausverwaltung');
    expect(searchUrlFor('Hausverwaltung', '')).toContain('keywords=Hausverwaltung&');
  });

  it('has nothing to open without a term and a city', () => {
    expect(searchUrlFor('', '')).toBe('');
  });

  // The contract between the picker and v2.13.0: what the picker sends out has
  // to come back off the URL unchanged, or the counter keys on something else
  // than the search it built.
  it('round-trips through the URL the log reads back', () => {
    for (const [t, c] of [['Kaufmännischer Leiter', 'Berlin'], ['IT-Leiter', 'Düsseldorf'], ['MSP', '']]) {
      expect(searchQueryFrom(searchUrlFor(t, c))).toBe(searchQueryFor(t, c));
    }
  });
});

describe('splitQuery — what and where', () => {
  const cities = ['Berlin', 'Frankfurt', 'Frankfurt am Main'];

  it('splits the habitual "<term> <city>"', () => {
    expect(splitQuery('Kaufmännischer Leiter Berlin', cities))
      .toEqual({ term: 'Kaufmännischer Leiter', city: 'Berlin' });
  });

  it('finds the city in front too', () => {
    expect(splitQuery('Berlin Hausverwaltung', cities))
      .toEqual({ term: 'Hausverwaltung', city: 'Berlin' });
  });

  it('reports the city in the spelling of the list, not of the query', () => {
    expect(splitQuery('Kaufmännischer Leiter berlin', cities).city).toBe('Berlin');
  });

  // "Leiter Digitalisierung" was searched without a city — that is a normal
  // answer, not a failure, and it must not be attributed to anywhere.
  it('answers with no city when there is none', () => {
    expect(splitQuery('Leiter Digitalisierung', cities))
      .toEqual({ term: 'Leiter Digitalisierung', city: '' });
  });

  it('never matches a city inside a longer word', () => {
    expect(splitQuery('Hausverwaltung Berliner Ring', cities).city).toBe('');
    expect(splitQuery('Frankfurter Allee Immobilien', cities).city).toBe('');
  });

  it('prefers the longer city name where both fit', () => {
    expect(splitQuery('Steuerberater Frankfurt am Main', cities))
      .toEqual({ term: 'Steuerberater', city: 'Frankfurt am Main' });
  });

  it('has no city to find with an empty list', () => {
    expect(splitQuery('CTO Berlin', [])).toEqual({ term: 'CTO Berlin', city: '' });
  });

  it('survives junk', () => {
    expect(splitQuery('', cities)).toEqual({ term: '', city: '' });
    expect(splitQuery(null, cities)).toEqual({ term: '', city: '' });
  });
});

describe('counting per combination', () => {
  it('keys case-insensitively so one combination stays one row', () => {
    expect(statsKey('CTO', 'Berlin')).toBe(statsKey('cto', 'berlin'));
    expect(statsKey('CTO', 'Berlin')).not.toBe(statsKey('CTO', 'Hamburg'));
  });

  it('counts up and remembers first and last', () => {
    let s = bumpStat({}, 'CTO', 'Berlin', 1000);
    s = bumpStat(s, 'CTO', 'Berlin', 5000);
    const row = statsRows(s)[0];
    expect(row).toMatchObject({ term: 'CTO', city: 'Berlin', n: 2, first: 1000, last: 5000 });
  });

  it('keeps the spelling it saw first', () => {
    let s = bumpStat({}, 'CTO', 'Berlin', 1000);
    s = bumpStat(s, 'cto', 'berlin', 2000);
    expect(statsRows(s)[0].term).toBe('CTO');
    expect(statsRows(s)[0].city).toBe('Berlin');
  });

  // A request sent off a profile page has no search term. The weekly quota
  // still counts it (lcEvents); only this breakdown has nowhere to put it.
  it('counts nothing without a term', () => {
    expect(bumpStat({}, '', 'Berlin', 1000)).toEqual({});
  });

  it('does not mutate the stats it was given', () => {
    const before = bumpStat({}, 'CTO', 'Berlin', 1000);
    const copy = JSON.parse(JSON.stringify(before));
    bumpStat(before, 'CIO', 'Hamburg', 2000);
    expect(before).toEqual(copy);
  });

  it('evicts the longest-idle combination past the cap, never the fresh one', () => {
    let s = {};
    for (let i = 0; i < STATS_CAP; i++) s = bumpStat(s, 'T' + i, 'Berlin', 1000 + i);
    expect(Object.keys(s).length).toBe(STATS_CAP);
    s = bumpStat(s, 'Frisch', 'Berlin', 1);   // oldest timestamp on purpose
    expect(Object.keys(s).length).toBe(STATS_CAP);
    expect(statCountFor(s, 'Frisch', 'Berlin')).toBe(1);
    expect(statCountFor(s, 'T0', 'Berlin')).toBe(0);
  });

  it('drops damaged entries when reading', () => {
    expect(normalizeStats({ 'a|b': { n: 0 }, 'c|d': null, 'e|f': { term: 'CTO', city: 'Berlin', n: 3 } }))
      .toEqual({ 'e|f': { term: 'CTO', city: 'Berlin', n: 3, first: 0, last: 0 } });
  });

  it('sorts the table by volume, then recency, then name', () => {
    let s = bumpStat({}, 'A', 'Berlin', 1000);
    s = bumpStat(s, 'B', 'Berlin', 2000);
    s = bumpStat(s, 'B', 'Berlin', 3000);
    expect(statsRows(s).map((r) => r.term)).toEqual(['B', 'A']);
  });
});

describe('backfillStats — the starting stand out of the log', () => {
  const SEARCH = 'https://www.linkedin.com/search/results/people/?keywords=';

  it('reproduces a hand-kept tally from the existing log', () => {
    const log = [];
    for (let i = 0; i < 100; i++) log.push({ ts: '2026-09-01T10:00:00.000Z', searchQuery: 'Kaufmännischer Leiter berlin' });
    for (let i = 0; i < 64; i++) log.push({ ts: '2026-09-02T10:00:00.000Z', searchQuery: 'Leiter Digitalisierung' });
    const s = backfillStats(log, ['Berlin']);
    expect(statCountFor(s, 'Kaufmännischer Leiter', 'Berlin')).toBe(100);
    expect(statCountFor(s, 'Leiter Digitalisierung', '')).toBe(64);
  });

  // Entries written before 2.13 have no term, but they do have the search URL.
  it('reads records that predate the search-term field', () => {
    const s = backfillStats([{ ts: '2026-09-01T10:00:00.000Z', pageUrl: SEARCH + 'CTO%20Hamburg' }], ['Hamburg']);
    expect(statCountFor(s, 'CTO', 'Hamburg')).toBe(1);
  });

  it('skips what carries no search at all', () => {
    expect(backfillStats([{ ts: '2026-09-01T10:00:00.000Z' }, null, 'nope'], ['Berlin'])).toEqual({});
  });

  // One pass, no per-record re-sorting — the 619 ms lesson from backfillEvents.
  it('stays fast on a full log', () => {
    const log = [];
    for (let i = 0; i < 5000; i++) {
      log.push({ ts: '2026-09-01T10:00:00.000Z', searchQuery: 'Term' + (i % 300) + ' Berlin' });
    }
    const t0 = Date.now();
    backfillStats(log, ['Berlin']);
    expect(Date.now() - t0).toBeLessThan(100);
  });
});
