const toggle = document.getElementById('toggle');
const status = document.getElementById('status');
const counter = document.getElementById('counter');
const logged = document.getElementById('logged');
const healed = document.getElementById('healed');
const resetBtn = document.getElementById('reset');
const exportBtn = document.getElementById('export');
const reportBtn = document.getElementById('report');
const backupBtn = document.getElementById('backup');
const restoreBtn = document.getElementById('restore');
const restoreFile = document.getElementById('restoreFile');
const clearBtn = document.getElementById('clearLog');
const hint = document.getElementById('hint');
const quotaPanel = document.getElementById('quota-panel');
const quotaUsed = document.getElementById('quota-used');
const quotaLimit = document.getElementById('quota-limit');
const quotaFill = document.getElementById('quota-fill');
const quotaSub = document.getElementById('quota-sub');
const rangesEl = document.getElementById('ranges');
const chartEl = document.getElementById('chart');
const rangeTotal = document.getElementById('range-total');
const versionEl = document.getElementById('version');
const opsStatus = document.getElementById('ops-status');
const opsSyncBtn = document.getElementById('ops-sync');
const opsSettingsBtn = document.getElementById('ops-settings');

let enabled = false;
let log = [];             // stored contact log, read straight from storage
let events = [];          // stored send timestamps — the quota/chart series
let range = LC.CHART_RANGES[0].key;
let clearArmed = false;   // "Clear Log" is a two-step confirm (no confirm() in a popup)
let pendingRestore = null; // a validated backup waiting for the second click
let lastChartKey = '';    // fingerprint guard — see renderStats()
let tabReachable = true;  // is a content script answering in the active tab?
let misses = 0;           // consecutive unanswered status polls
let pollTimer = null;
let ops = null;            // { baseUrl, token, auto } or null when not set up
let opsState = {};         // per-contact acknowledgement from ops
let opsLast = null;        // summary of the last sync run
let opsBusy = false;

const VERSION = (chrome.runtime && chrome.runtime.getManifest)
  ? (chrome.runtime.getManifest().version || '') : '';
let halted = null;         // circuit-breaker reason reported by the tab

// Footer: plain version, or a link to the newer release once one is known
// (the check itself is opt-in on the options page).
function renderVersion(update) {
  if (!versionEl) return;
  versionEl.textContent = VERSION ? 'v' + VERSION : '';
  if (update && update.available && update.url && LC.compareVersions(update.latest, VERSION) > 0) {
    versionEl.append(' → ');
    const a = document.createElement('a');
    a.href = update.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.textContent = update.latest + ' ↗';
    a.title = 'A newer release is available';
    versionEl.appendChild(a);
  }
}
renderVersion(null);

const RELOAD_HINT = 'Reload the LinkedIn tab';

function updateUI() {
  if (tabReachable && halted) {
    // The tab stopped itself after too many failures in a row.
    // One line: the short form here, the full reason on hover.
    status.textContent = '⚠️ Stopped: ' + String(halted).replace(/\s*\(.*\)\s*$/, '');
    status.title = halted;
    status.className = 'status warn';
    toggle.checked = false;
    return;
  }
  if (!tabReachable) {
    // Either this is not a LinkedIn page, or the extension was reloaded and the
    // page was not — the old content script is orphaned and receives nothing.
    // Showing "Paused" here would be a lie: nothing is listening at all.
    status.textContent = '⚠️ ' + RELOAD_HINT;
    status.className = 'status warn';
    toggle.checked = enabled;
    return;
  }
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

// --- Weekly quota + activity chart -----------------------------------------
LC.CHART_RANGES.forEach((r) => {
  const chip = document.createElement('button');
  chip.className = 'chip';
  chip.dataset.range = r.key;
  chip.textContent = r.label;
  chip.addEventListener('click', () => {
    range = r.key;
    chrome.storage.local.set({ lcRange: range });
    syncChips();
    renderStats();
  });
  rangesEl.appendChild(chip);
});

function syncChips() {
  for (const chip of rangesEl.querySelectorAll('.chip')) {
    chip.classList.toggle('active', chip.dataset.range === range);
  }
}

function renderStats() {
  const now = Date.now();
  const q = LC.weekQuota(events, now);
  quotaUsed.textContent = q.used;
  quotaLimit.textContent = q.limit;
  quotaFill.style.width = q.percent + '%';
  quotaSub.textContent = q.remaining + ' left this week · ' + q.rolling7 +
    ' in the last 7 days · resets ' + LC.formatDay(q.resetsAt);
  quotaPanel.className = 'panel' +
    (q.remaining === 0 ? ' over' : q.percent >= 80 ? ' warn' : '');

  const buckets = LC.bucketEvents(events, range, now);
  const total = buckets.reduce((a, b) => a + b.count, 0);
  // Younger history than the period? Say where it starts, so six empty
  // columns read as "no data yet", not as "nothing happened".
  const first = events.length ? events[0] : null;
  const d = first ? new Date(first) : null;
  const since = (d && buckets.length && first > buckets[0].start) ? ' · since ' + d.getDate() + '.' + (d.getMonth() + 1) + '.' : '';
  rangeTotal.title = since ? 'History starts ' + LC.formatDay(first) + ' (contact log since v2.8.0)' : '';
  rangeTotal.textContent = total + ' in ' + LC.rangeByKey(range).label + since;

  // The status poll runs once a second. Re-writing the SVG on every tick would
  // kill hover tooltips mid-hover, so it is only redrawn when the series or the
  // selected period actually changed.
  const key = range + ':' + events.length + ':' + (events[0] || 0) +
    ':' + (events[events.length - 1] || 0);
  if (key === lastChartKey) return;
  lastChartKey = key;
  chartEl.innerHTML = LC.chartSvg(buckets, { width: 300, height: 56 });
}

// --- Stored state -----------------------------------------------------------
// Read from storage, not via a message: exports have to work while the popup
// sits over any tab, including one where no content script ever ran.
function renderLog() {
  logged.textContent = log.length;
  exportBtn.disabled = log.length === 0;
  reportBtn.disabled = log.length === 0 && events.length === 0;
  clearBtn.disabled = log.length === 0;
  if (log.length === 0) disarmClear();
}

function loadState() {
  chrome.storage.local.get(['lcLog', 'lcEvents', 'lcRange', 'lcOps', 'lcOpsState', 'lcOpsLast', 'lcUpdate'], (result) => {
    renderVersion(result.lcUpdate);
    log = Array.isArray(result.lcLog) ? result.lcLog : [];
    events = LC.normalizeEvents(result.lcEvents);
    range = LC.rangeByKey(result.lcRange).key;
    ops = (result.lcOps && result.lcOps.token) ? result.lcOps : null;
    opsState = (result.lcOpsState && typeof result.lcOpsState === 'object') ? result.lcOpsState : {};
    opsLast = result.lcOpsLast || null;
    syncChips();
    renderLog();
    renderStats();
    renderOps();
  });
}

// --- celox ops ---------------------------------------------------------------
// The worker does the pushing; the popup only shows where things stand.
function renderOps() {
  if (!opsStatus) return;
  const pending = ops ? LC.opsPending(log, opsState).length : 0;
  let synced = 0;
  for (const v of Object.values(opsState)) if (v && v.status === 'ok') synced++;
  let text, cls = '';
  if (!ops) {
    text = 'ops: not set up';
  } else if (opsBusy) {
    text = 'ops: syncing…';
  } else if (opsLast && opsLast.error) {
    text = 'ops: ' + opsLast.error;
    cls = 'error';
  } else if (pending > 0) {
    text = 'ops: ' + pending + ' pending' + (synced ? ' · ' + synced + ' synced' : '');
    cls = 'pending';
  } else {
    text = 'ops: all synced' + (synced ? ' (' + synced + ')' : '');
    cls = 'ok';
  }
  opsStatus.textContent = text;
  opsStatus.className = 'ops-status' + (cls ? ' ' + cls : '');
  opsStatus.title = ops ? ops.baseUrl + (ops.auto ? ' · auto-sync on' : ' · manual') : 'Set up in the extension options';
  opsSyncBtn.disabled = !ops || opsBusy || pending === 0;
}

function askWorker(msg) {
  return new Promise((resolve) => {
    if (!chrome.runtime || !chrome.runtime.sendMessage) return resolve(null);
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) return resolve(null);
      resolve(resp);
    });
  });
}

function disarmClear() {
  clearArmed = false;
  clearBtn.textContent = 'Clear Log';
  clearBtn.classList.remove('armed');
}

function disarmRestore() {
  pendingRestore = null;
  restoreBtn.textContent = '↺ Restore';
  restoreBtn.classList.remove('armed');
}

// --- Downloads --------------------------------------------------------------
function anchorDownload(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// One download path for all three exports: preferred chrome.downloads (it
// pre-fills the file name in the save dialog), anchor as the fallback.
function download(url, filename, okMessage) {
  const done = () => say(okMessage);

  if (!chrome.downloads || !chrome.downloads.download) {
    anchorDownload(url, filename);
    done();
    return;
  }

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
}

exportBtn.addEventListener('click', () => {
  if (!log.length) return;
  download(
    LC.csvDataUrl(LC.toCsv(log)),
    LC.csvFilename(new Date()),
    log.length + ' contact' + (log.length === 1 ? '' : 's') + ' exported'
  );
});

reportBtn.addEventListener('click', () => {
  if (!log.length && !events.length) return;
  const now = new Date();
  const html = LC.reportHtml({
    quota: LC.weekQuota(events, now.getTime()),
    buckets: LC.bucketEvents(events, range, now.getTime()),
    records: log,
    rangeLabel: LC.rangeByKey(range).label,
    generatedAt: now,
    version: VERSION
  });
  download(LC.htmlDataUrl(html), LC.reportFilename(now), 'Report exported');
});

backupBtn.addEventListener('click', () => {
  chrome.storage.local.get(LC.BACKUP_KEYS, (state) => {
    const backup = LC.buildBackup(state, { version: VERSION, now: new Date() });
    download(
      LC.jsonDataUrl(backup),
      LC.backupFilename(new Date()),
      'Backup written (' + backup.data.lcLog.length + ' contacts, ' +
        backup.data.lcEvents.length + ' requests)'
    );
  });
});

// --- Restore ----------------------------------------------------------------
restoreBtn.addEventListener('click', () => {
  if (pendingRestore) {
    applyRestore();
    return;
  }
  disarmClear();
  restoreFile.value = '';
  restoreFile.click();
});

restoreFile.addEventListener('change', () => {
  const file = restoreFile.files && restoreFile.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const parsed = LC.parseBackup(String(reader.result));
    if (!parsed.ok) {
      // Nothing is written on a bad file — the current data stays untouched.
      disarmRestore();
      say(parsed.error, true);
      return;
    }
    pendingRestore = parsed;
    restoreBtn.textContent = 'Overwrite with ' + parsed.stats.contacts + '?';
    restoreBtn.classList.add('armed');
    say('Replaces the log and history with ' + parsed.stats.contacts + ' contacts / ' +
      parsed.stats.events + ' requests. Click again to confirm.', true);
  };
  reader.onerror = () => {
    disarmRestore();
    say('Could not read that file.', true);
  };
  reader.readAsText(file);
});

function applyRestore() {
  const parsed = pendingRestore;
  disarmRestore();
  chrome.storage.local.set(parsed.data, () => {
    log = parsed.data.lcLog;
    events = parsed.data.lcEvents;
    range = parsed.data.lcRange;
    enabled = false; // a restore never resumes sending
    counter.textContent = parsed.data.lcCount;
    updateUI();
    syncChips();
    lastChartKey = '';
    renderLog();
    renderStats();
    sendMessage({ action: 'reloadState' });
    say('Restored ' + parsed.stats.contacts + ' contacts and ' +
      parsed.stats.events + ' requests');
  });
}

// --- Buttons ----------------------------------------------------------------
if (opsSyncBtn) {
  opsSyncBtn.addEventListener('click', async () => {
    if (!ops || opsBusy) return;
    opsBusy = true;
    renderOps();
    const resp = await askWorker({ action: 'opsSync' });
    opsBusy = false;
    if (!resp) {
      say('The extension worker did not answer — reload the extension.', true);
    } else if (resp.ok && resp.summary) {
      say('ops: ' + resp.summary.sent + ' sent · ' + resp.summary.created + ' new · ' +
          resp.summary.updated + ' updated · ' + resp.summary.unchanged + ' already there');
    } else {
      say(resp.error || 'ops sync failed', true);
    }
    loadState();
  });
}

if (opsSettingsBtn) {
  opsSettingsBtn.addEventListener('click', () => {
    if (chrome.runtime && chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
  });
}

toggle.addEventListener('change', async () => {
  enabled = toggle.checked;
  const resp = await sendMessage({ action: 'toggle', enabled });
  if (!resp) {
    // Never let the switch imply something started that nobody received.
    tabReachable = false;
    enabled = false;
    say(RELOAD_HINT + ' — nothing is listening on this page.', true);
  }
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
    disarmRestore();
    clearBtn.textContent = 'Delete ' + log.length + '?';
    clearBtn.classList.add('armed');
    say('Deletes the saved contacts and lifts the duplicate guard. ' +
      'The weekly quota history is kept.', true);
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

// Poll the tab for its live state. Quota, chart and the exports come from
// storage and keep working even when no content script answers.
const POLL_FAST = 1000;
const POLL_SLOW = 5000;   // back off rather than hammer a tab with no listener
const MISS_LIMIT = 3;

async function refreshStatus() {
  const resp = await sendMessage({ action: 'getStatus' });

  if (resp && !resp.contextGone) {
    misses = 0;
    tabReachable = true;
    enabled = resp.active;
    halted = resp.halted || null;
    counter.textContent = resp.count;
    if (healed) healed.textContent = resp.healed ? 'self-healed ✓' : 'default';
  } else {
    misses++;
    if (misses >= MISS_LIMIT) {
      tabReachable = false;
      enabled = false;
    }
  }
  updateUI();
  loadState();
  schedulePoll();
}

function schedulePoll() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(refreshStatus, tabReachable ? POLL_FAST : POLL_SLOW);
}

// Initial load
chrome.storage.local.get(['lcEnabled', 'lcCount'], (result) => {
  enabled = result.lcEnabled || false;
  counter.textContent = result.lcCount || 0;
  updateUI();
});

loadState();
refreshStatus();
