import { describe, it, expect } from 'vitest';
import LC from '../lib.js';

const {
  BACKUP_APP, BACKUP_SCHEMA, BACKUP_KEYS,
  buildBackup, parseBackup, backupFilename, jsonDataUrl, sanitizeRecipeForBackup
} = LC;

const state = {
  lcEnabled: true,
  lcCount: 12,
  lcRange: '30d',
  lcLog: [{ ts: '2026-08-30T10:00:00.000Z', name: 'Max Mustermann', profileId: 'A1', method: 'api' }],
  lcEvents: [1756540800000, 1756627200000],
  lcRecipe: {
    url: '/voyager/api/x',
    method: 'POST',
    headers: { 'csrf-token': 'ajax:secret', 'x-restli-protocol-version': '2.0.0' },
    bodyTemplate: '{"invitee":"urn:li:fsd_profile:%PROFILE_ID%"}'
  }
};

describe('buildBackup', () => {
  it('stamps the file so a foreign JSON can never be mistaken for ours', () => {
    const b = buildBackup(state, { version: '2.9.0', now: new Date('2026-09-01T08:00:00Z') });
    expect(b.app).toBe(BACKUP_APP);
    expect(b.type).toBe('backup');
    expect(b.schema).toBe(BACKUP_SCHEMA);
    expect(b.version).toBe('2.9.0');
    expect(b.exportedAt).toBe('2026-09-01T08:00:00.000Z');
  });

  it('carries every persisted key', () => {
    const b = buildBackup(state, { version: '2.9.0' });
    expect(Object.keys(b.data).sort()).toEqual([...BACKUP_KEYS].sort());
    expect(b.data.lcCount).toBe(12);
    expect(b.data.lcLog).toHaveLength(1);
    expect(b.data.lcEvents).toEqual(state.lcEvents);
  });

  it('strips the session token out of the learned recipe', () => {
    const b = buildBackup(state, { version: '2.9.0' });
    expect(JSON.stringify(b)).not.toContain('ajax:secret');
    expect(b.data.lcRecipe.headers['x-restli-protocol-version']).toBe('2.0.0');
    expect(b.data.lcRecipe.bodyTemplate).toContain('%PROFILE_ID%');
  });

  it('leaves the live recipe object untouched', () => {
    buildBackup(state, { version: '2.9.0' });
    expect(state.lcRecipe.headers['csrf-token']).toBe('ajax:secret');
  });

  it('fills in defaults for values that were never set', () => {
    const b = buildBackup({}, { version: '2.9.0' });
    expect(b.data.lcCount).toBe(0);
    expect(b.data.lcLog).toEqual([]);
    expect(b.data.lcEvents).toEqual([]);
    expect(b.data.lcRecipe).toBe(null);
  });
});

describe('sanitizeRecipeForBackup', () => {
  it('drops every credential-bearing header', () => {
    const out = sanitizeRecipeForBackup({
      url: '/x',
      headers: { 'Csrf-Token': 'a', cookie: 'b', Authorization: 'c', accept: 'json' },
      body: 'urn:li:fsd_profile:X'
    });
    expect(Object.keys(out.headers)).toEqual(['accept']);
  });
  it('returns null for an unusable recipe', () => {
    expect(sanitizeRecipeForBackup(null)).toBe(null);
    expect(sanitizeRecipeForBackup({ url: '/x' })).toBe(null);
  });
});

describe('parseBackup', () => {
  const good = () => JSON.stringify(buildBackup(state, { version: '2.9.0' }));

  it('round-trips a file this extension wrote', () => {
    const r = parseBackup(good());
    expect(r.ok).toBe(true);
    expect(r.data.lcCount).toBe(12);
    expect(r.data.lcLog[0].name).toBe('Max Mustermann');
    expect(r.data.lcEvents).toEqual(state.lcEvents);
    expect(r.stats.contacts).toBe(1);
    expect(r.stats.events).toBe(2);
  });

  it('rejects text that is not JSON at all', () => {
    const r = parseBackup('not json {');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not a valid json/i);
  });

  it('rejects a JSON file from some other app', () => {
    const r = parseBackup(JSON.stringify({ app: 'something-else', data: {} }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not a linkedin spider backup/i);
  });

  it('rejects our own file if the payload is missing', () => {
    const r = parseBackup(JSON.stringify({ app: BACKUP_APP, type: 'backup', schema: 1 }));
    expect(r.ok).toBe(false);
  });

  it('rejects a newer schema instead of half-reading it', () => {
    const b = JSON.parse(good());
    b.schema = BACKUP_SCHEMA + 1;
    const r = parseBackup(JSON.stringify(b));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/newer version/i);
  });

  it('rejects an empty string, a null and a bare array', () => {
    expect(parseBackup('').ok).toBe(false);
    expect(parseBackup('null').ok).toBe(false);
    expect(parseBackup('[1,2,3]').ok).toBe(false);
  });

  it('drops unknown fields smuggled into a contact record', () => {
    const b = JSON.parse(good());
    b.data.lcLog[0].evil = '<script>';
    b.data.lcLog.push('not an object');
    const r = parseBackup(JSON.stringify(b));
    expect(r.ok).toBe(true);
    expect(r.data.lcLog).toHaveLength(1);
    expect('evil' in r.data.lcLog[0]).toBe(false);
    expect(typeof r.data.lcLog[0].name).toBe('string');
  });

  it('sanitizes a garbage counter, range and event list rather than storing it', () => {
    const b = JSON.parse(good());
    b.data.lcCount = -5;
    b.data.lcRange = 'made-up';
    b.data.lcEvents = [1756540800000, 'nope', null];
    const r = parseBackup(JSON.stringify(b));
    expect(r.ok).toBe(true);
    expect(r.data.lcCount).toBe(0);
    expect(r.data.lcRange).toBe('7d');
    expect(r.data.lcEvents).toEqual([1756540800000]);
  });

  it('keeps a restored recipe only if it is still usable', () => {
    const b = JSON.parse(good());
    b.data.lcRecipe = { url: '/x', headers: {} }; // no substitutable URN
    expect(parseBackup(JSON.stringify(b)).data.lcRecipe).toBe(null);
  });

  it('restores an old backup that predates a later key', () => {
    const b = JSON.parse(good());
    delete b.data.lcEvents;
    const r = parseBackup(JSON.stringify(b));
    expect(r.ok).toBe(true);
    expect(r.data.lcEvents).toEqual([]);
  });
});

describe('backup file naming', () => {
  it('stamps the filename with the date', () => {
    expect(backupFilename(new Date(2026, 8, 1, 9, 5)))
      .toBe('linkedin-spider-backup-2026-09-01_0905.json');
  });
  it('carries the bytes in the URL, not in a revocable blob', () => {
    const url = jsonDataUrl({ a: 'ä' });
    expect(url.startsWith('data:application/json;charset=utf-8,')).toBe(true);
    expect(JSON.parse(decodeURIComponent(url.split(',').slice(1).join(',')))).toEqual({ a: 'ä' });
  });
});
