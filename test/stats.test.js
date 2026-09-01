import { describe, it, expect } from 'vitest';
import LC from '../lib.js';

const {
  WEEKLY_QUOTA, normalizeEvents, appendEvent, startOfWeek, isoWeek,
  weekQuota, CHART_RANGES, rangeByKey, bucketEvents, chartSvg, escapeHtml
} = LC;

// Local-time helper: the whole quota/chart model works in the user's timezone,
// so fixtures are built from local components, never from UTC strings.
const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min, 0, 0).getTime();

describe('event normalization', () => {
  it('accepts epoch ms, ISO strings and Date objects', () => {
    const iso = new Date(at(2026, 9, 1, 10)).toISOString();
    const out = normalizeEvents([at(2026, 9, 1, 9), iso, new Date(at(2026, 9, 1, 11))]);
    expect(out).toEqual([at(2026, 9, 1, 9), at(2026, 9, 1, 10), at(2026, 9, 1, 11)]);
  });

  it('drops junk instead of poisoning the series with NaN', () => {
    expect(normalizeEvents([null, 'nope', undefined, {}, NaN, at(2026, 9, 1)]))
      .toEqual([at(2026, 9, 1)]);
    expect(normalizeEvents(null)).toEqual([]);
  });

  it('sorts out-of-order input ascending', () => {
    expect(normalizeEvents([at(2026, 9, 3), at(2026, 9, 1), at(2026, 9, 2)]))
      .toEqual([at(2026, 9, 1), at(2026, 9, 2), at(2026, 9, 3)]);
  });
});

describe('appendEvent', () => {
  const now = at(2026, 9, 1);

  it('appends without mutating the input', () => {
    const before = [at(2026, 8, 30)];
    const after = appendEvent(before, now, { now });
    expect(before).toEqual([at(2026, 8, 30)]);
    expect(after).toEqual([at(2026, 8, 30), now]);
  });

  it('prunes entries older than the retention window', () => {
    const ancient = now - 500 * 24 * 3600 * 1000;
    const recent = now - 10 * 24 * 3600 * 1000;
    const out = appendEvent([ancient, recent], now, { now, maxAgeDays: 400 });
    expect(out).toEqual([recent, now]);
  });

  it('caps the series length, dropping the oldest', () => {
    const out = appendEvent([1000, 2000, 3000], now, { now, cap: 2, maxAgeDays: 100000 });
    expect(out).toEqual([3000, now]);
  });
});

describe('startOfWeek', () => {
  it('snaps to Monday 00:00 local', () => {
    // 2026-09-01 is a Tuesday -> Monday is 2026-08-31
    const s = new Date(startOfWeek(new Date(at(2026, 9, 1, 23, 59))));
    expect(s.getFullYear()).toBe(2026);
    expect(s.getMonth() + 1).toBe(8);
    expect(s.getDate()).toBe(31);
    expect(s.getHours()).toBe(0);
    expect(s.getMinutes()).toBe(0);
    expect(s.getSeconds()).toBe(0);
    expect(s.getMilliseconds()).toBe(0);
  });

  it('treats Sunday as the LAST day of the week, not the first', () => {
    // 2026-09-06 is a Sunday -> its week still starts Monday 2026-08-31
    const s = new Date(startOfWeek(new Date(at(2026, 9, 6, 8))));
    expect(s.getDate()).toBe(31);
    expect(s.getMonth() + 1).toBe(8);
  });

  it('is idempotent', () => {
    const once = startOfWeek(new Date(at(2026, 9, 3)));
    expect(startOfWeek(new Date(once))).toBe(once);
  });
});

describe('weekQuota', () => {
  const now = at(2026, 9, 1, 12); // Tuesday
  const monday = at(2026, 8, 31, 0, 1);
  const lastWeek = at(2026, 8, 28, 12); // Friday before

  it('defaults to the free 200-per-week allowance', () => {
    expect(WEEKLY_QUOTA).toBe(200);
    expect(weekQuota([], now).limit).toBe(200);
  });

  it('counts only events inside the current calendar week', () => {
    const q = weekQuota([lastWeek, monday, now - 1000], now);
    expect(q.used).toBe(2);
    expect(q.remaining).toBe(198);
  });

  it('reports a rolling 7-day count alongside the calendar week', () => {
    // lastWeek (Fri) is outside the calendar week but inside the last 7 days
    const q = weekQuota([lastWeek, monday], now);
    expect(q.used).toBe(1);
    expect(q.rolling7).toBe(2);
  });

  it('never reports negative remaining or more than 100 percent', () => {
    const many = Array.from({ length: 260 }, () => monday);
    const q = weekQuota(many, now);
    expect(q.used).toBe(260);
    expect(q.remaining).toBe(0);
    expect(q.percent).toBe(100);
  });

  it('rounds the percentage of the allowance used', () => {
    const q = weekQuota(Array.from({ length: 50 }, () => monday), now);
    expect(q.percent).toBe(25);
  });

  it('resets on the next Monday 00:00', () => {
    const r = new Date(weekQuota([], now).resetsAt);
    expect(r.getDate()).toBe(7);
    expect(r.getMonth() + 1).toBe(9);
    expect(r.getHours()).toBe(0);
  });

  it('honours a custom limit', () => {
    expect(weekQuota([monday], now, 10).remaining).toBe(9);
  });
});

describe('isoWeek', () => {
  it('numbers weeks the ISO-8601 way', () => {
    expect(isoWeek(new Date(at(2026, 1, 1)))).toBe(1);   // Thu -> W1
    expect(isoWeek(new Date(at(2026, 9, 1)))).toBe(36);
  });
});

describe('chart ranges', () => {
  it('offers selectable periods, shortest first', () => {
    expect(CHART_RANGES.map((r) => r.key)).toEqual(['7d', '30d', '90d', '1y']);
  });

  it('falls back to the first range for an unknown key', () => {
    expect(rangeByKey('nonsense').key).toBe('7d');
    expect(rangeByKey('30d').key).toBe('30d');
  });
});

describe('bucketEvents', () => {
  const now = at(2026, 9, 1, 15); // Tuesday

  it('returns one bucket per day for the 7-day range, oldest first', () => {
    const b = bucketEvents([], '7d', now);
    expect(b.length).toBe(7);
    expect(new Date(b[0].start).getDate()).toBe(26); // 2026-08-26
    expect(new Date(b[6].start).getDate()).toBe(1);
    expect(b[6].current).toBe(true);
    expect(b[0].current).toBe(false);
  });

  it('counts each event into exactly one bucket', () => {
    const events = [at(2026, 9, 1, 9), at(2026, 9, 1, 10), at(2026, 8, 30, 22)];
    const b = bucketEvents(events, '7d', now);
    expect(b.map((x) => x.count).reduce((a, c) => a + c, 0)).toBe(3);
    expect(b[6].count).toBe(2);
    expect(b.find((x) => new Date(x.start).getDate() === 30).count).toBe(1);
  });

  it('ignores events outside the selected window', () => {
    const b = bucketEvents([at(2026, 7, 1)], '7d', now);
    expect(b.reduce((a, c) => a + c.count, 0)).toBe(0);
  });

  it('buckets 90 days by week and a year by month', () => {
    const w = bucketEvents([], '90d', now);
    expect(w.length).toBe(13);
    expect(new Date(w[12].start).getDay()).toBe(1); // Monday
    expect(w[12].label).toBe('W36');

    const m = bucketEvents([], '1y', now);
    expect(m.length).toBe(12);
    expect(new Date(m[11].start).getDate()).toBe(1);
    expect(m[11].label).toBe('Sep');
  });

  it('labels day buckets compactly and titles them fully', () => {
    const b = bucketEvents([], '7d', now);
    expect(b[6].label).toBe('1.9.');
    expect(b[6].title).toBe('01.09.2026');
  });

  it('leaves no gap between consecutive buckets', () => {
    const b = bucketEvents([], '30d', now);
    for (let i = 1; i < b.length; i++) expect(b[i - 1].end).toBe(b[i].start);
  });
});

describe('chartSvg', () => {
  const buckets = [
    { start: 1, end: 2, label: '1.9.', title: '01.09.2026', count: 0, current: false },
    { start: 2, end: 3, label: '2.9.', title: '02.09.2026', count: 4, current: false },
    { start: 3, end: 4, label: '3.9.', title: '03.09.2026', count: 2, current: true }
  ];

  it('draws one bar per bucket', () => {
    const svg = chartSvg(buckets);
    expect(svg.startsWith('<svg')).toBe(true);
    expect((svg.match(/<rect class="lc-bar/g) || []).length).toBe(3);
  });

  it('scales bars against the busiest bucket', () => {
    const svg = chartSvg(buckets, { width: 300, height: 100 });
    const heights = [...svg.matchAll(/<rect class="lc-bar[^"]*"[^>]*height="([\d.]+)"/g)].map((m) => +m[1]);
    expect(heights[1]).toBeGreaterThan(heights[2]);
    expect(heights[0]).toBe(0);
  });

  it('marks the still-running bucket so it does not read as a slump', () => {
    expect(chartSvg(buckets)).toContain('lc-bar lc-bar-current');
  });

  it('puts the count in a hover title', () => {
    expect(chartSvg(buckets)).toContain('<title>02.09.2026: 4</title>');
  });

  it('shows the peak as an axis label', () => {
    expect(chartSvg(buckets)).toContain('>4<');
  });

  it('says so when there is nothing to draw yet', () => {
    const svg = chartSvg([{ start: 1, end: 2, label: 'x', title: 'x', count: 0, current: true }]);
    expect(svg).toContain('No requests in this period');
    expect(svg).not.toContain('<rect class="lc-bar');
  });

  it('escapes label text instead of injecting it raw', () => {
    const evil = [{ start: 1, end: 2, label: '<script>', title: 'a"b', count: 1, current: false }];
    const svg = chartSvg(evil);
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
  });
});

describe('bucket boundaries', () => {
  const now = at(2026, 9, 1, 15);

  it('starts every day bucket at local midnight', () => {
    // Adding 86_400_000 ms instead of a calendar day drifts an hour across a
    // DST switch and the columns stop lining up with days.
    for (const key of ['7d', '30d']) {
      for (const b of bucketEvents([], key, now)) {
        const d = new Date(b.start);
        expect([d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()]).toEqual([0, 0, 0, 0]);
      }
    }
  });

  it('starts every week bucket on a local Monday midnight', () => {
    for (const b of bucketEvents([], '90d', now)) {
      const d = new Date(b.start);
      expect(d.getDay()).toBe(1);
      expect(d.getHours()).toBe(0);
    }
  });

  it('starts every month bucket on the 1st at midnight', () => {
    for (const b of bucketEvents([], '1y', now)) {
      const d = new Date(b.start);
      expect(d.getDate()).toBe(1);
      expect(d.getHours()).toBe(0);
    }
  });

  it('puts an event exactly on a boundary into the newer bucket', () => {
    const b = bucketEvents([], '7d', now);
    const edge = b[3].start;
    const counted = bucketEvents([edge], '7d', now);
    expect(counted[2].count).toBe(0);
    expect(counted[3].count).toBe(1);
  });

  it('covers a full year of months without repeating one', () => {
    const labels = bucketEvents([], '1y', now).map((b) => b.label);
    expect(new Set(labels).size).toBe(12);
  });
});

describe('daylight saving', () => {
  // Europe/Berlin (pinned in vitest.config.js): clocks go forward 2026-03-29
  // and back 2026-10-25. Both weeks contain a 23h and a 25h day.
  it('keeps one column per calendar day across the spring-forward night', () => {
    const b = bucketEvents([], '7d', at(2026, 3, 31, 12));
    expect(b.length).toBe(7);
    expect(b.map((x) => new Date(x.start).getDate())).toEqual([25, 26, 27, 28, 29, 30, 31]);
    for (const x of b) expect(new Date(x.start).getHours()).toBe(0);
  });

  it('keeps one column per calendar day across the fall-back night', () => {
    const b = bucketEvents([], '7d', at(2026, 10, 27, 12));
    expect(b.map((x) => new Date(x.start).getDate())).toEqual([21, 22, 23, 24, 25, 26, 27]);
    for (const x of b) expect(new Date(x.start).getHours()).toBe(0);
  });

  it('counts an event on the shifted day into that very day', () => {
    const during = at(2026, 3, 29, 14);   // the 23-hour day
    const b = bucketEvents([during], '7d', at(2026, 3, 31, 12));
    const cell = b.find((x) => new Date(x.start).getDate() === 29);
    expect(cell.count).toBe(1);
    expect(b.reduce((a, c) => a + c.count, 0)).toBe(1);
  });

  it('still snaps to Monday in the week the clocks change', () => {
    const w = startOfWeek(new Date(at(2026, 3, 29, 12)));  // a Sunday
    expect(new Date(w).getDate()).toBe(23);
    expect(new Date(w).getHours()).toBe(0);
  });
});

describe('quota edge cases', () => {
  const now = at(2026, 9, 1, 12);

  it('falls back to the free allowance for a nonsense limit', () => {
    for (const bad of [0, -5, NaN, null, undefined, 'lots']) {
      expect(weekQuota([], now, bad).limit).toBe(WEEKLY_QUOTA);
    }
  });

  it('ignores junk in the series rather than counting it', () => {
    const monday = at(2026, 8, 31, 9);
    expect(weekQuota([monday, 'nope', null, NaN], now).used).toBe(1);
  });

  it('reports a clean zero for an untouched install', () => {
    const q = weekQuota(undefined, now);
    expect([q.used, q.percent, q.rolling7]).toEqual([0, 0, 0]);
    expect(q.remaining).toBe(WEEKLY_QUOTA);
  });
});

describe('appendEvent retention', () => {
  const now = at(2026, 9, 1);
  const days = (n) => now - n * 24 * 3600 * 1000;

  it('applies the age cutoff before the length cap', () => {
    // Otherwise the cap keeps the newest N *including* entries already expired.
    const list = [days(500), days(499), days(1)];
    const out = appendEvent(list, now, { now, maxAgeDays: 400, cap: 3 });
    expect(out).toEqual([days(1), now]);
  });

  it('keeps the series sorted even when a stale write arrives late', () => {
    const out = appendEvent([days(1)], days(2), { now });
    expect(out).toEqual([days(2), days(1)].sort((a, b) => a - b));
  });

  it('defaults a missing timestamp to now instead of writing NaN', () => {
    const out = appendEvent([], undefined, { now });
    expect(out).toEqual([now]);
  });
});

describe('escapeHtml', () => {
  it('neutralizes markup and quotes', () => {
    expect(escapeHtml('<b>"x" & \'y\'</b>'))
      .toBe('&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;');
  });
  it('survives null', () => {
    expect(escapeHtml(null)).toBe('');
  });
});
