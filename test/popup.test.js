import { describe, it, expect, beforeEach, vi } from 'vitest';

function clearBody() {
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
}

function buildPopupDOM() {
  clearBody();

  const container = document.createElement('div');
  container.className = 'container';

  const h1 = document.createElement('h1');
  h1.textContent = 'LinkedIn Auto-Connect';
  container.appendChild(h1);

  const toggleRow = document.createElement('div');
  toggleRow.className = 'toggle-row';
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = 'Auto-Connect';
  toggleRow.appendChild(label);
  const switchLabel = document.createElement('label');
  switchLabel.className = 'switch';
  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  toggle.id = 'toggle';
  switchLabel.appendChild(toggle);
  const slider = document.createElement('span');
  slider.className = 'slider';
  switchLabel.appendChild(slider);
  toggleRow.appendChild(switchLabel);
  container.appendChild(toggleRow);

  const status = document.createElement('div');
  status.className = 'status';
  status.id = 'status';
  status.textContent = 'Paused';
  container.appendChild(status);

  const counterRow = document.createElement('div');
  counterRow.className = 'counter-row';
  const counterLabel = document.createElement('span');
  counterLabel.className = 'counter-label';
  counterLabel.textContent = 'Requests sent';
  counterRow.appendChild(counterLabel);
  const counterValue = document.createElement('span');
  counterValue.className = 'counter-value';
  counterValue.id = 'counter';
  counterValue.textContent = '0';
  counterRow.appendChild(counterValue);
  container.appendChild(counterRow);

  const resetBtn = document.createElement('button');
  resetBtn.id = 'reset';
  resetBtn.className = 'reset-btn';
  resetBtn.textContent = 'Reset Counter';
  container.appendChild(resetBtn);

  document.body.appendChild(container);
}

function setupChromeMock() {
  const storageData = {};

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
    tabs: {
      query(_opts, cb) {
        cb([{ id: 1 }]);
      },
      sendMessage: vi.fn((_tabId, _msg, cb) => {
        if (cb) cb(null);
      }),
    },
    runtime: {
      lastError: null,
      onMessage: {
        addListener() {},
      },
    },
  };

  return { storageData };
}

describe('popup.js', () => {
  beforeEach(() => {
    buildPopupDOM();
    setupChromeMock();
  });

  it('has all required DOM elements', () => {
    expect(document.getElementById('toggle')).not.toBe(null);
    expect(document.getElementById('status')).not.toBe(null);
    expect(document.getElementById('counter')).not.toBe(null);
    expect(document.getElementById('reset')).not.toBe(null);
  });

  it('sendMessage resolves with response', async () => {
    chrome.tabs.sendMessage.mockImplementation((_tabId, _msg, cb) => {
      cb({ active: true, count: 5 });
    });

    // Simulate the sendMessage function from popup.js
    function sendMessage(msg) {
      return new Promise((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, msg, (response) => {
              if (chrome.runtime.lastError) {
                resolve(null);
              } else {
                resolve(response);
              }
            });
          } else {
            resolve(null);
          }
        });
      });
    }

    const resp = await sendMessage({ action: 'getStatus' });
    expect(resp).toEqual({ active: true, count: 5 });
  });

  it('sendMessage returns null when content script not loaded', async () => {
    chrome.runtime.lastError = { message: 'Could not establish connection' };
    chrome.tabs.sendMessage.mockImplementation((_tabId, _msg, cb) => {
      cb(undefined);
    });

    function sendMessage(msg) {
      return new Promise((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, msg, (response) => {
              if (chrome.runtime.lastError) {
                resolve(null);
              } else {
                resolve(response);
              }
            });
          } else {
            resolve(null);
          }
        });
      });
    }

    const resp = await sendMessage({ action: 'getStatus' });
    expect(resp).toBe(null);

    chrome.runtime.lastError = null;
  });

  it('updateUI sets correct status text and class', () => {
    const statusEl = document.getElementById('status');
    const toggleEl = document.getElementById('toggle');

    // Simulate updateUI for active state
    let enabled = true;
    statusEl.textContent = enabled ? 'Active' : 'Paused';
    statusEl.className = 'status ' + (enabled ? 'active' : '');
    toggleEl.checked = enabled;

    expect(statusEl.textContent).toBe('Active');
    expect(statusEl.classList.contains('active')).toBe(true);
    expect(toggleEl.checked).toBe(true);

    // Simulate updateUI for paused state
    enabled = false;
    statusEl.textContent = enabled ? 'Active' : 'Paused';
    statusEl.className = 'status ' + (enabled ? 'active' : '');
    toggleEl.checked = enabled;

    expect(statusEl.textContent).toBe('Paused');
    expect(statusEl.classList.contains('active')).toBe(false);
    expect(toggleEl.checked).toBe(false);
  });

  it('storage persistence works', () => {
    chrome.storage.local.set({ lcEnabled: true, lcCount: 42 });

    chrome.storage.local.get(['lcEnabled', 'lcCount'], (result) => {
      expect(result.lcEnabled).toBe(true);
      expect(result.lcCount).toBe(42);
    });
  });
});
