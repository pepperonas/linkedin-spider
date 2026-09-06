import { describe, it, expect } from 'vitest';
import LC from '../lib.js';

const { reportHtml, weekQuota, bucketEvents, reportFilename, htmlDataUrl } = LC;

const now = new Date(2026, 8, 1, 15).getTime();
const events = [now - 3600e3, now - 7200e3, now - 26 * 3600e3];
const record = {
  ts: '2026-09-01T08:00:00.000Z', name: 'Max Mustermann',
  profileUrl: 'https://www.linkedin.com/in/max-m', headline: 'Dev bei Acme',
  company: 'Acme', location: 'Berlin', degree: '2.', profileId: 'A1',
  method: 'api', pageUrl: 'https://www.linkedin.com/search/results/people/'
};

const build = (over) => reportHtml(Object.assign({
  quota: weekQuota(events, now),
  buckets: bucketEvents(events, '7d', now),
  records: [record],
  rangeLabel: '7 d',
  generatedAt: new Date(now),
  version: '2.9.0'
}, over));

describe('reportHtml', () => {
  it('is a complete standalone document', () => {
    const html = build();
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('</html>');
    expect(html).toContain('<title>LinkedIn Spider report</title>');
    expect(html).toContain('charset="utf-8"');
  });

  it('pulls in nothing from the network — it has to open from disk', () => {
    const html = build();
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/@import/i);
    // celox.io in the footer is a link to click, not a resource that loads
    const loads = html.match(/(?:src|href)="https?:[^"]*"/g) || [];
    expect(loads).toEqual(['href="https://celox.io"']);
  });

  it('carries the chart, not a picture of one', () => {
    const html = build();
    expect(html).toContain('<svg');
    expect((html.match(/<rect class="lc-bar/g) || []).length).toBe(7);
    // the chart's own styles must travel with it
    expect(html).toContain('.lc-bar{fill:');
  });

  it('states the quota and the period it is reporting on', () => {
    const q = weekQuota(events, now);
    const html = build();
    expect(html).toContain(q.used + ' / ' + q.limit);
    expect(html).toContain('Requests over time — 7 d');
    expect(html).toContain('3 requests in this period');
  });

  it('says "1 request", not "1 requests"', () => {
    const html = build({ buckets: bucketEvents([now], '7d', now) });
    expect(html).toContain('1 request in this period');
    expect(html).not.toContain('1 requests in this period');
  });

  it('renders one table row per contact under the CSV column headings', () => {
    const html = build({ records: [record, { ...record, name: 'Erika Muster' }] });
    expect((html.match(/<tr>/g) || []).length).toBe(3); // header + 2
    expect(html).toContain('Contacts (2)');
    for (const col of ['Datum', 'Name', 'Profil-URL', 'Methode']) {
      expect(html).toContain('<th>' + col + '</th>');
    }
  });

  it('escapes scraped text instead of letting it become markup', () => {
    const evil = { ...record, name: '<img src=x onerror=alert(1)>', company: 'A & B "Ltd"' };
    const html = build({ records: [evil] });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('A &amp; B &quot;Ltd&quot;');
  });

  it('survives being handed nothing at all', () => {
    const html = reportHtml();
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('Contacts (0)');
    expect(html).toContain('No requests in this period');
  });
});

describe('report file naming', () => {
  it('stamps the filename with the date', () => {
    expect(reportFilename(new Date(2026, 8, 1, 9, 5)))
      .toBe('linkedin-spider-report-2026-09-01_0905.html');
  });

  it('carries the bytes in the URL, not in a revocable blob', () => {
    const url = htmlDataUrl('<p>ä &amp; ö</p>');
    expect(url.startsWith('data:text/html;charset=utf-8,')).toBe(true);
    expect(decodeURIComponent(url.split(',').slice(1).join(','))).toBe('<p>ä &amp; ö</p>');
  });
});

describe('the tally in the report', () => {
  const { reportHtml, statsSection } = globalThis.LC;
  const stats = {
    'kaufmännischer leiter|berlin': { term: 'Kaufmännischer Leiter', city: 'Berlin', n: 100, first: 1, last: 1757000000000 },
    'leiter digitalisierung|': { term: 'Leiter Digitalisierung', city: '', n: 64, first: 1, last: 1757000000000 }
  };

  it('lists every combination with its count', () => {
    const html = statsSection(stats);
    expect(html).toContain('Kaufmännischer Leiter');
    expect(html).toContain('<td>100</td>');
    expect(html).toContain('164 requests across 2 combinations');
  });

  it('shows a combination without a city as such, not as blank', () => {
    expect(statsSection(stats)).toContain('<td>—</td>');
  });

  // An empty table in a report is noise — the section stays away entirely.
  it('is left out when nothing has been counted', () => {
    expect(statsSection({})).toBe('');
    expect(statsSection(undefined)).toBe('');
  });

  it('rides along in the full report', () => {
    const html = reportHtml({ records: [], stats, version: '2.14.0' });
    expect(html).toContain('Sent per search (2)');
  });

  it('escapes what it prints', () => {
    const html = statsSection({ 'x|y': { term: '<img src=x>', city: 'Berlin', n: 1, first: 1, last: 1 } });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});

