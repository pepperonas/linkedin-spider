/**
 * Extracted pure/testable functions for LinkedIn Auto-Connect.
 * Loaded before content.js via manifest content_scripts.
 * Exported on window.LC for content.js, and via module.exports for tests.
 */
(function (root) {
  // --- Self-healing detection data ----------------------------------------
  // Visible button text per locale (used as a fallback signal).
  const CONNECT_TEXTS = [
    'Vernetzen',      // DE
    'Connect',        // EN
    'Conectar',       // ES / PT
    'Collegati',      // IT
    'Se mettre en relation', // FR
    'Connectie maken' // NL
  ];

  // aria-label patterns on the clickable connect element. Primary signal:
  // the SDUI rollout buries the text in nested hashed-class <span>s, but the
  // <a>/<button> still carries an aria-label like "<Name> als Kontakt einladen".
  const CONNECT_ARIA = [
    /\bals Kontakt einladen$/i,            // DE
    /^Invite\b.*\bto connect$/i,           // EN
    /\bse mettre en relation avec\b/i,     // FR
    /\binvita(?:re)?\b.*\bcollegar/i,      // IT
    /\binvitar a\b.*\bconectar/i           // ES
  ];

  // Confirm-dialog button ("send without a note") per locale.
  const SEND_WITHOUT_NOTE = [
    'Ohne Notiz senden',     // DE
    'Send without a note',   // EN
    'Enviar sin nota',       // ES
    'Invia senza nota',      // IT
    'Envoyer sans note',     // FR
    'Enviar sem nota'        // PT
  ];

  // Built-in invite request recipe (early-2026 Voyager endpoint). Used until a
  // live request is captured by the MAIN-world interceptor (see interceptor.js).
  const DEFAULT_INVITE_RECIPE = {
    url: '/voyager/api/voyagerRelationshipsDashMemberRelationships?action=verifyQuotaAndCreateV2&decorationId=com.linkedin.voyager.dash.deco.relationships.InvitationCreationResultWithInvitee-2',
    method: 'POST',
    headers: {
      'x-restli-protocol-version': '2.0.0',
      'content-type': 'application/json; charset=UTF-8'
    },
    bodyTemplate: JSON.stringify({
      invitee: { inviteeUnion: { memberProfile: 'urn:li:fsd_profile:%PROFILE_ID%' } }
    })
  };

  // --- Core helpers --------------------------------------------------------
  function getCsrfToken() {
    const match = document.cookie.match(/JSESSIONID="?([^";]+)/);
    return match ? match[1] : null;
  }

  function getProfileId(connectLink) {
    let el = connectLink;
    for (let i = 0; i < 20 && el; i++) {
      // componentkey="SearchResults<ID>"
      const key = el.getAttribute('componentkey');
      if (key && key.startsWith('SearchResults')) {
        return key.slice('SearchResults'.length);
      }

      // Any attribute carrying a member profile URN (e.g. data-chameleon-result-urn,
      // or future attribute names — we match by value, not by attribute name).
      for (const attr of el.attributes) {
        const m = attr.value.match(/urn:li:fsd_profile:([A-Za-z0-9_=-]+)/);
        if (m) return m[1];
      }

      el = el.parentElement;
    }
    return null;
  }

  function isConnectButton(el) {
    const text = el.textContent.trim();
    if (CONNECT_TEXTS.includes(text)) return true;

    const aria = (el.getAttribute('aria-label') || '').trim();
    if (CONNECT_ARIA.some((re) => re.test(aria))) return true;

    // Language-independent: the connect <a> links to the invite flow.
    const href = el.getAttribute('href') || '';
    if (/search-custom-invite|growth\/invite|people\/invite/i.test(href)) return true;

    return false;
  }

  function findNextConnect(processedProfiles) {
    // Strategy 1: legacy data-view-name container (older LinkedIn UIs)
    const dvn = document.querySelectorAll('[data-view-name="edge-creation-connect-action"] a, [data-view-name="edge-creation-connect-action"] button');
    for (const el of dvn) {
      if (!isConnectButton(el)) continue;
      if (el.closest('[role="dialog"], .artdeco-modal, dialog')) continue;
      const pid = getProfileId(el);
      if (pid && processedProfiles.has(pid)) continue;
      return el;
    }

    // Strategy 2: SDUI / generic — clickable elements matched by text, aria-label or href
    const candidates = document.querySelectorAll('a, button, [role="button"]');
    for (const el of candidates) {
      if (!isConnectButton(el)) continue;
      if (el.closest('[role="dialog"], .artdeco-modal, dialog')) continue;
      const pid = getProfileId(el);
      if (pid && processedProfiles.has(pid)) continue;
      return el;
    }

    return null;
  }

  function findConfirmButton() {
    const modals = document.querySelectorAll('[role="dialog"], .artdeco-modal, dialog');
    for (const modal of modals) {
      // 1. Exact aria-label match in any known locale
      for (const label of SEND_WITHOUT_NOTE) {
        const byAria = modal.querySelector(
          `button[aria-label="${label}"], a[aria-label="${label}"], [role="button"][aria-label="${label}"]`
        );
        if (byAria) return byAria;
      }

      // 2. Exact text match in any known locale
      const clickables = modal.querySelectorAll('button, a, [role="button"]');
      for (const btn of clickables) {
        if (SEND_WITHOUT_NOTE.includes(btn.textContent.trim())) return btn;
      }

      // 3. send-invite modal → primary action button
      if (modal.classList.contains('send-invite') || modal.querySelector('.send-invite')) {
        const primary = modal.querySelector('.artdeco-button--primary');
        if (primary) return primary;
      }
    }
    return null;
  }

  function realClick(el) {
    ['mousedown', 'mouseup', 'click'].forEach(type => {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
    });
  }

  // --- Self-healing invite recipe helpers ----------------------------------
  // Heuristic used by both the interceptor (to learn) and tests: does this
  // request look like a "send connection invitation" call?
  function isInviteRequest(url, body) {
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

  // Turn a recipe (built-in or learned) into a concrete request for `profileId`.
  // Always injects a fresh CSRF token; the captured one may have expired.
  function buildInviteRequest(recipe, profileId, csrfToken) {
    if (!recipe || !recipe.url || !profileId) return null;

    const headers = Object.assign({}, recipe.headers || {});
    if (csrfToken) headers['csrf-token'] = csrfToken;
    if (!('content-type' in headers) && !('Content-Type' in headers)) {
      headers['content-type'] = 'application/json; charset=UTF-8';
    }

    let body = null;
    if (recipe.bodyTemplate) {
      body = recipe.bodyTemplate.split('%PROFILE_ID%').join(profileId);
    } else if (recipe.body) {
      body = recipe.body.replace(/(urn:li:fsd_profile:)[A-Za-z0-9_=-]+/g, '$1' + profileId);
    }
    if (!body) return null;

    return { url: recipe.url, method: recipe.method || 'POST', headers, body };
  }

  // Is a learned recipe usable (i.e. carries a substitutable profile URN)?
  function isUsableRecipe(recipe) {
    if (!recipe || !recipe.url) return false;
    if (recipe.bodyTemplate && recipe.bodyTemplate.includes('%PROFILE_ID%')) return true;
    if (recipe.body && /urn:li:fsd_profile:/.test(recipe.body)) return true;
    return false;
  }

  const LC = {
    getCsrfToken,
    getProfileId,
    isConnectButton,
    findNextConnect,
    findConfirmButton,
    realClick,
    isInviteRequest,
    buildInviteRequest,
    isUsableRecipe,
    DEFAULT_INVITE_RECIPE,
    CONNECT_TEXTS,
    SEND_WITHOUT_NOTE
  };

  root.LC = LC;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = LC;
  }
})(typeof window !== 'undefined' ? window : globalThis);
