import { describe, it, expect, vi } from 'vitest';
import LC from '../lib.js';

const {
  opsNormLinkedin, blockSet, isBlockedUrl, opsFetchBlocklist, normalizeBlock,
  OPS_BLOCKLIST_PATH, findNextConnect
} = LC;

// ⚠️ These examples are the ones ops pins in `backend/tests/test_lead_dedup.py`
// for `norm_linkedin`. The two implementations MUST agree, or the blocklist
// silently stops matching and the extension writes to people ops closed.
const PROFIL = 'linkedin.com/in/manfred-van-asten-b25ba020a';

describe('opsNormLinkedin — parity with ops norm_linkedin', () => {
  it('schema and www do not matter, case neither', () => {
    for (const u of ['https://www.linkedin.com/in/manfred-van-asten-b25ba020a/',
      'http://linkedin.com/in/manfred-van-asten-b25ba020a',
      'LinkedIn.com/IN/Manfred-Van-Asten-B25BA020A']) {
      expect(opsNormLinkedin(u)).toBe(PROFIL);
    }
  });
  it('a country subdomain is the same profile', () => {
    expect(opsNormLinkedin('https://de.linkedin.com/in/manfred-van-asten-b25ba020a')).toBe(PROFIL);
  });
  it('tracking parameters and fragments fall away', () => {
    expect(opsNormLinkedin('https://www.linkedin.com/in/manfred-van-asten-b25ba020a/?miniProfileUrn=abc&trk=xyz')).toBe(PROFIL);
    expect(opsNormLinkedin('https://' + PROFIL + '#experience')).toBe(PROFIL);
  });
  it('different profiles stay different', () => {
    expect(opsNormLinkedin('https://linkedin.com/in/person-a')).not.toBe(opsNormLinkedin('https://linkedin.com/in/person-b'));
  });
  it('empty is no key', () => {
    for (const u of [null, '', '   ', undefined]) expect(opsNormLinkedin(u)).toBe(null);
  });
  it("normalises the extension's own fallback URL the same way", () => {
    expect(opsNormLinkedin('https://www.linkedin.com/in/ACoAAB1')).toBe('linkedin.com/in/acoaab1');
  });
});

describe('blockSet / isBlockedUrl', () => {
  it('matches a card URL against the stored keys', () => {
    const set = blockSet({ norms: [PROFIL, 'linkedin.com/in/other'] });
    expect(isBlockedUrl('https://de.linkedin.com/in/manfred-van-asten-b25ba020a/?trk=x', set)).toBe(true);
    expect(isBlockedUrl('https://www.linkedin.com/in/someone-else', set)).toBe(false);
    expect(isBlockedUrl('', set)).toBe(false);
  });
  it('survives junk in storage', () => {
    expect(blockSet(null).size).toBe(0);
    expect(blockSet({ norms: 'x' }).size).toBe(0);
    expect(blockSet({ norms: [5, null, 'linkedin.com/in/a', 'linkedin.com/in/a'] }).size).toBe(1);
  });
});

describe('normalizeBlock', () => {
  it('keeps at, count and the keys — nothing else', () => {
    const b = normalizeBlock({ at: 5, norms: ['linkedin.com/in/a', 'linkedin.com/in/a', 7], count: 99, extra: 'x' });
    expect(b).toEqual({ at: 5, norms: ['linkedin.com/in/a'], count: 1 });
    expect(normalizeBlock(undefined)).toEqual({ at: 0, norms: [], count: 0 });
  });
});

describe('opsFetchBlocklist', () => {
  const settings = { baseUrl: 'https://ops.example', token: 'ops_' + 'x'.repeat(40) };
  const reply = (status, body) => Promise.resolve({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });

  it('GETs the blocklist with the bearer token and returns the keys', async () => {
    const fetchFn = vi.fn(() => reply(200, { norms: ['linkedin.com/in/a', 'linkedin.com/in/b'], count: 2, generated_at: 't' }));
    const r = await opsFetchBlocklist({ settings, fetchFn, now: 1234 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://ops.example' + OPS_BLOCKLIST_PATH);
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer ' + settings.token);
    expect(r).toEqual({ ok: true, block: { at: 1234, norms: ['linkedin.com/in/a', 'linkedin.com/in/b'], count: 2 } });
  });

  it('reports auth and server errors instead of throwing', async () => {
    expect(await opsFetchBlocklist({ settings, fetchFn: () => reply(401, { detail: 'nope' }) }))
      .toEqual({ ok: false, status: 401, error: 'ops answered 401' });
    expect(await opsFetchBlocklist({ settings, fetchFn: () => Promise.reject(new Error('offline')) }))
      .toEqual({ ok: false, error: 'ops unreachable: offline' });
  });

  it('rejects a payload that is not a blocklist', async () => {
    const r = await opsFetchBlocklist({ settings, fetchFn: () => reply(200, { hello: 'world' }) });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/payload/);
  });

  it('does nothing without a token', async () => {
    const fetchFn = vi.fn();
    const r = await opsFetchBlocklist({ settings: { baseUrl: 'https://ops.example', token: '' }, fetchFn });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
  });
});

describe('findNextConnect skips cards marked as blocked', () => {
  it('honours data-lc-blocked', () => {
    document.body.innerHTML = `
      <div componentkey="SearchResultsA1"><a href="/in/a/" aria-label="A als Kontakt einladen" data-lc-blocked="1">Vernetzen</a></div>
      <div componentkey="SearchResultsB2"><a href="/in/b/" aria-label="B als Kontakt einladen">Vernetzen</a></div>`;
    const el = findNextConnect(new Set());
    expect(el.getAttribute('href')).toBe('/in/b/');
    document.body.innerHTML = '';
  });
});
