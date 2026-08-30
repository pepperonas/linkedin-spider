import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

await import('../lib.js');

const HTML = fs.readFileSync(path.resolve('popup.html'), 'utf8');

let storage;
let sentMessages;
let downloadCalls;
let downloadBehaviour;
let anchorClicks;

function mountPopup() {
  const body = HTML.match(/<body>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '');
  document.body.innerHTML = body;
}

function setupChrome() {
  storage = {};
  sentMessages = [];
  downloadCalls = [];
  downloadBehaviour = { id: 7 };

  globalThis.chrome = {
    runtime: { lastError: null },
    storage: {
      local: {
        get(keys, cb) {
          const out = {};
          for (const k of keys) if (k in storage) out[k] = storage[k];
          cb(out);
        },
        set(obj, cb) {
          Object.assign(storage, obj);
          if (cb) cb();
        }
      }
    },
    tabs: {
      query(_opts, cb) { cb([{ id: 1 }]); },
      sendMessage(_tabId, msg, cb) {
        sentMessages.push(msg);
        if (cb) cb(msg.action === 'getStatus' ? { active: false, count: 0, healed: false } : { ok: true });
      }
    },
    downloads: {
      download(opts, cb) {
        downloadCalls.push(opts);
        chrome.runtime.lastError = downloadBehaviour.error || null;
        cb(downloadBehaviour.error ? undefined : downloadBehaviour.id);
        chrome.runtime.lastError = null;
      }
    }
  };
}

async function loadPopup() {
  vi.resetModules();
  await import('../popup.js');
}

const contact = {
  ts: '2026-08-30T10:00:00.000Z', name: 'Max Mustermann',
  profileUrl: 'https://www.linkedin.com/in/max-m', headline: 'Dev bei Acme',
  company: 'Acme', location: 'Berlin', degree: '2.', profileId: 'ACoAAB1',
  method: 'api', pageUrl: 'https://www.linkedin.com/search/results/people/'
};

describe('popup export', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mountPopup();
    setupChrome();
    anchorClicks = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
      anchorClicks.push({ href: this.getAttribute('href'), download: this.getAttribute('download') });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('popup.html loads lib.js before popup.js', () => {
    const libAt = HTML.indexOf('src="lib.js"');
    const popupAt = HTML.indexOf('src="popup.js"');
    expect(libAt).toBeGreaterThan(-1);
    expect(libAt).toBeLessThan(popupAt);
  });

  it('keeps export and clear disabled while nothing has been sent', async () => {
    await loadPopup();
    expect(document.getElementById('export').disabled).toBe(true);
    expect(document.getElementById('clearLog').disabled).toBe(true);
    expect(document.getElementById('logged').textContent).toBe('0');
  });

  it('shows the stored contact count and enables the buttons', async () => {
    storage.lcLog = [contact, { ...contact, profileId: 'B' }];
    await loadPopup();
    expect(document.getElementById('logged').textContent).toBe('2');
    expect(document.getElementById('export').disabled).toBe(false);
  });

  it('downloads a CSV containing the stored contact, with a dated filename', async () => {
    storage.lcLog = [contact];
    await loadPopup();
    document.getElementById('export').click();

    expect(downloadCalls.length).toBe(1);
    const call = downloadCalls[0];
    expect(call.saveAs).toBe(true);
    expect(call.filename).toMatch(/^linkedin-spider-anfragen-\d{4}-\d{2}-\d{2}_\d{4}\.csv$/);
    expect(call.url.startsWith('data:text/csv;charset=utf-8,')).toBe(true);

    const csv = decodeURIComponent(call.url.slice('data:text/csv;charset=utf-8,'.length));
    expect(csv).toContain('"Profil-URL"');
    expect(csv).toContain('"Max Mustermann"');
    expect(csv).toContain('"https://www.linkedin.com/in/max-m"');
    expect(csv).toContain('"Acme"');
  });

  it('exports the whole log, not just the newest entry', async () => {
    storage.lcLog = [contact, { ...contact, profileId: 'B', name: 'Erika Muster' }];
    await loadPopup();
    document.getElementById('export').click();

    const csv = decodeURIComponent(downloadCalls[0].url.split(',').slice(1).join(','));
    expect(csv).toContain('"Max Mustermann"');
    expect(csv).toContain('"Erika Muster"');
  });

  it('does NOT write the file anyway when the user cancels the save dialog', async () => {
    storage.lcLog = [contact];
    downloadBehaviour = { error: { message: 'USER_CANCELED' } };
    await loadPopup();
    document.getElementById('export').click();

    expect(anchorClicks).toEqual([]);
    expect(document.getElementById('hint').textContent).toMatch(/cancel/i);
  });

  it('falls back to an anchor download when the downloads API fails', async () => {
    storage.lcLog = [contact];
    downloadBehaviour = { error: { message: 'Invalid URL' } };
    await loadPopup();
    document.getElementById('export').click();

    expect(anchorClicks.length).toBe(1);
    expect(anchorClicks[0].download).toMatch(/^linkedin-spider-anfragen-/);
    expect(anchorClicks[0].href.startsWith('data:text/csv')).toBe(true);
  });

  it('clears the log only on the second click', async () => {
    storage.lcLog = [contact];
    await loadPopup();
    const clear = document.getElementById('clearLog');

    clear.click();
    expect(storage.lcLog.length).toBe(1);
    expect(clear.textContent).toMatch(/1/);

    clear.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(storage.lcLog).toEqual([]);
    expect(document.getElementById('logged').textContent).toBe('0');
  });

  it('tells the open tab to drop its skip list when the log is cleared', async () => {
    storage.lcLog = [contact];
    await loadPopup();
    const clear = document.getElementById('clearLog');
    clear.click();
    clear.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(sentMessages.some((m) => m.action === 'clearLog')).toBe(true);
  });

  it('reads the log from storage, never through the content script', async () => {
    storage.lcLog = [contact];
    await loadPopup();
    expect(sentMessages.some((m) => m.action === 'getLog')).toBe(false);
    expect(document.getElementById('logged').textContent).toBe('1');
  });
});
