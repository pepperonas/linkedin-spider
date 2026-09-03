/**
 * Service worker: pushes sent connection requests into celox ops.
 *
 * Why a worker and not the popup: the popup closes (and dies) the moment the
 * user clicks away, and a sync of a few hundred rows must survive that. The
 * worker also sees `chrome.storage.onChanged`, so with auto-sync on, a request
 * the content script just logged reaches ops a few seconds later without anyone
 * opening anything.
 *
 * All logic lives in lib.js (`opsSyncRun`, fetch injected) — this file only
 * wires storage and messages. The sync state is its own key (`lcOpsState`,
 * keyed by profile), so this worker never rewrites `lcLog` while the content
 * script is appending to it.
 */
importScripts('lib.js');

(() => {
  const LOG = '[LC-bg]';
  const { opsSyncRun, opsNormalizeUrl, opsValidToken, OPS_IMPORT_PATH } = self.LC;

  const AUTO_DEBOUNCE_MS = 3000;
  let running = null;      // promise of the run in flight
  let rerun = false;       // something changed while running → go again after
  let autoTimer = null;

  function get(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, (r) => resolve(r || {})));
  }
  function set(obj) {
    return new Promise((resolve) => chrome.storage.local.set(obj, () => resolve()));
  }

  async function runSync(trigger) {
    if (running) { rerun = true; return running; }
    running = (async () => {
      const { lcOps, lcLog, lcOpsState } = await get(['lcOps', 'lcLog', 'lcOpsState']);
      const settings = lcOps || {};
      if (!settings.token) {
        return { ok: false, summary: null, error: 'not configured' };
      }
      const out = await opsSyncRun({ settings, log: lcLog, state: lcOpsState, now: Date.now() });
      await set({ lcOpsState: out.state, lcOpsLast: Object.assign({ trigger }, out.summary) });
      console.log(LOG, 'sync', trigger, JSON.stringify(out.summary));
      return { ok: !out.error, summary: out.summary, error: out.error };
    })().catch((e) => ({ ok: false, summary: null, error: String(e && e.message || e) }))
      .finally(() => {
        running = null;
        if (rerun) { rerun = false; runSync('rerun'); }
      });
    return running;
  }

  // Connectivity check for the options page: an empty preview needs the token
  // and the URL to be right, and writes nothing.
  async function testConnection(settings) {
    const base = opsNormalizeUrl(settings && settings.baseUrl);
    if (!base) return { ok: false, error: 'Invalid ops URL' };
    if (!opsValidToken(settings && settings.token)) return { ok: false, error: 'That is not an ops API token (expected ops_…)' };
    try {
      const resp = await fetch(base + OPS_IMPORT_PATH, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + settings.token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: [], commit: false })
      });
      if (resp.ok) return { ok: true, status: resp.status };
      let detail = '';
      try { const j = await resp.json(); detail = (j && j.detail) || ''; } catch (e) { /* no body */ }
      return { ok: false, status: resp.status, error: 'ops answered ' + resp.status + (detail ? ': ' + detail : '') };
    } catch (e) {
      return { ok: false, error: 'ops unreachable: ' + (e && e.message ? e.message : String(e)) };
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return false;
    if (msg.action === 'opsSync') {
      runSync('manual').then(sendResponse);
      return true; // async response
    }
    if (msg.action === 'opsTest') {
      testConnection(msg.settings).then(sendResponse);
      return true;
    }
    return false;
  });

  // Auto-sync: a new log entry (content script) or a settings change → one run,
  // debounced so a burst of sends becomes one request.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (!changes.lcLog && !changes.lcOps) return;
    chrome.storage.local.get(['lcOps'], (r) => {
      const s = (r && r.lcOps) || {};
      if (!s.auto || !s.token) return;
      clearTimeout(autoTimer);
      autoTimer = setTimeout(() => runSync('auto'), AUTO_DEBOUNCE_MS);
    });
  });

  console.log(LOG, 'ready');
})();
