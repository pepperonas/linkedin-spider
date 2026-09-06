import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

await import('../lib.js');

const HTML = fs.readFileSync(path.resolve('popup.html'), 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(path.resolve('manifest.json'), 'utf8'));

let storage;
let sentMessages;
let downloadCalls;
let readerText;

function mountPopup() {
  const body = HTML.match(/<body>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '');
  document.body.innerHTML = body;
}

function setupChrome() {
  storage = {};
  sentMessages = [];
  downloadCalls = [];
  globalThis.chrome = {
    runtime: { lastError: null, getManifest: () => MANIFEST },
    storage: {
      local: {
        get(keys, cb) {
          const out = {};
          for (const k of keys) if (k in storage) out[k] = storage[k];
          cb(out);
        },
        set(obj, cb) { Object.assign(storage, obj); if (cb) cb(); }
      }
    },
    tabs: {
      query(_o, cb) { cb([{ id: 1 }]); },
      sendMessage(_id, msg, cb) {
        sentMessages.push(msg);
        if (cb) cb(msg.action === 'getStatus' ? { active: false, count: 3, healed: false } : { ok: true });
      }
    },
    downloads: {
      download(opts, cb) { downloadCalls.push(opts); cb(11); }
    }
  };
}

// Deterministic stand-in for the browser's async FileReader: the popup's own
// wiring (change -> read -> parse -> arm) is what these tests are about.
class SyncFileReader {
  readAsText() {
    if (readerText === undefined) { if (this.onerror) this.onerror(); return; }
    this.result = readerText;
    if (this.onload) this.onload();
  }
}

function pickFile(text) {
  readerText = text;
  const input = document.getElementById('restoreFile');
  Object.defineProperty(input, 'files', { value: [{ name: 'b.json' }], configurable: true });
  input.dispatchEvent(new Event('change'));
}

async function loadPopup() {
  vi.resetModules();
  await import('../popup.js');
}

const daysAgo = (n, h = 12) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(h, 0, 0, 0);
  return d.getTime();
};

const contact = {
  ts: new Date().toISOString(), name: 'Max Mustermann',
  profileUrl: 'https://www.linkedin.com/in/max-m', headline: 'Dev bei Acme',
  company: 'Acme', location: 'Berlin', degree: '2.', profileId: 'ACoAAB1',
  method: 'api', pageUrl: 'https://www.linkedin.com/search/results/people/'
};

describe('popup: weekly quota', () => {
  beforeEach(() => { vi.useFakeTimers(); mountPopup(); setupChrome(); readerText = null; globalThis.FileReader = SyncFileReader; });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('shows the free allowance even with nothing sent yet', async () => {
    await loadPopup();
    expect(document.getElementById('quota-used').textContent).toBe('0');
    expect(document.getElementById('quota-limit').textContent).toBe('200');
    expect(document.getElementById('quota-fill').style.width).toBe('0%');
  });

  it('counts this week and names what is left', async () => {
    // Today is always inside the current calendar week.
    storage.lcEvents = [daysAgo(0, 9), daysAgo(0, 10)];
    await loadPopup();
    expect(document.getElementById('quota-used').textContent).toBe('2');
    expect(document.getElementById('quota-sub').textContent).toContain('198 left this week');
    expect(document.getElementById('quota-sub').textContent).toContain('resets');
  });

  it('warns as the allowance runs out and flags it when it is gone', async () => {
    storage.lcEvents = Array.from({ length: 170 }, () => daysAgo(0));
    await loadPopup();
    expect(document.getElementById('quota-panel').className).toContain('warn');

    document.body.innerHTML = '';
    mountPopup(); setupChrome();
    storage.lcEvents = Array.from({ length: 200 }, () => daysAgo(0));
    await loadPopup();
    expect(document.getElementById('quota-panel').className).toContain('over');
    expect(document.getElementById('quota-sub').textContent).toContain('0 left this week');
  });

  it('reports the rolling 7-day count next to the calendar week', async () => {
    storage.lcEvents = [daysAgo(0)];
    await loadPopup();
    expect(document.getElementById('quota-sub').textContent).toMatch(/in the last 7 days/);
  });
});

describe('popup: activity chart', () => {
  beforeEach(() => { vi.useFakeTimers(); mountPopup(); setupChrome(); readerText = null; globalThis.FileReader = SyncFileReader; });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('offers every period as a chip and marks the active one', async () => {
    await loadPopup();
    const chips = [...document.querySelectorAll('#ranges .chip')];
    expect(chips.map((c) => c.dataset.range)).toEqual(['7d', '30d', '90d', '1y']);
    expect(chips.filter((c) => c.classList.contains('active')).length).toBe(1);
    expect(chips[0].classList.contains('active')).toBe(true);
  });

  it('draws bars for the stored requests', async () => {
    storage.lcEvents = [daysAgo(0), daysAgo(1), daysAgo(1)];
    await loadPopup();
    const svg = document.querySelector('#chart svg');
    expect(svg).not.toBeNull();
    expect(svg.querySelectorAll('rect.lc-bar').length).toBe(7);
    expect(document.getElementById('range-total').textContent).toMatch(/^3 in 7 d/);
  });

  it('switching the period redraws and remembers the choice', async () => {
    storage.lcEvents = [daysAgo(20)];
    await loadPopup();
    expect(document.getElementById('range-total').textContent).toMatch(/^0 in 7 d/);

    document.querySelector('.chip[data-range="30d"]').click();
    expect(storage.lcRange).toBe('30d');
    expect(document.getElementById('range-total').textContent).toMatch(/^1 in 30 d/);
    expect(document.querySelector('.chip[data-range="30d"]').classList.contains('active')).toBe(true);
    expect(document.querySelector('.chip[data-range="7d"]').classList.contains('active')).toBe(false);
    expect(document.querySelectorAll('#chart rect.lc-bar').length).toBe(30);
  });

  it('restores the period chosen last time', async () => {
    storage.lcRange = '1y';
    await loadPopup();
    expect(document.querySelector('.chip[data-range="1y"]').classList.contains('active')).toBe(true);
  });

  it('does not redraw the chart on every status poll', async () => {
    storage.lcEvents = [daysAgo(0)];
    await loadPopup();
    const first = document.querySelector('#chart svg');
    await vi.advanceTimersByTimeAsync(3200);
    expect(document.querySelector('#chart svg')).toBe(first);
  });

  it('does redraw once a new request lands', async () => {
    storage.lcEvents = [daysAgo(0)];
    await loadPopup();
    const first = document.querySelector('#chart svg');
    storage.lcEvents = [daysAgo(0), Date.now()];
    await vi.advanceTimersByTimeAsync(1100);
    expect(document.querySelector('#chart svg')).not.toBe(first);
  });
});

describe('popup: report export', () => {
  beforeEach(() => { vi.useFakeTimers(); mountPopup(); setupChrome(); readerText = null; globalThis.FileReader = SyncFileReader; });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('stays disabled while there is nothing to report', async () => {
    await loadPopup();
    expect(document.getElementById('report').disabled).toBe(true);
  });

  it('writes a self-contained HTML report carrying the chart', async () => {
    storage.lcLog = [contact];
    storage.lcEvents = [daysAgo(0)];
    await loadPopup();
    document.getElementById('report').click();

    expect(downloadCalls.length).toBe(1);
    expect(downloadCalls[0].filename).toMatch(/^linkedin-spider-report-\d{4}-\d{2}-\d{2}_\d{4}\.html$/);
    const html = decodeURIComponent(downloadCalls[0].url.replace(/^data:text\/html;charset=utf-8,/, ''));
    expect(html).toContain('<svg');
    expect(html).toContain('lc-bar');
    expect(html).toContain('Max Mustermann');
    expect(html).toContain('Weekly quota');
    expect(html).not.toMatch(/<script|https?:\/\/cdn/i);
  });

  it('reports on the period the user is looking at', async () => {
    storage.lcEvents = [daysAgo(200)];
    storage.lcLog = [contact];
    await loadPopup();
    document.querySelector('.chip[data-range="1y"]').click();
    document.getElementById('report').click();
    const html = decodeURIComponent(downloadCalls[0].url.split(',').slice(1).join(','));
    expect(html).toContain('1 request in this period');
  });
});

describe('popup: backup and restore', () => {
  beforeEach(() => { vi.useFakeTimers(); mountPopup(); setupChrome(); readerText = null; globalThis.FileReader = SyncFileReader; });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('writes a dated JSON backup of every stored value', async () => {
    storage.lcLog = [contact];
    storage.lcEvents = [daysAgo(0)];
    storage.lcCount = 7;
    await loadPopup();
    document.getElementById('backup').click();

    expect(downloadCalls[0].filename).toMatch(/^linkedin-spider-backup-\d{4}-\d{2}-\d{2}_\d{4}\.json$/);
    const json = JSON.parse(decodeURIComponent(downloadCalls[0].url.split(',').slice(1).join(',')));
    expect(json.app).toBe('linkedin-spider');
    expect(json.version).toBe(MANIFEST.version);
    expect(json.data.lcCount).toBe(7);
    expect(json.data.lcLog).toHaveLength(1);
    expect(json.data.lcEvents).toHaveLength(1);
  });

  it('round-trips: backup, wipe, restore', async () => {
    storage.lcLog = [contact];
    storage.lcEvents = [daysAgo(0)];
    storage.lcCount = 7;
    await loadPopup();
    document.getElementById('backup').click();
    const file = decodeURIComponent(downloadCalls[0].url.split(',').slice(1).join(','));

    // fresh popup over empty storage
    document.body.innerHTML = ''; mountPopup(); setupChrome();
    await loadPopup();
    expect(document.getElementById('logged').textContent).toBe('0');

    const restore = document.getElementById('restore');
    restore.click();               // opens the file picker
    pickFile(file);                // user picks the backup
    expect(storage.lcLog).toBeUndefined(); // nothing written yet — armed only
    expect(restore.textContent).toMatch(/1/);

    restore.click();               // confirm
    expect(storage.lcLog).toHaveLength(1);
    expect(storage.lcEvents).toHaveLength(1);
    expect(storage.lcCount).toBe(7);
    expect(document.getElementById('logged').textContent).toBe('1');
    expect(document.getElementById('quota-used').textContent).toBe('1');
  });

  it('rejects a foreign JSON file without touching the stored data', async () => {
    storage.lcLog = [contact];
    storage.lcEvents = [daysAgo(0)];
    await loadPopup();
    document.getElementById('restore').click();
    pickFile(JSON.stringify({ hello: 'world', data: { lcLog: [] } }));

    expect(storage.lcLog).toHaveLength(1);
    expect(document.getElementById('hint').textContent).toMatch(/not a linkedin spider backup/i);
    expect(document.getElementById('restore').textContent).not.toMatch(/overwrite/i);
  });

  it('rejects a damaged file without touching the stored data', async () => {
    storage.lcLog = [contact];
    await loadPopup();
    document.getElementById('restore').click();
    pickFile('{ this is not json');

    expect(storage.lcLog).toHaveLength(1);
    expect(document.getElementById('hint').textContent).toMatch(/not a valid json/i);
  });

  it('never resumes sending off the back of a restore', async () => {
    await loadPopup();
    const backup = JSON.stringify({
      app: 'linkedin-spider', type: 'backup', schema: 1, version: '2.9.0',
      exportedAt: new Date().toISOString(),
      data: { lcEnabled: true, lcCount: 1, lcLog: [], lcEvents: [], lcRecipe: null, lcRange: '7d' }
    });
    document.getElementById('restore').click();
    pickFile(backup);
    document.getElementById('restore').click();

    expect(storage.lcEnabled).toBe(false);
    expect(document.getElementById('toggle').checked).toBe(false);
  });

  it('tells the open tab to reload its state after a restore', async () => {
    await loadPopup();
    const backup = JSON.stringify({
      app: 'linkedin-spider', type: 'backup', schema: 1, version: '2.9.0',
      exportedAt: new Date().toISOString(),
      data: { lcCount: 4, lcLog: [], lcEvents: [], lcRecipe: null, lcRange: '7d' }
    });
    document.getElementById('restore').click();
    pickFile(backup);
    document.getElementById('restore').click();
    expect(sentMessages.some((m) => m.action === 'reloadState')).toBe(true);
  });
});

describe('popup: unreachable tab', () => {
  beforeEach(() => { vi.useFakeTimers(); mountPopup(); setupChrome(); readerText = null; globalThis.FileReader = SyncFileReader; });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  // No content script in the tab: either it is not a LinkedIn page, or the
  // extension was reloaded and the page was not. Saying "Paused" is a lie.
  function silentTab() {
    chrome.tabs.sendMessage = (_id, msg, cb) => {
      sentMessages.push(msg);
      chrome.runtime.lastError = { message: 'Could not establish connection.' };
      if (cb) cb(undefined);
      chrome.runtime.lastError = null;
    };
  }

  it('tells the user to reload the tab instead of showing "Paused"', async () => {
    silentTab();
    await loadPopup();
    await vi.advanceTimersByTimeAsync(3500);
    const status = document.getElementById('status');
    expect(status.textContent).toMatch(/reload/i);
    expect(status.className).toMatch(/warn/);
  });

  it('says the same when the tab answers but has given up', async () => {
    chrome.tabs.sendMessage = (_id, msg, cb) => {
      sentMessages.push(msg);
      if (cb) cb(msg.action === 'getStatus'
        ? { active: false, count: 0, healed: false, contextGone: true } : { ok: true });
    };
    await loadPopup();
    await vi.advanceTimersByTimeAsync(3500);
    expect(document.getElementById('status').textContent).toMatch(/reload/i);
  });

  it('stops hammering a tab that does not answer', async () => {
    silentTab();
    await loadPopup();
    await vi.advanceTimersByTimeAsync(3500);
    const afterWarning = sentMessages.length;
    await vi.advanceTimersByTimeAsync(4000);
    // backed off — a 1s poll would have added four more round-trips
    expect(sentMessages.length - afterWarning).toBeLessThanOrEqual(1);
  });

  it('recovers on its own once the tab answers again', async () => {
    silentTab();
    await loadPopup();
    await vi.advanceTimersByTimeAsync(3500);
    expect(document.getElementById('status').textContent).toMatch(/reload/i);

    chrome.tabs.sendMessage = (_id, msg, cb) => {
      sentMessages.push(msg);
      if (cb) cb(msg.action === 'getStatus' ? { active: true, count: 5, healed: false } : { ok: true });
    };
    await vi.advanceTimersByTimeAsync(6000);
    expect(document.getElementById('status').textContent).toBe('Active');
    expect(document.getElementById('counter').textContent).toBe('5');
  });

  it('keeps quota and chart working while the tab is unreachable', async () => {
    // They come from storage, not from the tab — the popup must still be useful.
    storage.lcEvents = [daysAgo(0), daysAgo(0)];
    storage.lcLog = [contact];
    silentTab();
    await loadPopup();
    await vi.advanceTimersByTimeAsync(3500);
    expect(document.getElementById('quota-used').textContent).toBe('2');
    expect(document.querySelectorAll('#chart rect.lc-bar').length).toBe(7);
    expect(document.getElementById('export').disabled).toBe(false);
  });

  it('does not pretend a toggle worked when nothing received it', async () => {
    silentTab();
    await loadPopup();
    document.getElementById('toggle').checked = true;
    document.getElementById('toggle').dispatchEvent(new Event('change'));
    await vi.advanceTimersByTimeAsync(50);
    expect(document.getElementById('hint').textContent).toMatch(/reload/i);
  });
});

describe('popup: ops sync row', () => {
  let workerMessages, workerReply;
  beforeEach(() => {
    vi.useFakeTimers(); mountPopup(); setupChrome(); readerText = null; globalThis.FileReader = SyncFileReader;
    workerMessages = []; workerReply = { ok: true, summary: { sent: 2, created: 2, updated: 0, unchanged: 0 } };
    chrome.runtime.sendMessage = (msg, cb) => { workerMessages.push(msg); if (cb) cb(workerReply); };
    chrome.runtime.openOptionsPage = vi.fn();
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  const TOKEN = 'ops_' + 'p'.repeat(40);
  const rec = (id) => ({ ...contact, profileId: id, profileUrl: 'https://www.linkedin.com/in/' + id });

  it('says so when ops is not set up, and keeps Sync disabled', async () => {
    storage.lcLog = [rec('A')];
    await loadPopup();
    expect(document.getElementById('ops-status').textContent).toMatch(/not set up/);
    expect(document.getElementById('ops-sync').disabled).toBe(true);
  });

  it('counts what is still pending', async () => {
    storage.lcOps = { baseUrl: 'https://ops.celox.io', token: TOKEN };
    storage.lcLog = [rec('A'), rec('B'), rec('C')];
    storage.lcOpsState = { A: { status: 'ok', v: globalThis.LC.OPS_ROW_VERSION } };
    await loadPopup();
    const st = document.getElementById('ops-status');
    expect(st.textContent).toBe('ops: 2 pending · 1 synced');
    expect(st.className).toMatch(/pending/);
    expect(document.getElementById('ops-sync').disabled).toBe(false);
  });

  it('reports all synced and disables the button when nothing is pending', async () => {
    storage.lcOps = { baseUrl: 'https://ops.celox.io', token: TOKEN };
    storage.lcLog = [rec('A')];
    storage.lcOpsState = { A: { status: 'ok', v: globalThis.LC.OPS_ROW_VERSION } };
    await loadPopup();
    expect(document.getElementById('ops-status').textContent).toBe('ops: all synced (1)');
    expect(document.getElementById('ops-sync').disabled).toBe(true);
  });

  it('surfaces the last error instead of hiding it', async () => {
    storage.lcOps = { baseUrl: 'https://ops.celox.io', token: TOKEN };
    storage.lcLog = [rec('A')];
    storage.lcOpsLast = { at: 1, error: 'ops answered 401: API-Token ungültig oder widerrufen' };
    await loadPopup();
    const st = document.getElementById('ops-status');
    expect(st.textContent).toMatch(/401/);
    expect(st.className).toMatch(/error/);
  });

  it('Sync asks the worker, then re-reads the state', async () => {
    storage.lcOps = { baseUrl: 'https://ops.celox.io', token: TOKEN };
    storage.lcLog = [rec('A'), rec('B')];
    await loadPopup();
    workerReply = (() => { storage.lcOpsState = { A: { status: 'ok', v: globalThis.LC.OPS_ROW_VERSION }, B: { status: 'ok', v: globalThis.LC.OPS_ROW_VERSION } }; return { ok: true, summary: { sent: 2, created: 2, updated: 0, unchanged: 0 } }; })();
    document.getElementById('ops-sync').click();
    await vi.advanceTimersByTimeAsync(10);
    expect(workerMessages.some((m) => m.action === 'opsSync')).toBe(true);
    expect(document.getElementById('hint').textContent).toMatch(/2 sent/);
    expect(document.getElementById('ops-status').textContent).toBe('ops: all synced (2)');
  });

  it('tells how many profiles ops has closed — in the tooltip, the row stays one line', async () => {
    storage.lcOps = { baseUrl: 'https://ops.celox.io', token: TOKEN };
    storage.lcLog = [rec('A')];
    storage.lcOpsState = { A: { status: 'ok', v: globalThis.LC.OPS_ROW_VERSION } };
    storage.lcBlock = { at: new Date(2026, 8, 3, 14, 5).getTime(), norms: ['linkedin.com/in/x', 'linkedin.com/in/y'], count: 2 };
    await loadPopup();
    const st = document.getElementById('ops-status');
    expect(st.textContent).toBe('ops: all synced (1)');          // unchanged
    expect(st.title).toMatch(/do-not-contact.*2 profiles/);
    expect(st.title).toMatch(/14:05/);
  });

  it('shows how many cards the tab skipped for ops', async () => {
    chrome.tabs.sendMessage = (_id, msg, cb) => { sentMessages.push(msg); if (cb) cb(msg.action === 'getStatus'
      ? { active: true, count: 7, healed: false, contextGone: false, halted: null, paused: null, blocked: 3 } : { ok: true }); };
    storage.lcOps = { baseUrl: 'https://ops.celox.io', token: TOKEN };
    storage.lcLog = [rec('A')];
    storage.lcOpsState = { A: { status: 'ok', v: globalThis.LC.OPS_ROW_VERSION } };
    await loadPopup();
    await vi.advanceTimersByTimeAsync(1100);
    expect(document.getElementById('ops-status').textContent).toBe('ops: all synced (1) · 3 skipped');
  });

  it('never sends the token to the tab — only storage and the worker see it', async () => {
    storage.lcOps = { baseUrl: 'https://ops.celox.io', token: TOKEN };
    storage.lcLog = [rec('A')];
    await loadPopup();
    document.getElementById('ops-sync').click();
    await vi.advanceTimersByTimeAsync(10);
    expect(JSON.stringify(sentMessages)).not.toContain(TOKEN);   // tabs.sendMessage traffic
  });

  it('the gear opens the options page', async () => {
    await loadPopup();
    document.getElementById('ops-settings').click();
    expect(chrome.runtime.openOptionsPage).toHaveBeenCalled();
  });
});

describe('popup: update notice + halt + hints', () => {
  beforeEach(() => { vi.useFakeTimers(); mountPopup(); setupChrome(); readerText = null; globalThis.FileReader = SyncFileReader; });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('turns the footer version into a link when a newer release is known', async () => {
    storage.lcUpdate = { checkedAt: 1, installed: MANIFEST.version, latest: '9.9.9', available: true, url: 'https://github.com/pepperonas/linkedin-spider/releases/tag/v9.9.9' };
    await loadPopup();
    const v = document.getElementById('version');
    expect(v.textContent).toMatch(/9\.9\.9/);
    const a = v.querySelector('a');
    expect(a.getAttribute('href')).toMatch(/v9\.9\.9$/);
    expect(a.getAttribute('target')).toBe('_blank');
  });

  it('shows only the plain version when up to date or unknown', async () => {
    storage.lcUpdate = { checkedAt: 1, installed: MANIFEST.version, latest: MANIFEST.version, available: false, url: 'x' };
    await loadPopup();
    expect(document.getElementById('version').textContent).toBe('v' + MANIFEST.version);
    expect(document.getElementById('version').querySelector('a')).toBe(null);
  });

  it('shows the circuit-breaker halt instead of "Paused"', async () => {
    chrome.tabs.sendMessage = (_id, msg, cb) => { sentMessages.push(msg); if (cb) cb(msg.action === 'getStatus'
      ? { active: false, count: 7, healed: false, contextGone: false, halted: '5 failures in a row (weekly limit reached?)' } : { ok: true }); };
    await loadPopup();
    await vi.advanceTimersByTimeAsync(1100);
    const st = document.getElementById('status');
    expect(st.textContent).toMatch(/stopped/i);
    expect(st.textContent).toMatch(/5 failures/);
    expect(st.className).toMatch(/warn/);
  });

  it('shows a pace pause as "Active · paused" with the reason and resume time', async () => {
    const resumeAt = new Date(2026, 8, 3, 15, 40).getTime();
    chrome.tabs.sendMessage = (_id, msg, cb) => { sentMessages.push(msg); if (cb) cb(msg.action === 'getStatus'
      ? { active: true, count: 7, healed: false, contextGone: false, halted: null, paused: { reason: 'hour', resumeAt } } : { ok: true }); };
    await loadPopup();
    await vi.advanceTimersByTimeAsync(1100);
    const st = document.getElementById('status');
    expect(st.textContent).toMatch(/hourly cap/);
    expect(st.textContent).toMatch(/15:40/);
    expect(st.className).toMatch(/active/);          // the run is on, just waiting
    expect(document.getElementById('toggle').checked).toBe(true);
  });

  it('names the daily cap and the weekly stop differently', async () => {
    const day = new Date(2026, 8, 4, 0, 0).getTime();
    const week = new Date(2026, 8, 7, 0, 0).getTime();
    let paused = { reason: 'day', resumeAt: day };
    chrome.tabs.sendMessage = (_id, msg, cb) => { sentMessages.push(msg); if (cb) cb(msg.action === 'getStatus'
      ? { active: true, count: 7, healed: false, contextGone: false, halted: null, paused } : { ok: true }); };
    await loadPopup();
    await vi.advanceTimersByTimeAsync(1100);
    expect(document.getElementById('status').textContent).toMatch(/daily cap.*00:00/);
    paused = { reason: 'quota', resumeAt: week };
    await vi.advanceTimersByTimeAsync(1100);
    expect(document.getElementById('status').textContent).toMatch(/weekly stop.*07\.09\./);
    paused = null;
    await vi.advanceTimersByTimeAsync(1100);
    expect(document.getElementById('status').textContent).toBe('Active');
  });

  it('tells where the history starts when it is younger than the period', async () => {
    storage.lcEvents = [daysAgo(1), daysAgo(0)];
    await loadPopup();
    document.querySelector('.chip[data-range="30d"]').click();
    expect(document.getElementById('range-total').textContent).toMatch(/since/);
    storage.lcEvents = Array.from({ length: 40 }, (_, i) => daysAgo(i));
    await vi.advanceTimersByTimeAsync(1100);
    expect(document.getElementById('range-total').textContent).not.toMatch(/since/);
  });

  it('explains the two figures on hover', async () => {
    await loadPopup();
    expect(document.getElementById('counter').closest('.stat').getAttribute('title')).toMatch(/install/i);
    expect(document.getElementById('logged').closest('.stat').getAttribute('title')).toMatch(/2\.8\.0/);
  });
});

describe('popup: footer', () => {
  beforeEach(() => { vi.useFakeTimers(); mountPopup(); setupChrome(); readerText = null; globalThis.FileReader = SyncFileReader; });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('shows the extension version from the manifest', async () => {
    await loadPopup();
    expect(document.getElementById('version').textContent).toBe('v' + MANIFEST.version);
  });

  it('links to celox.io, the Google Maps review page and a PayPal donation', async () => {
    await loadPopup();
    expect(document.getElementById('link-celox').getAttribute('href')).toBe('https://celox.io');
    expect(document.getElementById('link-review').getAttribute('href'))
      .toBe('https://g.page/r/CXgdRV3QysvxEBM/review');
    const donate = document.getElementById('link-donate').getAttribute('href');
    expect(donate).toContain('paypal.com');
    expect(donate).toContain('martin.pfeffer@celox.io');
  });

  it('opens every footer link in a new tab, safely', async () => {
    await loadPopup();
    for (const id of ['link-celox', 'link-review', 'link-donate']) {
      const a = document.getElementById(id);
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toContain('noopener');
    }
  });
});
