import { describe, it, expect, beforeEach } from 'vitest';

// Load lib.js — attaches to globalThis.LC
await import('../lib.js');
const {
  cleanName, findCardRoot, extractCardInfo,
  toCsv, csvFilename, csvDataUrl, buildRecord, appendRecord, profileIdsFromLog, LOG_CAP
} = globalThis.LC;

function clearBody() {
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
}

describe('cleanName', () => {
  it('strips the German invite phrasing', () => {
    expect(cleanName('Max Mustermann als Kontakt einladen')).toBe('Max Mustermann');
  });

  it('strips the English invite phrasing', () => {
    expect(cleanName('Invite Max Mustermann to connect')).toBe('Max Mustermann');
  });

  it('strips the French invite phrasing', () => {
    expect(cleanName('Se mettre en relation avec Marie Dupont')).toBe('Marie Dupont');
  });

  it('strips the Spanish invite phrasing', () => {
    expect(cleanName('Invitar a Juan Pérez a conectar')).toBe('Juan Pérez');
  });

  it('strips the Italian invite phrasing', () => {
    expect(cleanName('Invita Luca Rossi a collegarsi')).toBe('Luca Rossi');
  });

  it('keeps a name that contains the word "als"', () => {
    expect(cleanName('Peter Walser als Kontakt einladen')).toBe('Peter Walser');
  });

  it('returns empty string for a bare button label', () => {
    expect(cleanName('Vernetzen')).toBe('');
    expect(cleanName('Connect')).toBe('');
  });

  it('collapses whitespace', () => {
    expect(cleanName('  Max   Mustermann  ')).toBe('Max Mustermann');
  });

  it('drops a trailing connection-degree marker', () => {
    expect(cleanName('Max Mustermann · 2.')).toBe('Max Mustermann');
    expect(cleanName('Max Mustermann • 3rd+')).toBe('Max Mustermann');
  });

  it('tolerates null and undefined', () => {
    expect(cleanName(null)).toBe('');
    expect(cleanName(undefined)).toBe('');
  });
});

describe('findCardRoot', () => {
  beforeEach(clearBody);

  it('returns the container holding exactly one distinct profile link', () => {
    const card = document.createElement('div');
    card.innerHTML = `
      <a href="/in/lisa-x/"><img></a>
      <a href="/in/lisa-x/?origin=SEARCH">Lisa</a>
      <button>Vernetzen</button>`;
    document.body.appendChild(card);

    const res = findCardRoot(card.querySelector('button'));
    expect(res.root).toBe(card);
    expect(res.vanity).toBe('lisa-x');
  });

  it('returns nulls when the container is ambiguous', () => {
    const list = document.createElement('div');
    list.innerHTML = `
      <a href="/in/one/">One</a>
      <a href="/in/two/">Two</a>
      <button>Vernetzen</button>`;
    document.body.appendChild(list);

    expect(findCardRoot(list.querySelector('button'))).toEqual({ root: null, vanity: null });
  });

  it('returns nulls when there is no profile link at all', () => {
    const card = document.createElement('div');
    card.innerHTML = '<button>Vernetzen</button>';
    document.body.appendChild(card);

    expect(findCardRoot(card.querySelector('button'))).toEqual({ root: null, vanity: null });
  });
});

describe('extractCardInfo', () => {
  beforeEach(clearBody);

  function buildCard(inner) {
    const card = document.createElement('div');
    card.innerHTML = inner;
    document.body.appendChild(card);
    return card;
  }

  it('reads name, url, degree, headline, company and location from a search card', () => {
    const card = buildCard(`
      <a href="/in/max-mustermann-1a2b3c/?origin=SEARCH"><span>Max Mustermann</span></a>
      <span>· 2.</span>
      <span><span>Senior Backend Engineer bei Acme GmbH</span></span>
      <span>Berlin, Deutschland</span>
      <a href="/in/max-mustermann-1a2b3c/" aria-label="Max Mustermann als Kontakt einladen">Vernetzen</a>`);

    const info = extractCardInfo(card.querySelector('a[aria-label]'));
    expect(info.name).toBe('Max Mustermann');
    expect(info.vanity).toBe('max-mustermann-1a2b3c');
    expect(info.profileUrl).toBe('https://www.linkedin.com/in/max-mustermann-1a2b3c');
    expect(info.degree).toBe('2.');
    expect(info.headline).toBe('Senior Backend Engineer bei Acme GmbH');
    expect(info.company).toBe('Acme GmbH');
    expect(info.location).toBe('Berlin, Deutschland');
  });

  it('prefers an explicit company link over splitting the headline', () => {
    const card = buildCard(`
      <a href="/in/lisa-x/">Lisa Beispiel</a>
      <span>Head of Sales bei Irgendwas</span>
      <a href="/company/echte-firma-gmbh/">Echte Firma GmbH</a>
      <a href="/in/lisa-x/" aria-label="Lisa Beispiel als Kontakt einladen">Vernetzen</a>`);

    expect(extractCardInfo(card.querySelector('a[aria-label]')).company).toBe('Echte Firma GmbH');
  });

  it('splits an English headline on " at "', () => {
    const card = buildCard(`
      <a href="/in/john-doe/">John Doe</a>
      <span>Product Manager at Globex Corporation</span>
      <a href="/in/john-doe/" aria-label="Invite John Doe to connect">Connect</a>`);

    const info = extractCardInfo(card.querySelector('a[aria-label]'));
    expect(info.headline).toBe('Product Manager at Globex Corporation');
    expect(info.company).toBe('Globex Corporation');
  });

  it('never returns the connect button label as the headline', () => {
    const card = buildCard(`
      <a href="/in/lisa-x/">Lisa Beispiel</a>
      <a href="/in/lisa-x/" aria-label="Lisa Beispiel als Kontakt einladen">Vernetzen</a>`);

    const info = extractCardInfo(card.querySelector('a[aria-label]'));
    expect(info.headline).toBe('');
    expect(info.name).toBe('Lisa Beispiel');
  });

  it('ignores LinkedIn duplicate visually-hidden text', () => {
    // LinkedIn renders each line twice (aria-hidden + screen-reader copy).
    // Without dedupe the duplicate headline would be read as the location.
    const card = buildCard(`
      <a href="/in/lisa-x/"><span aria-hidden="true">Lisa Beispiel</span><span class="visually-hidden">Lisa Beispiel</span></a>
      <span aria-hidden="true">UX Designerin</span>
      <span class="visually-hidden">UX Designerin</span>
      <span>Hamburg, Deutschland</span>
      <a href="/in/lisa-x/" aria-label="Lisa Beispiel als Kontakt einladen">Vernetzen</a>`);

    const info = extractCardInfo(card.querySelector('a[aria-label]'));
    expect(info.name).toBe('Lisa Beispiel');
    expect(info.headline).toBe('UX Designerin');
    expect(info.location).toBe('Hamburg, Deutschland');
  });

  it('falls back to the aria-label name when the card has no readable link text', () => {
    const card = buildCard(`
      <a href="/in/hidden-person/"><img></a>
      <a href="/in/hidden-person/" aria-label="Erika Muster als Kontakt einladen"><span></span></a>`);

    expect(extractCardInfo(card.querySelector('a[aria-label]')).name).toBe('Erika Muster');
  });

  it('returns an all-empty record when there is no card at all', () => {
    const btn = document.createElement('button');
    btn.textContent = 'Vernetzen';
    document.body.appendChild(btn);

    expect(extractCardInfo(btn)).toEqual({
      name: '', vanity: '', profileUrl: '', headline: '', company: '', location: '', degree: ''
    });
  });
});

describe('toCsv', () => {
  const rec = {
    ts: '2026-08-30T12:34:56.000Z',
    name: 'Max Mustermann',
    profileUrl: 'https://www.linkedin.com/in/max',
    headline: 'Dev bei Acme',
    company: 'Acme',
    location: 'Berlin',
    degree: '2.',
    profileId: 'ACoAAB123',
    method: 'api',
    pageUrl: 'https://www.linkedin.com/search/results/people/'
  };

  it('starts with a UTF-8 BOM so Excel picks up the encoding', () => {
    expect(toCsv([])[0]).toBe('﻿');
  });

  it('writes the German header row separated by semicolons', () => {
    const line = toCsv([]).replace(/^﻿/, '').split('\r\n')[0];
    expect(line).toBe('"Datum";"Name";"Profil-URL";"Headline";"Firma";"Ort";"Grad";"Profil-ID";"Methode";"Suchseite"');
  });

  it('emits header only for an empty log', () => {
    expect(toCsv([]).replace(/^﻿/, '').split('\r\n').length).toBe(1);
  });

  it('writes one CRLF-terminated row per record', () => {
    const rows = toCsv([rec, rec]).replace(/^﻿/, '').split('\r\n');
    expect(rows.length).toBe(3);
    expect(rows[1]).toContain('"Max Mustermann"');
  });

  it('quotes every field and doubles inner quotes', () => {
    const row = toCsv([{ ...rec, name: 'Max "Maxi" Mustermann' }]).split('\r\n')[1];
    expect(row).toContain('"Max ""Maxi"" Mustermann"');
  });

  it('keeps a semicolon inside a field from breaking the column', () => {
    const row = toCsv([{ ...rec, headline: 'Dev; Ops; Alles' }]).split('\r\n')[1];
    expect(row).toContain('"Dev; Ops; Alles"');
    expect(row.split('";"').length).toBe(10);
  });

  it('flattens newlines and tabs inside a field to single spaces', () => {
    const row = toCsv([{ ...rec, headline: 'Zeile1\nZeile2\tTab' }]).split('\r\n')[1];
    expect(row).toContain('"Zeile1 Zeile2 Tab"');
  });

  it('neutralises spreadsheet formula injection', () => {
    const row = toCsv([{ ...rec, name: '=HYPERLINK("http://evil","klick")' }]).split('\r\n')[1];
    expect(row).toContain(`"'=HYPERLINK(""http://evil"",""klick"")"`);
  });

  it('neutralises the other formula lead characters', () => {
    for (const lead of ['+', '-', '@']) {
      const row = toCsv([{ ...rec, company: lead + 'SUM(A1)' }]).split('\r\n')[1];
      expect(row).toContain(`"'${lead}SUM(A1)"`);
    }
  });

  it('renders missing fields as empty columns instead of "undefined"', () => {
    const row = toCsv([{ name: 'Nur Name' }]).split('\r\n')[1];
    expect(row).not.toContain('undefined');
    expect(row).toBe('"";"Nur Name";"";"";"";"";"";"";"";""');
  });

  it('formats the timestamp as a readable local date-time', () => {
    const row = toCsv([{ ...rec, ts: '2026-08-30T12:34:56.000Z' }]).split('\r\n')[1];
    expect(row).toMatch(/^"\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}"/);
  });
});

describe('csvFilename', () => {
  it('builds a descriptive name with a date-time stamp', () => {
    expect(csvFilename(new Date(2026, 7, 30, 14, 32)))
      .toBe('linkedin-spider-anfragen-2026-08-30_1432.csv');
  });

  it('zero-pads single-digit parts', () => {
    expect(csvFilename(new Date(2026, 0, 5, 9, 7)))
      .toBe('linkedin-spider-anfragen-2026-01-05_0907.csv');
  });
});

describe('appendRecord', () => {
  const rec = (id) => ({ ts: 't', name: 'n', profileId: id });

  it('appends to a copy without mutating the input', () => {
    const log = [rec('A')];
    const next = appendRecord(log, rec('B'));
    expect(next.map(r => r.profileId)).toEqual(['A', 'B']);
    expect(log.length).toBe(1);
  });

  it('skips a profile that is already in the log', () => {
    const next = appendRecord([rec('A')], rec('A'));
    expect(next.length).toBe(1);
  });

  it('always appends records without a profile ID', () => {
    const next = appendRecord([rec('')], rec(''));
    expect(next.length).toBe(2);
  });

  it('drops the oldest entries once the cap is reached', () => {
    const log = [rec('A'), rec('B'), rec('C')];
    const next = appendRecord(log, rec('D'), 3);
    expect(next.map(r => r.profileId)).toEqual(['B', 'C', 'D']);
  });

  it('tolerates a missing log', () => {
    expect(appendRecord(undefined, rec('A')).length).toBe(1);
  });

  it('has a sane default cap', () => {
    expect(LOG_CAP).toBeGreaterThan(1000);
  });
});

describe('profileIdsFromLog', () => {
  it('collects the non-empty profile IDs', () => {
    const ids = profileIdsFromLog([
      { profileId: 'A' }, { profileId: '' }, { profileId: 'B' }, {}
    ]);
    expect(ids).toEqual(new Set(['A', 'B']));
  });

  it('tolerates a missing log', () => {
    expect(profileIdsFromLog(undefined)).toEqual(new Set());
  });
});

describe('buildRecord', () => {
  const card = {
    name: 'Max Mustermann', vanity: 'max-m', profileUrl: 'https://www.linkedin.com/in/max-m',
    headline: 'Dev bei Acme', company: 'Acme', location: 'Berlin', degree: '2.'
  };

  it('merges the card snapshot with the send metadata', () => {
    const rec = buildRecord(card, {
      profileId: 'ACoAAB1', method: 'api',
      pageUrl: 'https://www.linkedin.com/search/results/people/?keywords=dev',
      now: new Date('2026-08-30T12:00:00.000Z')
    });

    expect(rec).toEqual({
      ts: '2026-08-30T12:00:00.000Z',
      name: 'Max Mustermann',
      profileUrl: 'https://www.linkedin.com/in/max-m',
      headline: 'Dev bei Acme',
      company: 'Acme',
      location: 'Berlin',
      degree: '2.',
      profileId: 'ACoAAB1',
      method: 'api',
      pageUrl: 'https://www.linkedin.com/search/results/people/?keywords=dev'
    });
  });

  it('derives the profile URL from the profile ID when the card had no /in/ link', () => {
    const rec = buildRecord({ ...card, profileUrl: '', vanity: '' }, { profileId: 'ACoAAB1' });
    expect(rec.profileUrl).toBe('https://www.linkedin.com/in/ACoAAB1');
  });

  it('leaves the profile URL empty when neither link nor ID is known', () => {
    expect(buildRecord({ ...card, profileUrl: '', vanity: '' }, {}).profileUrl).toBe('');
  });

  it('never emits undefined fields', () => {
    const rec = buildRecord(null, null);
    for (const v of Object.values(rec)) expect(typeof v).toBe('string');
  });

  it('stamps the current time when no clock is passed', () => {
    const before = Date.now();
    const ts = Date.parse(buildRecord(card, { profileId: 'X' }).ts);
    expect(ts).toBeGreaterThanOrEqual(before - 1000);
    expect(ts).toBeLessThanOrEqual(Date.now() + 1000);
  });
});

describe('csvDataUrl', () => {
  it('produces a self-contained text/csv data URL', () => {
    expect(csvDataUrl('a;b')).toBe('data:text/csv;charset=utf-8,a%3Bb');
  });

  it('survives umlauts and the BOM without mangling them', () => {
    const csv = toCsv([{ name: 'Jürgen Groß' }]);
    expect(decodeURIComponent(csvDataUrl(csv).replace('data:text/csv;charset=utf-8,', ''))).toBe(csv);
  });

  it('encodes characters a URL would otherwise swallow', () => {
    const url = csvDataUrl('x#y&z');
    expect(url).not.toContain('#');
    expect(url).not.toContain('&');
  });
});
