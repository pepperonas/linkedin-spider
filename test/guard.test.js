import { describe, it, expect } from 'vitest';
import LC from '../lib.js';

const {
  SEEN_CAP, addSeen, seenIds, PENDING_TEXTS, isPendingText, isSearchPage,
  compareVersions, parseLatestRelease, updateCheckDue, UPDATE_CHECK_INTERVAL_MS,
  MAX_CONSECUTIVE_FAILS, BACKUP_KEYS, buildBackup, parseBackup
} = LC;

describe('durable seen-list (the duplicate guard beyond the log cap)', () => {
  it('appends new ids, ignores repeats and junk, never mutates', () => {
    const before = ['A'];
    const after = addSeen(before, ['B', 'A', '', null, 'C']);
    expect(before).toEqual(['A']);
    expect(after).toEqual(['A', 'B', 'C']);
  });
  it('accepts a single id too', () => {
    expect(addSeen(undefined, 'X')).toEqual(['X']);
  });
  it('holds far more than the log does — 5000 rows is half a year at 200 a week', () => {
    expect(SEEN_CAP).toBeGreaterThanOrEqual(100000);
    expect(SEEN_CAP).toBeGreaterThan(LC.LOG_CAP * 10);
  });
  it('drops the oldest only past the cap', () => {
    const out = addSeen(['a', 'b', 'c'], ['d'], 3);
    expect(out).toEqual(['b', 'c', 'd']);
  });
  it('turns a stored list into a Set, tolerating garbage', () => {
    const s = seenIds(['A', 'A', 7, null, 'B']);
    expect(s).toBeInstanceOf(Set);
    expect([...s]).toEqual(['A', 'B']);
    expect(seenIds('nope').size).toBe(0);
  });
});

describe('pending-state texts', () => {
  it('covers every locale the connect detection covers', () => {
    // DE EN ES IT FR PT NL — the same seven as CONNECT/SEND_WITHOUT_NOTE
    expect(PENDING_TEXTS.length).toBeGreaterThanOrEqual(7);
    for (const t of ['Ausstehend', 'Pending', 'Pendiente', 'In attesa', 'En attente', 'Pendente', 'In afwachting']) {
      expect(isPendingText(t)).toBe(true);
    }
  });
  it('matches inside a longer label, case-insensitively', () => {
    expect(isPendingText('  ausstehend ')).toBe(true);
    expect(isPendingText('Max Mustermann · PENDING')).toBe(true);
  });
  it('does not fire on the connect label itself', () => {
    for (const t of LC.CONNECT_TEXTS) expect(isPendingText(t)).toBe(false);
    expect(isPendingText('')).toBe(false);
    expect(isPendingText(null)).toBe(false);
  });
});

describe('isSearchPage', () => {
  it('is true only on search result pages', () => {
    expect(isSearchPage('/search/results/people/?keywords=cto')).toBe(true);
    expect(isSearchPage('/search/results/all/')).toBe(true);
    expect(isSearchPage('/feed/')).toBe(false);
    expect(isSearchPage('/in/max-mustermann/')).toBe(false);
    expect(isSearchPage('/mynetwork/')).toBe(false);
    expect(isSearchPage('')).toBe(false);
  });
});

describe('consecutive-failure circuit breaker', () => {
  it('trips after a handful, not after one', () => {
    expect(MAX_CONSECUTIVE_FAILS).toBeGreaterThanOrEqual(3);
    expect(MAX_CONSECUTIVE_FAILS).toBeLessThanOrEqual(10);
  });
});

describe('update check helpers', () => {
  it('compares SemVer numerically, not lexically', () => {
    expect(compareVersions('2.10.1', '2.9.1')).toBe(1);     // "2.10" > "2.9" — string compare would say otherwise
    expect(compareVersions('2.10.1', '2.10.1')).toBe(0);
    expect(compareVersions('2.10.1', '2.11.0')).toBe(-1);
    expect(compareVersions('3.0.0', '2.99.99')).toBe(1);
    expect(compareVersions('v2.11.0', '2.11.0')).toBe(0);   // tag prefix tolerated
  });
  it('reads GitHub\'s latest-release payload and nothing else', () => {
    const r = parseLatestRelease({ tag_name: 'v2.11.0', html_url: 'https://github.com/pepperonas/linkedin-spider/releases/tag/v2.11.0', draft: false, prerelease: false });
    expect(r).toEqual({ version: '2.11.0', url: 'https://github.com/pepperonas/linkedin-spider/releases/tag/v2.11.0' });
    expect(parseLatestRelease({ tag_name: 'nope' })).toBe(null);
    expect(parseLatestRelease(null)).toBe(null);
    expect(parseLatestRelease({ tag_name: 'v2.11.0', html_url: 'javascript:alert(1)' })).toBe(null);
    expect(parseLatestRelease({ tag_name: 'v2.11.0', html_url: 'https://evil.example/x' })).toBe(null);
  });
  it('is due once a day', () => {
    expect(UPDATE_CHECK_INTERVAL_MS).toBe(24 * 3600 * 1000);
    const now = 10 * UPDATE_CHECK_INTERVAL_MS;
    expect(updateCheckDue(null, now)).toBe(true);
    expect(updateCheckDue({ checkedAt: now - 1000 }, now)).toBe(false);
    expect(updateCheckDue({ checkedAt: now - UPDATE_CHECK_INTERVAL_MS - 1 }, now)).toBe(true);
  });
});

describe('backup carries the new keys', () => {
  it('lcPace round-trips normalized, and an old backup without it restores the defaults', () => {
    expect(BACKUP_KEYS).toContain('lcPace');
    const b = buildBackup({ lcPace: { jitter: false, perHour: '30', perDay: -1, stopAtPercent: 500 } }, { version: 'x' });
    expect(b.data.lcPace).toEqual({ jitter: false, perHour: 30, perDay: 0, stopAtPercent: 100 });
    const parsed = parseBackup(JSON.stringify(b));
    expect(parsed.ok).toBe(true);
    expect(parsed.data.lcPace).toEqual({ jitter: false, perHour: 30, perDay: 0, stopAtPercent: 100 });
    const old = parseBackup(JSON.stringify({ ...b, data: { ...b.data, lcPace: undefined } }));
    expect(old.data.lcPace).toEqual({ jitter: true, perHour: 0, perDay: 0, stopAtPercent: 0 });
  });

  it('lcSeen round-trips and is sanitized', () => {
    expect(BACKUP_KEYS).toContain('lcSeen');
    const b = buildBackup({ lcSeen: ['A', 'B', 5, null, 'A'] }, { version: 'x' });
    expect(b.data.lcSeen).toEqual(['A', 'B']);
    const parsed = parseBackup(JSON.stringify(b));
    expect(parsed.ok).toBe(true);
    expect(parsed.data.lcSeen).toEqual(['A', 'B']);
    expect(parseBackup(JSON.stringify({ ...b, data: { ...b.data, lcSeen: 'garbage' } })).data.lcSeen).toEqual([]);
  });
});
