const toggle = document.getElementById('toggle');
const status = document.getElementById('status');
const counter = document.getElementById('counter');
const resetBtn = document.getElementById('reset');

let enabled = false;

function updateUI() {
  status.textContent = enabled ? 'Active' : 'Paused';
  status.className = 'status ' + (enabled ? 'active' : '');
  toggle.checked = enabled;
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

toggle.addEventListener('change', async () => {
  enabled = toggle.checked;
  await sendMessage({ action: 'toggle', enabled });
  updateUI();
  chrome.storage.local.set({ lcEnabled: enabled });
});

resetBtn.addEventListener('click', async () => {
  await sendMessage({ action: 'resetCount' });
  counter.textContent = '0';
});

// Poll status every second while popup is open
async function refreshStatus() {
  const resp = await sendMessage({ action: 'getStatus' });
  if (resp) {
    enabled = resp.active;
    counter.textContent = resp.count;
    updateUI();
  }
}

// Initial load
chrome.storage.local.get(['lcEnabled', 'lcCount'], (result) => {
  enabled = result.lcEnabled || false;
  counter.textContent = result.lcCount || 0;
  updateUI();
});

refreshStatus();
setInterval(refreshStatus, 1000);
