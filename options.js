const urlEl = document.getElementById('ops-url');
const tokenEl = document.getElementById('ops-token');
const autoEl = document.getElementById('ops-auto');
const testBtn = document.getElementById('ops-test');
const saveBtn = document.getElementById('ops-save');
const syncBtn = document.getElementById('ops-sync-now');
const forgetBtn = document.getElementById('ops-forget');
const hint = document.getElementById('ops-hint');
const stSynced = document.getElementById('st-synced');
const stPending = document.getElementById('st-pending');
const stInvalid = document.getElementById('st-invalid');
const stLast = document.getElementById('st-last');
const versionEl = document.getElementById('version');

const VERSION = (chrome.runtime && chrome.runtime.getManifest) ? (chrome.runtime.getManifest().version || '') : '';
if (versionEl) versionEl.textContent = VERSION ? 'v' + VERSION : '';

let forgetArmed = false;

function say(message, isError) {
  hint.textContent = message || '';
  hint.className = 'hint' + (isError ? ' error' : '');
}

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, (r) => resolve(r || {})));
}
function storageSet(obj) {
  return new Promise((resolve) => chrome.storage.local.set(obj, () => resolve()));
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

// Read the fields as the user typed them; validation lives in lib.js.
function readForm() {
  return { baseUrl: urlEl.value, token: tokenEl.value.trim(), auto: autoEl.checked };
}

function validate(form) {
  const baseUrl = LC.opsNormalizeUrl(form.baseUrl);
  if (!baseUrl) return { error: 'The ops URL must be https:// (http only for localhost).' };
  if (!LC.opsValidToken(form.token)) return { error: 'That is not an ops API token — it starts with ops_ and is 36+ characters.' };
  return { baseUrl, token: form.token, auto: !!form.auto };
}

// A custom ops host needs an explicit host permission; the default host is
// granted by the manifest. Must run inside the click handler (user gesture).
async function ensureHostPermission(baseUrl) {
  if (!chrome.permissions || !chrome.permissions.contains) return true;
  const origins = [baseUrl + '/*'];
  const has = await new Promise((r) => chrome.permissions.contains({ origins }, r));
  if (has) return true;
  return new Promise((r) => chrome.permissions.request({ origins }, (granted) => r(!!granted)));
}

async function renderStatus() {
  const { lcOps, lcLog, lcOpsState, lcOpsLast } = await storageGet(['lcOps', 'lcLog', 'lcOpsState', 'lcOpsLast']);
  const state = lcOpsState || {};
  const log = Array.isArray(lcLog) ? lcLog : [];
  let synced = 0, invalid = 0;
  for (const v of Object.values(state)) {
    if (v && v.status === 'ok') synced++;
    else if (v && v.status === 'invalid') invalid++;
  }
  stSynced.textContent = synced;
  stInvalid.textContent = invalid;
  stPending.textContent = LC.opsPending(log, state).length;
  const configured = !!(lcOps && lcOps.token);
  syncBtn.disabled = !configured;
  if (lcOpsLast && lcOpsLast.at) {
    const when = LC.formatTimestamp(new Date(lcOpsLast.at).toISOString());
    stLast.textContent = lcOpsLast.error
      ? 'Last sync ' + when + ' failed: ' + lcOpsLast.error
      : 'Last sync ' + when + ': ' + lcOpsLast.sent + ' sent · ' + lcOpsLast.created + ' new · ' +
        lcOpsLast.updated + ' updated · ' + lcOpsLast.unchanged + ' already there' +
        (lcOpsLast.invalid ? ' · ' + lcOpsLast.invalid + ' rejected' : '');
    stLast.className = 'opt-help' + (lcOpsLast.error ? ' error' : '');
  } else {
    stLast.textContent = configured ? 'No sync yet.' : 'Not configured yet.';
    stLast.className = 'opt-help';
  }
}

async function load() {
  const { lcOps } = await storageGet(['lcOps']);
  const s = lcOps || {};
  urlEl.value = s.baseUrl || LC.OPS_DEFAULT_URL;
  tokenEl.value = s.token || '';
  autoEl.checked = !!s.auto;
  await renderStatus();
}

saveBtn.addEventListener('click', async () => {
  const v = validate(readForm());
  if (v.error) { say(v.error, true); return; }
  const granted = await ensureHostPermission(v.baseUrl);
  if (!granted) { say('Chrome did not grant access to ' + v.baseUrl + ' — nothing saved.', true); return; }
  await storageSet({ lcOps: { baseUrl: v.baseUrl, token: v.token, auto: v.auto } });
  say('Saved.');
  await renderStatus();
});

autoEl.addEventListener('change', async () => {
  const { lcOps } = await storageGet(['lcOps']);
  if (!lcOps || !lcOps.token) return; // takes effect with Save
  await storageSet({ lcOps: Object.assign({}, lcOps, { auto: autoEl.checked }) });
  say(autoEl.checked ? 'Auto-sync on.' : 'Auto-sync off.');
});

testBtn.addEventListener('click', async () => {
  const v = validate(readForm());
  if (v.error) { say(v.error, true); return; }
  say('Testing…');
  const resp = await askWorker({ action: 'opsTest', settings: { baseUrl: v.baseUrl, token: v.token } });
  if (!resp) { say('The extension worker did not answer — reload the extension.', true); return; }
  if (resp.ok) say('Connected — ops accepted the token.');
  else say(resp.error || 'Connection failed.', true);
});

syncBtn.addEventListener('click', async () => {
  say('Syncing…');
  const resp = await askWorker({ action: 'opsSync' });
  if (!resp) { say('The extension worker did not answer — reload the extension.', true); return; }
  if (resp.ok && resp.summary) {
    say('Synced: ' + resp.summary.sent + ' sent, ' + resp.summary.created + ' new, ' +
        resp.summary.updated + ' updated, ' + resp.summary.unchanged + ' already there.');
  } else {
    say(resp.error || 'Sync failed.', true);
  }
  await renderStatus();
});

forgetBtn.addEventListener('click', async () => {
  if (!forgetArmed) {
    forgetArmed = true;
    forgetBtn.textContent = 'Really forget?';
    forgetBtn.classList.add('armed');
    say('Every contact becomes pending again. ops will not duplicate anything.', true);
    return;
  }
  forgetArmed = false;
  forgetBtn.textContent = 'Forget sync state';
  forgetBtn.classList.remove('armed');
  await storageSet({ lcOpsState: {}, lcOpsLast: null });
  say('Sync state cleared.');
  await renderStatus();
});

load();
