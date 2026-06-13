/**
 * Self-healing API capture — runs in the PAGE'S MAIN world at document_start
 * (manifest content_scripts, "world": "MAIN").
 *
 * LinkedIn's own JS issues the real "send invitation" request when a user (or our
 * click fallback) clicks Connect. This script patches window.fetch and
 * XMLHttpRequest to recognize that request, capture its URL / headers / body, and
 * hand the "recipe" to the isolated content script via window.postMessage.
 *
 * The content script then replays that recipe at scale (substituting the target
 * profile URN). So when LinkedIn changes the endpoint, payload shape, or required
 * headers, one real click re-teaches the extension and the fast path keeps working.
 *
 * Note: this runs in the MAIN world and therefore cannot use window.LC (that lives
 * in the isolated world). The invite-detection heuristic is duplicated here and
 * kept in sync with lib.js `isInviteRequest`.
 */
(() => {
  const LOG = '[LC-MAIN]';

  function looksLikeInvite(url, body) {
    if (typeof url === 'string') {
      const u = url.toLowerCase();
      if (u.includes('voyagerrelationshipsdashmemberrelationships') &&
          (u.includes('verifyquota') || u.includes('createv2') || u.includes('action='))) {
        return true;
      }
    }
    if (typeof body === 'string' && body.includes('inviteeUnion') && body.includes('memberProfile')) {
      return true;
    }
    return false;
  }

  function normalizeHeaders(raw) {
    const headers = {};
    if (!raw) return headers;
    try {
      if (typeof Headers !== 'undefined' && raw instanceof Headers) {
        for (const [k, v] of raw.entries()) headers[k] = v;
      } else if (Array.isArray(raw)) {
        for (const [k, v] of raw) headers[k] = v;
      } else {
        Object.assign(headers, raw);
      }
    } catch (_) { /* ignore */ }
    return headers;
  }

  function postRecipe(recipe) {
    // Only useful if the body carries a profile URN we can substitute later.
    if (!recipe.body || !/urn:li:fsd_profile:/.test(recipe.body)) return;
    try {
      window.postMessage(
        { source: 'lc-interceptor', type: 'invite-captured', recipe },
        window.location.origin
      );
      console.log(LOG, 'Captured live invite request:', recipe.url);
    } catch (_) { /* ignore */ }
  }

  // --- patch fetch ---
  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (input, init) {
      try {
        const url = typeof input === 'string' ? input : (input && input.url);
        const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
        const body = init && typeof init.body === 'string' ? init.body : null;
        if (method === 'POST' && looksLikeInvite(url, body)) {
          postRecipe({ url, method: 'POST', headers: normalizeHeaders(init && init.headers), body });
        }
      } catch (_) { /* ignore */ }
      return origFetch.apply(this, arguments);
    };
  }

  // --- patch XMLHttpRequest ---
  const XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    const open = XHR.prototype.open;
    const setRequestHeader = XHR.prototype.setRequestHeader;
    const send = XHR.prototype.send;

    XHR.prototype.open = function (method, url) {
      this.__lcInvite = { method: (method || 'GET').toUpperCase(), url, headers: {} };
      return open.apply(this, arguments);
    };

    XHR.prototype.setRequestHeader = function (key, value) {
      if (this.__lcInvite) this.__lcInvite.headers[key] = value;
      return setRequestHeader.apply(this, arguments);
    };

    XHR.prototype.send = function (body) {
      try {
        const lc = this.__lcInvite;
        const strBody = typeof body === 'string' ? body : null;
        if (lc && lc.method === 'POST' && looksLikeInvite(lc.url, strBody)) {
          postRecipe({ url: lc.url, method: 'POST', headers: lc.headers, body: strBody });
        }
      } catch (_) { /* ignore */ }
      return send.apply(this, arguments);
    };
  }

  console.log(LOG, 'Invite interceptor armed');
})();
