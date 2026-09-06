import { describe, it, expect } from 'vitest';

// Load lib.js — attaches to globalThis.LC
await import('../lib.js');
const { searchQueryFrom, searchQueryOf, buildRecord, toCsv, opsRowFor, parseBackup, buildBackup } = globalThis.LC;

const SEARCH = 'https://www.linkedin.com/search/results/people/';

describe('searchQueryFrom', () => {
  it('reads the typed term off a people search URL', () => {
    expect(searchQueryFrom(SEARCH + '?keywords=hausverwaltung%20Berlin&origin=SWITCH_SEARCH_VERTICAL'))
      .toBe('hausverwaltung Berlin');
  });

  it('reads a form-encoded term (+ for space)', () => {
    expect(searchQueryFrom(SEARCH + '?keywords=CTO+Frankfurt')).toBe('CTO Frankfurt');
  });

  it('keeps umlauts intact', () => {
    expect(searchQueryFrom(SEARCH + '?keywords=hausverwaltung%20M%C3%BCnchen'))
      .toBe('hausverwaltung München');
  });

  it('finds keywords wherever it sits in the query string', () => {
    expect(searchQueryFrom(SEARCH + '?sid=x1B&keywords=CTO%20Frankfurt&page=3')).toBe('CTO Frankfurt');
  });

  it('stops at a fragment', () => {
    expect(searchQueryFrom(SEARCH + '?keywords=CTO%20Frankfurt#top')).toBe('CTO Frankfurt');
  });

  it('collapses whitespace', () => {
    expect(searchQueryFrom(SEARCH + '?keywords=%20%20CTO%20%20%20Frankfurt%20')).toBe('CTO Frankfurt');
  });

  it('answers empty for a search page without a term', () => {
    expect(searchQueryFrom(SEARCH + '?geoUrn=%5B%22103035651%22%5D')).toBe('');
  });

  it('answers empty for a search URL with no query string at all', () => {
    expect(searchQueryFrom(SEARCH)).toBe('');
  });

  // A profile URL's ?trk= is tracking, not a search — a person is not a query.
  it('ignores a non-search page even when it carries parameters', () => {
    expect(searchQueryFrom('https://www.linkedin.com/in/max-mustermann/?keywords=nope&trk=x')).toBe('');
    expect(searchQueryFrom('https://www.linkedin.com/feed/?keywords=nope')).toBe('');
  });

  it('survives junk input', () => {
    expect(searchQueryFrom(null)).toBe('');
    expect(searchQueryFrom(undefined)).toBe('');
    expect(searchQueryFrom('')).toBe('');
    expect(searchQueryFrom(42)).toBe('');
  });
});

describe('searchQueryOf', () => {
  it('prefers the stored term', () => {
    expect(searchQueryOf({ searchQuery: 'hausverwaltung Berlin', pageUrl: SEARCH + '?keywords=alt' }))
      .toBe('hausverwaltung Berlin');
  });

  // Every entry written before 2.13 carries the search URL but not the term —
  // deriving on read means the existing log answers too, without a migration.
  it('falls back to the search URL of an older record', () => {
    expect(searchQueryOf({ pageUrl: SEARCH + '?keywords=CTO%20Frankfurt' })).toBe('CTO Frankfurt');
  });

  it('answers empty when neither is there', () => {
    expect(searchQueryOf({})).toBe('');
    expect(searchQueryOf(null)).toBe('');
  });
});

describe('buildRecord', () => {
  it('stores the term of the page the request was sent from', () => {
    const rec = buildRecord({ name: 'Max' }, { profileId: 'ACo1', method: 'api', pageUrl: SEARCH + '?keywords=hausverwaltung%20Berlin' });
    expect(rec.searchQuery).toBe('hausverwaltung Berlin');
  });

  it('leaves the term empty away from a search page', () => {
    const rec = buildRecord({ name: 'Max' }, { profileId: 'ACo1', method: 'api', pageUrl: 'https://www.linkedin.com/mynetwork/' });
    expect(rec.searchQuery).toBe('');
  });
});

describe('export', () => {
  it('carries the term as its own CSV column', () => {
    const csv = toCsv([buildRecord({ name: 'Max' }, { pageUrl: SEARCH + '?keywords=CTO%20Frankfurt' })]);
    const [head, row] = csv.replace(/^﻿/, '').split('\r\n');
    const at = head.split(';').indexOf('"Suchbegriff"');
    expect(at).toBeGreaterThan(-1);
    expect(row.split(';')[at]).toBe('"CTO Frankfurt"');
  });

  it('fills the column for a record written before the field existed', () => {
    const csv = toCsv([{ name: 'Max', pageUrl: SEARCH + '?keywords=hausverwaltung%20Berlin' }]);
    expect(csv).toContain('"hausverwaltung Berlin"');
  });

  it('sends the term to ops', () => {
    const row = opsRowFor(buildRecord({ name: 'Max' }, { pageUrl: SEARCH + '?keywords=CTO%20Frankfurt' }));
    expect(row.search_query).toBe('CTO Frankfurt');
  });

  it('sends null rather than an empty term', () => {
    expect(opsRowFor({ profileUrl: 'https://www.linkedin.com/in/max' }).search_query).toBe(null);
  });

  it('survives a backup round trip', () => {
    const rec = buildRecord({ name: 'Max' }, { profileId: 'ACo1', pageUrl: SEARCH + '?keywords=hausverwaltung%20Berlin' });
    const parsed = parseBackup(JSON.stringify(buildBackup({ lcLog: [rec] }, { version: '2.13.0' })));
    expect(parsed.ok).toBe(true);
    expect(parsed.data.lcLog[0].searchQuery).toBe('hausverwaltung Berlin');
  });
});
