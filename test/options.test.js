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
    storage.lcOpsState = { A: { status: 'ok' }, B: { status: 'ok' }, C: { status: 'invalid' } };
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
    storage.lcOpsState = { A: { status: 'ok' } };
    storage.lcOpsLast = { at: 1, sent: 1 };
    await loadOptions();
    $('ops-forget').click();
    await flush();
    expect(storage.lcOpsState).toEqual({ A: { status: 'ok' } });   // armed only
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
