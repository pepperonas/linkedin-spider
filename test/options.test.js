import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

await import('../lib.js');

const HTML = fs.readFileSync(path.resolve('options.html'), 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(path.resolve('manifest.json'), 'utf8'));

let storage, workerMessages, workerReply, permissions;

function mountOptions() {
  const body = HTML.match(/<body[^>]*>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '');
  document.body.innerHTML = body;
}

function setupChrome() {
  storage = {};
  workerMessages = [];
  workerReply = { ok: true };
  permissions = { granted: new Set(['https://ops.celox.io/*']), asked: [] };
  globalThis.chrome = {
    runtime: {
      lastError: null,
      getManifest: () => MANIFEST,
      sendMessage(msg, cb) { workerMessages.push(msg); if (cb) cb(typeof workerReply === 'function' ? workerReply(msg) : workerReply); }
    },
    storage: { local: {
      get(keys, cb) { const out = {}; for (const k of keys) if (k in storage) out[k] = storage[k]; cb(out); },
      set(obj, cb) { Object.assign(storage, obj); if (cb) cb(); }
    } },
    permissions: {
      contains(q, cb) { cb(q.origins.every((o) => permissions.granted.has(o))); },
      request(q, cb) { permissions.asked.push(q.origins); const ok = permissions.allow !== false; if (ok) q.origins.forEach((o) => permissions.granted.add(o)); cb(ok); }
    }
  };
}

async function loadOptions() {
  vi.resetModules();
  await import('../options.js');
  await flush();
}
async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }

const TOKEN = 'ops_' + 'q'.repeat(40);
const $ = (id) => document.getElementById(id);

describe('options page: ops connection', () => {
  beforeEach(() => { mountOptions(); setupChrome(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('starts with the default ops URL and an empty token', async () => {
    await loadOptions();
    expect($('ops-url').value).toBe('https://ops.celox.io');
    expect($('ops-token').value).toBe('');
    expect($('ops-token').type).toBe('password');
    expect($('ops-sync-now').disabled).toBe(true);
    expect($('version').textContent).toBe('v' + MANIFEST.version);
  });

  it('shows what is stored', async () => {
    storage.lcOps = { baseUrl: 'https://ops.example', token: TOKEN, auto: true };
    await loadOptions();
    expect($('ops-url').value).toBe('https://ops.example');
    expect($('ops-token').value).toBe(TOKEN);
    expect($('ops-auto').checked).toBe(true);
    expect($('ops-sync-now').disabled).toBe(false);
  });

  it('saves a valid URL + token, normalized', async () => {
    await loadOptions();
    $('ops-url').value = ' https://ops.celox.io/ ';
    $('ops-token').value = ' ' + TOKEN + ' ';
    $('ops-save').click();
    await flush();
    expect(storage.lcOps).toEqual({ baseUrl: 'https://ops.celox.io', token: TOKEN, auto: false });
    expect($('ops-hint').textContent).toMatch(/saved/i);
  });

  it('refuses a token that is not an ops token, and writes nothing', async () => {
    await loadOptions();
    $('ops-token').value = 'eyJhbGciOi.some.jwt';
    $('ops-save').click();
    await flush();
    expect(storage.lcOps).toBeUndefined();
    expect($('ops-hint').className).toMatch(/error/);
    expect($('ops-hint').textContent).toMatch(/ops_/);
  });

  it('refuses a plain-http remote URL', async () => {
    await loadOptions();
    $('ops-url').value = 'http://ops.celox.io';
    $('ops-token').value = TOKEN;
    $('ops-save').click();
    await flush();
    expect(storage.lcOps).toBeUndefined();
    expect($('ops-hint').textContent).toMatch(/https/);
  });

  it('asks Chrome for access to a custom host before saving it', async () => {
    await loadOptions();
    $('ops-url').value = 'https://ops.example';
    $('ops-token').value = TOKEN;
    $('ops-save').click();
    await flush();
    expect(permissions.asked).toEqual([['https://ops.example/*']]);
    expect(storage.lcOps.baseUrl).toBe('https://ops.example');
  });

  it('does not save a host the user declined access to', async () => {
    permissions.allow = false;
    await loadOptions();
    $('ops-url').value = 'https://ops.example';
    $('ops-token').value = TOKEN;
    $('ops-save').click();
    await flush();
    expect(storage.lcOps).toBeUndefined();
    expect($('ops-hint').textContent).toMatch(/not grant/i);
  });

  it('does not ask for a permission the manifest already grants', async () => {
    await loadOptions();
    $('ops-token').value = TOKEN;
    $('ops-save').click();
    await flush();
    expect(permissions.asked).toEqual([]);
    expect(storage.lcOps.baseUrl).toBe('https://ops.celox.io');
  });

  it('tests the connection through the worker with the typed (unsaved) values', async () => {
    workerReply = { ok: true, status: 200 };
    await loadOptions();
    $('ops-token').value = TOKEN;
    $('ops-test').click();
    await flush();
    expect(workerMessages[0]).toEqual({ action: 'opsTest', settings: { baseUrl: 'https://ops.celox.io', token: TOKEN } });
    expect($('ops-hint').textContent).toMatch(/connected/i);
    expect(storage.lcOps).toBeUndefined();   // testing is not saving
  });

  it("shows the worker's reason when the test fails", async () => {
    workerReply = { ok: false, error: 'ops answered 401: API-Token ungültig oder widerrufen' };
    await loadOptions();
    $('ops-token').value = TOKEN;
    $('ops-test').click();
    await flush();
    expect($('ops-hint').textContent).toMatch(/401/);
    expect($('ops-hint').className).toMatch(/error/);
  });

  it('flips auto-sync in place once configured', async () => {
    storage.lcOps = { baseUrl: 'https://ops.celox.io', token: TOKEN, auto: false };
    await loadOptions();
    $('ops-auto').checked = true;
    $('ops-auto').dispatchEvent(new Event('change'));
    await flush();
    expect(storage.lcOps.auto).toBe(true);
    expect(storage.lcOps.token).toBe(TOKEN);   // nothing else lost
  });
});

describe('options page: status + sync', () => {
  beforeEach(() => { mountOptions(); setupChrome(); });

  const rec = (id) => ({ profileUrl: 'https://www.linkedin.com/in/' + id, profileId: id, name: id });

  it('counts synced, pending and rejected', async () => {
    storage.lcOps = { baseUrl: 'https://ops.celox.io', token: TOKEN, auto: false };
    storage.lcLog = [rec('A'), rec('B'), rec('C'), rec('D')];
    storage.lcOpsState = { A: { status: 'ok', v: globalThis.LC.OPS_ROW_VERSION }, B: { status: 'ok', v: globalThis.LC.OPS_ROW_VERSION }, C: { status: 'invalid' } };
    await loadOptions();
    expect($('st-synced').textContent).toBe('2');
    expect($('st-invalid').textContent).toBe('1');
    expect($('st-pending').textContent).toBe('1');
  });

  it('describes the last run, including failures', async () => {
    storage.lcOps = { baseUrl: 'https://ops.celox.io', token: TOKEN };
    storage.lcOpsLast = { at: Date.now(), sent: 3, created: 2, updated: 1, unchanged: 0, invalid: 0, error: null };
    await loadOptions();
    expect($('st-last').textContent).toMatch(/3 sent/);
    expect($('st-last').textContent).toMatch(/2 new/);

    storage.lcOpsLast = { at: Date.now(), sent: 0, created: 0, updated: 0, unchanged: 0, invalid: 0, error: 'ops unreachable: Failed to fetch' };
    await loadOptions();
    expect($('st-last').textContent).toMatch(/failed/);
    expect($('st-last').textContent).toMatch(/unreachable/);
  });

  it('"Sync now" asks the worker and reports its summary', async () => {
    storage.lcOps = { baseUrl: 'https://ops.celox.io', token: TOKEN };
    workerReply = { ok: true, summary: { sent: 4, created: 3, updated: 1, unchanged: 0 } };
    await loadOptions();
    $('ops-sync-now').click();
    await flush();
    expect(workerMessages.some((m) => m.action === 'opsSync')).toBe(true);
    expect($('ops-hint').textContent).toMatch(/4 sent/);
  });

  it('forgetting the sync state takes two clicks and only clears the state', async () => {
    storage.lcOps = { baseUrl: 'https://ops.celox.io', token: TOKEN };
    storage.lcLog = [rec('A')];
    storage.lcOpsState = { A: { status: 'ok', v: globalThis.LC.OPS_ROW_VERSION } };
    storage.lcOpsLast = { at: 1, sent: 1 };
    await loadOptions();
    $('ops-forget').click();
    await flush();
    expect(storage.lcOpsState).toEqual({ A: { status: 'ok', v: globalThis.LC.OPS_ROW_VERSION } });   // armed only
    expect($('ops-forget').textContent).toMatch(/really/i);
    $('ops-forget').click();
    await flush();
    expect(storage.lcOpsState).toEqual({});
    expect(storage.lcOpsLast).toBe(null);
    expect(storage.lcLog).toEqual([rec('A')]);                      // contacts untouched
    expect(storage.lcOps.token).toBe(TOKEN);                        // settings untouched
    expect($('st-pending').textContent).toBe('1');
  });
});

describe('options page: update check', () => {
  beforeEach(() => { mountOptions(); setupChrome(); });

  it('asks Chrome for api.github.com on the click, then the worker', async () => {
    workerReply = (msg) => msg.action === 'checkUpdate'
      ? { ok: true, installed: MANIFEST.version, latest: '9.9.9', available: true, url: 'https://github.com/pepperonas/linkedin-spider/releases/tag/v9.9.9' }
      : { ok: true };
    await loadOptions();
    $('ops-update').click();
    await flush();
    expect(permissions.asked).toEqual([['https://api.github.com/*']]);
    expect(workerMessages.some((m) => m.action === 'checkUpdate' && m.force === true)).toBe(true);
    const el = $('update-result');
    expect(el.textContent).toMatch(/9\.9\.9/);
    expect(el.querySelector('a').getAttribute('href')).toMatch(/releases\/tag\/v9\.9\.9$/);
    expect(el.querySelector('a').getAttribute('rel')).toContain('noopener');
  });

  it('says so when it is up to date', async () => {
    workerReply = (msg) => msg.action === 'checkUpdate'
      ? { ok: true, installed: MANIFEST.version, latest: MANIFEST.version, available: false, url: 'x' } : { ok: true };
    await loadOptions();
    $('ops-update').click();
    await flush();
    expect($('update-result').textContent).toMatch(/up to date/i);
  });

  it('does nothing further when the user declines the permission', async () => {
    permissions.allow = false;
    await loadOptions();
    $('ops-update').click();
    await flush();
    expect(workerMessages.some((m) => m.action === 'checkUpdate')).toBe(false);
    expect($('update-result').textContent).toMatch(/not grant/i);
  });

  it('shows the worker\'s error', async () => {
    workerReply = (msg) => msg.action === 'checkUpdate' ? { ok: false, error: 'GitHub unreachable: Failed to fetch' } : { ok: true };
    await loadOptions();
    $('ops-update').click();
    await flush();
    expect($('update-result').textContent).toMatch(/unreachable/);
  });

  it('shows the last API error LinkedIn returned, for diagnosis', async () => {
    storage.lcLastApiError = { at: Date.now(), status: 400, body: '{"message":"weekly limit"}', url: '/voyager/api/x' };
    await loadOptions();
    expect($('st-apierror').textContent).toMatch(/400/);
    expect($('st-apierror').textContent).toMatch(/weekly limit/);
  });
});

describe('options page contract', () => {
  it('loads lib.js before options.js', () => {
    expect(HTML.indexOf('src="lib.js"')).toBeGreaterThan(-1);
    expect(HTML.indexOf('src="lib.js"')).toBeLessThan(HTML.indexOf('src="options.js"'));
  });
  it('is the manifest options page', () => {
    expect(MANIFEST.options_ui.page).toBe('options.html');
    expect(MANIFEST.background.service_worker).toBe('background.js');
    expect(MANIFEST.host_permissions).toContain('https://ops.celox.io/*');
  });
  it('never hard-codes a token or a version', () => {
    const js = fs.readFileSync(path.resolve('options.js'), 'utf8');
    expect(js).not.toMatch(/ops_[A-Za-z0-9_-]{32,}/);
    expect(js).not.toMatch(/['"]\d+\.\d+\.\d+['"]/);
  });
});

describe('options page: pacing', () => {
  beforeEach(() => { mountOptions(); setupChrome(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('shows the defaults: jitter on, every cap empty (= off)', async () => {
    await loadOptions();
    expect($('pace-jitter').checked).toBe(true);
    expect($('pace-hour').value).toBe('');
    expect($('pace-day').value).toBe('');
    expect($('pace-stop').value).toBe('');
  });

  it('reads stored settings back into the form', async () => {
    storage.lcPace = { jitter: false, perHour: 20, perDay: 60, stopAtPercent: 90 };
    await loadOptions();
    expect($('pace-jitter').checked).toBe(false);
    expect($('pace-hour').value).toBe('20');
    expect($('pace-day').value).toBe('60');
    expect($('pace-stop').value).toBe('90');
  });

  it('saves normalized values under lcPace and says so', async () => {
    await loadOptions();
    $('pace-jitter').checked = false;
    $('pace-hour').value = '25';
    $('pace-day').value = '';
    $('pace-stop').value = '80';
    $('pace-save').click();
    await flush();
    expect(storage.lcPace).toEqual({ jitter: false, perHour: 25, perDay: 0, stopAtPercent: 80 });
    expect($('pace-hint').textContent).toMatch(/Saved/);
  });

  it('clamps junk instead of storing it', async () => {
    await loadOptions();
    $('pace-hour').value = '-5';
    $('pace-day').value = '9999';
    $('pace-stop').value = '150';
    $('pace-save').click();
    await flush();
    expect(storage.lcPace).toEqual({ jitter: true, perHour: 0, perDay: 200, stopAtPercent: 100 });
    expect($('pace-day').value).toBe('200');   // the form shows what was actually stored
    expect($('pace-stop').value).toBe('100');
  });

  it('the number fields carry the same bounds the code enforces', () => {
    mountOptions();
    expect($('pace-hour').max).toBe('200');
    expect($('pace-day').max).toBe('200');
    expect($('pace-stop').max).toBe('100');
    for (const id of ['pace-hour', 'pace-day', 'pace-stop']) expect($(id).min).toBe('0');
  });
});

describe('options page: the do-not-contact list from ops', () => {
  beforeEach(() => { mountOptions(); setupChrome(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('shows the size and age of the list', async () => {
    storage.lcOps = { baseUrl: 'https://ops.celox.io', token: TOKEN, auto: false };
    storage.lcBlock = { at: new Date(2026, 8, 3, 14, 5).getTime(), norms: ['linkedin.com/in/a', 'linkedin.com/in/b', 'linkedin.com/in/c'], count: 3 };
    await loadOptions();
    expect($('st-block').textContent).toMatch(/3 profiles/);
    expect($('st-block').textContent).toMatch(/03\.09\.2026/);
    expect($('ops-blocklist').disabled).toBe(false);
  });

  it('says when there is no list yet, and keeps the button off without a token', async () => {
    await loadOptions();
    expect($('st-block').textContent).toMatch(/not fetched yet/i);
    expect($('ops-blocklist').disabled).toBe(true);
  });

  it('Refresh asks the worker and shows the fresh count', async () => {
    storage.lcOps = { baseUrl: 'https://ops.celox.io', token: TOKEN, auto: false };
    workerReply = (msg) => {
      if (msg.action === 'opsBlocklist') { storage.lcBlock = { at: Date.now(), norms: ['linkedin.com/in/a'], count: 1 }; return { ok: true, count: 1 }; }
      return { ok: true };
    };
    await loadOptions();
    $('ops-blocklist').click();
    await flush();
    expect(workerMessages.some((m) => m.action === 'opsBlocklist')).toBe(true);
    expect($('st-block').textContent).toMatch(/1 profile/);
    expect($('block-hint').textContent).toMatch(/1 profile/);
  });

  it('a failed refresh is said out loud', async () => {
    storage.lcOps = { baseUrl: 'https://ops.celox.io', token: TOKEN, auto: false };
    workerReply = { ok: false, error: 'ops answered 401' };
    await loadOptions();
    $('ops-blocklist').click();
    await flush();
    expect($('block-hint').textContent).toMatch(/401/);
    expect($('block-hint').className).toMatch(/error/);
  });
});

describe('the search catalogue on the options page', () => {
  beforeEach(() => { mountOptions(); setupChrome(); });
  afterEach(() => { vi.restoreAllMocks(); });

  const box = (id) => document.getElementById(id);

  it('shows the delivered lists when nothing is stored', async () => {
    await loadOptions();
    expect(box('cat-cities').value.split('\n')).toEqual(globalThis.LC.DEFAULT_CITIES);
    expect(box('cat-direkt').value.split('\n').length).toBe(globalThis.LC.DEFAULT_TERMS.direkt.length);
  });

  it('saves what was typed, one term per line', async () => {
    await loadOptions();
    box('cat-direkt').value = 'CTO\nCIO';
    box('cat-cities').value = 'Berlin\nKöln';
    box('cat-save').click();
    await flush();
    expect(storage.lcTerms.direkt).toEqual(['CTO', 'CIO']);
    expect(storage.lcCities).toEqual(['Berlin', 'Köln']);
  });

  // A field that keeps showing what storage rejected is a lie about the state.
  it('writes back the cleaned lists so the fields match storage', async () => {
    await loadOptions();
    box('cat-direkt').value = '  CTO \n\n cto\nCIO';
    box('cat-save').click();
    await flush();
    expect(box('cat-direkt').value).toBe('CTO\nCIO');
  });

  it('restores the delivered lists', async () => {
    storage.lcTerms = { direkt: ['Nur eins'], branchen: [], multi: [] };
    await loadOptions();
    box('cat-reset').click();
    await flush();
    expect(storage.lcTerms.direkt).toEqual(globalThis.LC.DEFAULT_TERMS.direkt);
    expect(box('cat-direkt').value).toContain('Geschäftsführer');
  });

  it('lists the tally, most sent first', async () => {
    storage.lcStats = {
      'cto|berlin': { term: 'CTO', city: 'Berlin', n: 100, first: 1, last: 1757000000000 },
      'msp|hamburg': { term: 'MSP', city: 'Hamburg', n: 7, first: 1, last: 1757000000000 }
    };
    await loadOptions();
    const rows = Array.from(document.querySelectorAll('#cat-tally tr')).slice(1);
    expect(rows.map((r) => r.children[0].textContent)).toEqual(['CTO', 'MSP']);
    expect(rows[0].children[2].textContent).toBe('100');
  });

  it('shows a combination without a city as such', async () => {
    storage.lcStats = { 'x|': { term: 'Leiter Digitalisierung', city: '', n: 64, first: 1, last: 1 } };
    await loadOptions();
    expect(document.querySelector('#cat-tally tr:nth-child(2) td:nth-child(2)').textContent).toBe('—');
  });

  it('filters the tally', async () => {
    storage.lcStats = {
      'cto|berlin': { term: 'CTO', city: 'Berlin', n: 3, first: 1, last: 1 },
      'msp|hamburg': { term: 'MSP', city: 'Hamburg', n: 2, first: 1, last: 1 }
    };
    await loadOptions();
    const f = document.getElementById('cat-filter');
    f.value = 'hamburg';
    f.dispatchEvent(new Event('input'));
    const rows = Array.from(document.querySelectorAll('#cat-tally tr')).slice(1);
    expect(rows.map((r) => r.children[0].textContent)).toEqual(['MSP']);
  });

  it('needs two clicks to reset the tally, and writes it empty rather than absent', async () => {
    storage.lcStats = { 'cto|berlin': { term: 'CTO', city: 'Berlin', n: 3, first: 1, last: 1 } };
    await loadOptions();
    const btn = document.getElementById('cat-clear');
    btn.click();
    await flush();
    expect(storage.lcStats).not.toEqual({});     // first click only arms
    btn.click();
    await flush();
    // Empty, not deleted: "undefined" would make the content script seed it
    // from the log again and undo the reset.
    expect(storage.lcStats).toEqual({});
    expect(document.querySelector('#cat-tally .empty')).toBeTruthy();
  });

  it('reaches every element it addresses', async () => {
    const src = fs.readFileSync(path.resolve('options.js'), 'utf8');
    const ids = [...src.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]);
    mountOptions();
    for (const id of ids) expect(document.getElementById(id), id + ' missing in options.html').toBeTruthy();
  });
});

describe('what the options page says about the tally sync', () => {
  beforeEach(() => { mountOptions(); setupChrome(); storage.lcOps = { baseUrl: 'https://ops.celox.io', token: 'ops_' + 'x'.repeat(40) }; });
  afterEach(() => { vi.restoreAllMocks(); });

  it('reports what was delivered', async () => {
    storage.lcOpsLast = { at: Date.now(), sent: 1, created: 1, updated: 0, unchanged: 0, tally: { ok: true, sent: 4 } };
    await loadOptions();
    expect(document.getElementById('st-tally').textContent).toContain('4 combinations reported');
  });

  // An ops without the route is a state to name, not an error to hide.
  it('says plainly when this ops cannot take the tally', async () => {
    storage.lcOpsLast = { at: Date.now(), sent: 0, created: 0, updated: 0, unchanged: 0, tally: { ok: false, unsupported: true } };
    await loadOptions();
    const el = document.getElementById('st-tally');
    expect(el.textContent).toContain('does not take the tally yet');
    expect(el.className).not.toContain('error');   // not a fault
  });

  it('marks a real delivery failure as an error', async () => {
    storage.lcOpsLast = { at: Date.now(), sent: 0, created: 0, updated: 0, unchanged: 0, tally: { ok: false, error: 'ops answered 500' } };
    await loadOptions();
    expect(document.getElementById('st-tally').className).toContain('error');
  });

  it('mentions an ops that does not read position and city', async () => {
    storage.lcOpsCaps = { searchFields: false, at: 1 };
    await loadOptions();
    expect(document.getElementById('st-tally').textContent).toContain('position and city');
  });

  it('stays empty when there is nothing to report', async () => {
    await loadOptions();
    expect(document.getElementById('st-tally').textContent).toBe('');
  });
});

