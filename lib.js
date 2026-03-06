/**
 * Extracted pure/testable functions for LinkedIn Auto-Connect.
 * Loaded before content.js via manifest content_scripts.
 * Exported on window.LC for content.js, and via module.exports for tests.
 */
(function (root) {
  function getCsrfToken() {
    const match = document.cookie.match(/JSESSIONID="?([^";]+)/);
    return match ? match[1] : null;
  }

  function getProfileId(connectLink) {
    let el = connectLink;
    for (let i = 0; i < 20 && el; i++) {
      const key = el.getAttribute('componentkey');
      if (key && key.startsWith('SearchResults')) {
        return key.slice('SearchResults'.length);
      }

      const urn = el.getAttribute('data-chameleon-result-urn');
      if (urn && urn.includes('fsd_profile:')) {
        return urn.split('fsd_profile:')[1];
      }

      el = el.parentElement;
    }
    return null;
  }

  function isConnectButton(el) {
    const text = el.textContent.trim();
    if (text === 'Vernetzen' || text === 'Connect') return true;
    return false;
  }

  function findNextConnect(processedProfiles) {
    // Strategy 1: data-view-name attribute
    const dvn = document.querySelectorAll('[data-view-name="edge-creation-connect-action"] a, [data-view-name="edge-creation-connect-action"] button');
    for (const el of dvn) {
      if (!isConnectButton(el)) continue;
      if (el.closest('[role="dialog"], .artdeco-modal, dialog')) continue;
      const pid = getProfileId(el);
      if (pid && processedProfiles.has(pid)) continue;
      return el;
    }

    // Strategy 2: Find buttons/links by visible text
    const candidates = document.querySelectorAll('button, a');
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
      const exact = modal.querySelector('button[aria-label="Ohne Notiz senden"], button[aria-label="Send without a note"]');
      if (exact) return exact;

      const buttons = modal.querySelectorAll('button');
      for (const btn of buttons) {
        const text = btn.textContent.trim();
        if (text === 'Ohne Notiz senden' || text === 'Send without a note') return btn;
      }

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

  const LC = {
    getCsrfToken,
    getProfileId,
    isConnectButton,
    findNextConnect,
    findConfirmButton,
    realClick
  };

  root.LC = LC;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = LC;
  }
})(typeof window !== 'undefined' ? window : globalThis);
