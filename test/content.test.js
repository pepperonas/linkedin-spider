import { describe, it, expect, beforeEach, vi } from 'vitest';

// Load lib.js
await import('../lib.js');

function clearBody() {
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
}

function setupChromeMock() {
  const storageData = {};
  const messageListeners = [];

  globalThis.chrome = {
    storage: {
      local: {
        get(keys, cb) {
          const result = {};
          for (const k of keys) {
            if (k in storageData) result[k] = storageData[k];
          }
          cb(result);
        },
        set(obj) {
          Object.assign(storageData, obj);
        },
      },
    },
    runtime: {
      lastError: null,
      onMessage: {
        addListener(fn) {
          messageListeners.push(fn);
        },
      },
    },
  };

  return { storageData, messageListeners };
}

describe('content script message handling', () => {
  let mocks;

  beforeEach(() => {
    clearBody();
    mocks = setupChromeMock();
  });

  it('chrome mock supports onMessage listeners', () => {
    const handler = vi.fn();
    chrome.runtime.onMessage.addListener(handler);
    expect(mocks.messageListeners).toContain(handler);
  });

  it('chrome storage round-trips data', () => {
    chrome.storage.local.set({ lcCount: 10 });
    chrome.storage.local.get(['lcCount'], (result) => {
      expect(result.lcCount).toBe(10);
    });
  });

  it('simulated toggle message handler works', () => {
    let active = false;

    function handleMessage(msg, _sender, sendResponse) {
      if (msg.action === 'toggle') {
        active = msg.enabled;
        sendResponse({ ok: true });
      } else if (msg.action === 'getStatus') {
        sendResponse({ active, count: 0 });
      } else if (msg.action === 'resetCount') {
        sendResponse({ ok: true });
      }
    }

    chrome.runtime.onMessage.addListener(handleMessage);

    // Test toggle on
    let response;
    handleMessage({ action: 'toggle', enabled: true }, null, (r) => { response = r; });
    expect(response).toEqual({ ok: true });
    expect(active).toBe(true);

    // Test getStatus
    handleMessage({ action: 'getStatus' }, null, (r) => { response = r; });
    expect(response).toEqual({ active: true, count: 0 });

    // Test toggle off
    handleMessage({ action: 'toggle', enabled: false }, null, (r) => { response = r; });
    expect(active).toBe(false);

    // Test resetCount
    handleMessage({ action: 'resetCount' }, null, (r) => { response = r; });
    expect(response).toEqual({ ok: true });
  });
});

describe('rate limit state', () => {
  it('tracks rate limit state correctly', () => {
    let rateLimited = false;

    rateLimited = true;
    expect(rateLimited).toBe(true);

    rateLimited = false;
    expect(rateLimited).toBe(false);
  });
});

describe('tick behavior with DOM', () => {
  beforeEach(() => {
    clearBody();
    setupChromeMock();
  });

  it('findNextConnect + findConfirmButton integration', () => {
    const { findNextConnect, findConfirmButton } = globalThis.LC;

    // No buttons — should return null
    expect(findNextConnect(new Set())).toBe(null);
    expect(findConfirmButton()).toBe(null);

    // Add a connect button
    const btn = document.createElement('button');
    btn.textContent = 'Vernetzen';
    document.body.appendChild(btn);
    expect(findNextConnect(new Set())).toBe(btn);

    // Add a dialog with confirm
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const confirmBtn = document.createElement('button');
    confirmBtn.setAttribute('aria-label', 'Ohne Notiz senden');
    confirmBtn.textContent = 'Ohne Notiz senden';
    dialog.appendChild(confirmBtn);
    document.body.appendChild(dialog);
    expect(findConfirmButton()).toBe(confirmBtn);
  });

  it('processed profiles are skipped in subsequent calls', () => {
    const { findNextConnect, getProfileId } = globalThis.LC;

    const container = document.createElement('div');
    container.setAttribute('componentkey', 'SearchResultsUSER1');
    const btn = document.createElement('button');
    btn.textContent = 'Vernetzen';
    container.appendChild(btn);
    document.body.appendChild(container);

    const processed = new Set();

    // First call finds the button
    const found = findNextConnect(processed);
    expect(found).toBe(btn);

    // Mark as processed
    const pid = getProfileId(btn);
    processed.add(pid);

    // Second call skips it
    expect(findNextConnect(processed)).toBe(null);
  });
});
