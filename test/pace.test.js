import { describe, it, expect } from 'vitest';
import LC from '../lib.js';

const { PACE_DEFAULTS, normalizePace, nextTickDelay, paceBlocked, TICK_MS, WEEKLY_QUOTA } = LC;
const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min, 0, 0).getTime();

describe('pace settings', () => {
  it('ships with jitter on and every cap off', () => {
    expect(PACE_DEFAULTS).toEqual({ jitter: true, perHour: 0, perDay: 0, stopAtPercent: 0 });
  });
  it('normalizes junk to sane numbers', () => {
    const p = normalizePace({ jitter: 'yes', perHour: '25', perDay: -3, stopAtPercent: 250 });
    expect(p).toEqual({ jitter: true, perHour: 25, perDay: 0, stopAtPercent: 100 });
    expect(normalizePace(null)).toEqual(PACE_DEFAULTS);
    expect(normalizePace({ perHour: 999 }).perHour).toBe(WEEKLY_QUOTA);   // cannot exceed the weekly allowance anyway
    expect(normalizePace({ jitter: false }).jitter).toBe(false);
  });
});

describe('nextTickDelay', () => {
  it('is exactly the base interval without jitter', () => {
    expect(nextTickDelay(false, () => 0)).toBe(TICK_MS);
    expect(nextTickDelay(false, () => 1)).toBe(TICK_MS);
    expect(TICK_MS).toBe(1500);
  });
  it('spreads ±40 % around the base with jitter', () => {
    expect(nextTickDelay(true, () => 0)).toBe(Math.round(TICK_MS * 0.6));
    expect(nextTickDelay(true, () => 1)).toBe(Math.round(TICK_MS * 1.4));
    expect(nextTickDelay(true, () => 0.5)).toBe(TICK_MS);
  });
  it('never returns something a metronome would', () => {
    const seen = new Set();
    for (let i = 0; i < 50; i++) seen.add(nextTickDelay(true));
    expect(seen.size).toBeGreaterThan(10);
    for (const d of seen) { expect(d).toBeGreaterThanOrEqual(900); expect(d).toBeLessThanOrEqual(2100); }
  });
});

describe('paceBlocked', () => {
  const now = at(2026, 9, 3, 14, 30);   // Thursday
  const minutesAgo = (n) => now - n * 60000;

  it('lets everything through with the defaults', () => {
    const many = Array.from({ length: 199 }, (_, i) => minutesAgo(i));
    expect(paceBlocked(many, PACE_DEFAULTS, now)).toEqual({ blocked: false, reason: null, resumeAt: null });
  });

  it('holds the hourly cap and says when it lifts', () => {
    const events = [minutesAgo(50), minutesAgo(30), minutesAgo(10)];
    const r = paceBlocked(events, { perHour: 3 }, now);
    expect(r.blocked).toBe(true);
    expect(r.reason).toBe('hour');
    expect(r.resumeAt).toBe(minutesAgo(50) + 3600000);   // when the oldest of the last hour falls out
    expect(paceBlocked(events, { perHour: 4 }, now).blocked).toBe(false);
  });

  it('holds the daily cap on the local calendar day', () => {
    const events = [at(2026, 9, 3, 0, 5), at(2026, 9, 3, 9, 0)];
    const r = paceBlocked(events, { perDay: 2 }, now);
    expect(r.blocked).toBe(true);
    expect(r.reason).toBe('day');
    expect(new Date(r.resumeAt).getDate()).toBe(4);
    expect(new Date(r.resumeAt).getHours()).toBe(0);
    // yesterday's sends do not count
    expect(paceBlocked([at(2026, 9, 2, 23, 59), at(2026, 9, 2, 20, 0)], { perDay: 2 }, now).blocked).toBe(false);
  });

  it('stops at a percentage of the weekly allowance', () => {
    const weekEvents = Array.from({ length: 160 }, () => at(2026, 9, 1, 10));   // Tuesday of this week
    expect(paceBlocked(weekEvents, { stopAtPercent: 80 }, now).blocked).toBe(true);
    expect(paceBlocked(weekEvents, { stopAtPercent: 80 }, now).reason).toBe('quota');
    expect(new Date(paceBlocked(weekEvents, { stopAtPercent: 80 }, now).resumeAt).getDate()).toBe(7);  // next Monday
    expect(paceBlocked(weekEvents, { stopAtPercent: 81 }, now).blocked).toBe(false);
  });

  it('reports the tightest reason first: hour, then day, then quota', () => {
    const events = Array.from({ length: 10 }, (_, i) => minutesAgo(i));
    expect(paceBlocked(events, { perHour: 5, perDay: 5, stopAtPercent: 1 }, now).reason).toBe('hour');
    expect(paceBlocked(events, { perDay: 5, stopAtPercent: 1 }, now).reason).toBe('day');
  });

  it('survives junk', () => {
    expect(paceBlocked(null, null, now).blocked).toBe(false);
    expect(paceBlocked(['x', null], { perHour: 1 }, now).blocked).toBe(false);
  });
});
