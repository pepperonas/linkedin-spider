const toggle = document.getElementById('toggle');
const status = document.getElementById('status');
const counter = document.getElementById('counter');
const logged = document.getElementById('logged');
const healed = document.getElementById('healed');
const resetBtn = document.getElementById('reset');
const exportBtn = document.getElementById('export');
const clearBtn = document.getElementById('clearLog');
const hint = document.getElementById('hint');

let enabled = false;
let log = [];          // the stored contact log, read straight from storage
let clearArmed = false; // "Clear Log" is a two-step confirm (no confirm() in a popup)

function updateUI() {
  status.textContent = enabled ? 'Active' : 'Paused';
  status.className = 'status ' + (enabled ? 'active' : '');
  toggle.checked = enabled;
}

function say(message, isError) {
  hint.textContent = message || '';
  hint.className = 'hint' + (isError ? ' error' : '');
}

function sendMessage(msg) {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, msg, (response) => {
          if (chrome.runtime.lastError) {
            // Content script not loaded — user needs to reload the tab
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

// --- Contact log ------------------------------------------------------------
// Read from storage, not via a message: the export has to work while the popup
// sits over any tab, including one where no content script ever ran.
function renderLog() {
  logged.textContent = log.length;
  exportBtn.disabled = log.length === 0;
  clearBtn.disabled = log.length === 0;
  if (log.length === 0) disarmClear();
}

function loadLog() {
  chrome.storage.local.get(['lcLog'], (result) => {
    log = Array.isArray(result.lcLog) ? result.lcLog : [];
    renderLog();
  });
}

function disarmClear() {
  clearArmed = false;
  clearBtn.textContent = 'Clear Log';
  clearBtn.classList.remove('armed');
}

// --- Export -----------------------------------------------------------------
function anchorDownload(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

exportBtn.addEventListener('click', () => {
  if (!log.length) return;
  const filename = LC.csvFilename(new Date());
  const url = LC.csvDataUrl(LC.toCsv(log));
  const done = () => say(log.length + ' contact' + (log.length === 1 ? '' : 's') + ' exported');

  if (!chrome.downloads || !chrome.downloads.download) {
    anchorDownload(url, filename);
    done();
    return;
  }

  // Preferred path: the downloads API pre-fills the file name in the save dialog.
  chrome.downloads.download({ url, filename, saveAs: true }, (downloadId) => {
    const err = (chrome.runtime.lastError && chrome.runtime.lastError.message) || '';
    // A cancelled save dialog is a decision, not a failure — never "help" by
    // writing the file anyway through the fallback.
    if (/cancel/i.test(err)) {
      say('Export cancelled');
      return;
    }
    if (err || downloadId === undefined) {
      anchorDownload(url, filename);
      done();
      return;
    }
    done();
  });
});

// --- Buttons ----------------------------------------------------------------
toggle.addEventListener('change', async () => {
  enabled = toggle.checked;
  await sendMessage({ action: 'toggle', enabled });
  updateUI();
  chrome.storage.local.set({ lcEnabled: enabled });
});

resetBtn.addEventListener('click', async () => {
  await sendMessage({ action: 'resetCount' });
  counter.textContent = '0';
  say('Counter reset');
});

clearBtn.addEventListener('click', async () => {
  if (!clearArmed) {
    clearArmed = true;
    clearBtn.textContent = 'Delete ' + log.length + '?';
    clearBtn.classList.add('armed');
    say('Deletes the saved contacts and lifts the duplicate guard.', true);
    return;
  }
  disarmClear();
  // Tell the tab too, so its in-memory skip list forgets them in the same breath;
  // the storage write covers the case where no content script is running.
  await sendMessage({ action: 'clearLog' });
  chrome.storage.local.set({ lcLog: [] }, () => {
    log = [];
    renderLog();
    say('Contact log cleared');
  });
});

// Poll status every second while popup is open
async function refreshStatus() {
  const resp = await sendMessage({ action: 'getStatus' });
  if (resp) {
    enabled = resp.active;
    counter.textContent = resp.count;
    if (healed) healed.textContent = resp.healed ? 'self-healed ✓' : 'default';
    updateUI();
  }
  loadLog();
}

// Initial load
chrome.storage.local.get(['lcEnabled', 'lcCount'], (result) => {
  enabled = result.lcEnabled || false;
  counter.textContent = result.lcCount || 0;
  updateUI();
});

loadLog();
refreshStatus();
setInterval(refreshStatus, 1000);
