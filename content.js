(() => {
  const LOG = '[LC]';
  let active = false;
  let intervalId = null;
  let count = 0;
  let pending = false;
  let rateLimited = false;
  const processedProfiles = new Set();

  console.log(LOG, 'Content script loaded on', location.href);

  // Initial DOM scan for debugging
  setTimeout(() => {
    const allButtons = document.querySelectorAll('button, a');
    const connectish = [];
    for (const el of allButtons) {
      const text = el.textContent.trim();
      if (text === 'Vernetzen' || text === 'Connect') {
        connectish.push({ tag: el.tagName, text, aria: el.getAttribute('aria-label'), classes: el.className.substring(0, 80) });
      }
    }
    console.log(LOG, 'DOM scan: found', connectish.length, '"Vernetzen"/"Connect" buttons:', connectish);
    const dvn = document.querySelectorAll('[data-view-name="edge-creation-connect-action"]');
    console.log(LOG, 'DOM scan: found', dvn.length, 'elements with data-view-name="edge-creation-connect-action"');
  }, 2000);

  // Visual debug badge
  const badge = document.createElement('div');
  badge.id = 'lc-badge';
  badge.style.cssText = 'position:fixed;bottom:10px;right:10px;z-index:99999;background:#333;color:#fff;padding:6px 12px;border-radius:8px;font:12px sans-serif;opacity:0.9;pointer-events:none;transition:background 0.3s';
  badge.textContent = 'LC: bereit';
  document.body.appendChild(badge);

  function updateBadge(text, color) {
    badge.textContent = 'LC: ' + text;
    badge.style.background = color || '#333';
  }

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
    // Must be "Vernetzen" or "Connect", NOT "Ausstehend", "Nachricht", "Folgen" etc.
    if (text === 'Vernetzen' || text === 'Connect') return true;
    return false;
  }

  function findNextConnect() {
    // Strategy 1: data-view-name attribute
    const dvn = document.querySelectorAll('[data-view-name="edge-creation-connect-action"] a, [data-view-name="edge-creation-connect-action"] button');
    for (const el of dvn) {
      if (!isConnectButton(el)) continue;
      if (el.closest('[role="dialog"], .artdeco-modal, dialog')) continue;
      // Check by profile ID instead of data attribute (survives DOM replacement)
      const pid = getProfileId(el);
      if (pid && processedProfiles.has(pid)) continue;
      return el;
    }

    // Strategy 2: Find buttons/links by visible text "Vernetzen"/"Connect"
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

  async function sendInvitation(profileId, name) {
    const csrf = getCsrfToken();
    if (!csrf) {
      console.log(LOG, 'No CSRF token found');
      updateBadge('Kein CSRF Token!', '#c00');
      return 'error';
    }

    const urn = 'urn:li:fsd_profile:' + profileId;
    console.log(LOG, 'Sending invitation to', name, '(' + urn + ')');
    updateBadge('Sende an ' + name.substring(0, 20) + '...', '#0a66c2');

    try {
      const resp = await fetch('/voyager/api/voyagerRelationshipsDashMemberRelationships?action=verifyQuotaAndCreateV2&decorationId=com.linkedin.voyager.dash.deco.relationships.InvitationCreationResultWithInvitee-2', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'csrf-token': csrf,
          'x-restli-protocol-version': '2.0.0',
          'content-type': 'application/json; charset=UTF-8'
        },
        body: JSON.stringify({
          invitee: {
            inviteeUnion: {
              memberProfile: urn
            }
          }
        })
      });

      if (resp.ok) {
        console.log(LOG, 'Invitation sent to', name);
        return 'ok';
      } else {
        const text = await resp.text().catch(() => '');
        console.log(LOG, 'Invitation failed:', resp.status, text.substring(0, 200));
        if (resp.status === 429) return 'rate_limited';
        return 'error';
      }
    } catch (err) {
      console.log(LOG, 'Invitation error:', err.message);
      return 'error';
    }
  }

  function realClick(el) {
    ['mousedown', 'mouseup', 'click'].forEach(type => {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    });
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

  async function clickFallback(connectLink, name) {
    console.log(LOG, 'Using click fallback for', name);
    updateBadge('Klicke ' + name.substring(0, 20) + '...', '#0a66c2');
    realClick(connectLink);

    // Wait for either: confirm dialog, or button text change to "Ausstehend"/"Pending"
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise(r => setTimeout(r, 300));

      // Check for confirm dialog
      const confirmBtn = findConfirmButton();
      if (confirmBtn) {
        console.log(LOG, 'Found confirm button, clicking');
        realClick(confirmBtn);
        return true;
      }

      // Check if button changed to "Ausstehend"/"Pending" (= success without dialog)
      const newText = connectLink.textContent.trim();
      if (newText.includes('Ausstehend') || newText.includes('Pending')) {
        console.log(LOG, 'Button changed to "Ausstehend" — invitation sent!');
        return true;
      }

      // Also check if parent container now shows "Ausstehend"
      const parent = connectLink.closest('[data-view-name="edge-creation-connect-action"]');
      if (parent) {
        const parentText = parent.textContent.trim();
        if (parentText.includes('Ausstehend') || parentText.includes('Pending')) {
          console.log(LOG, 'Container changed to "Ausstehend" — invitation sent!');
          return true;
        }
      }
    }

    console.log(LOG, 'No confirm dialog or state change for', name);
    updateBadge('Kein Dialog: ' + name.substring(0, 20), '#c00');
    return false;
  }

  async function tick() {
    if (!active || pending) return;

    if (rateLimited) {
      updateBadge('Rate-Limit! Warte...', '#c00');
      return;
    }

    // First: check if there's an open confirm dialog to handle
    const confirmBtn = findConfirmButton();
    if (confirmBtn) {
      console.log(LOG, 'Found open confirm dialog, clicking');
      realClick(confirmBtn);
      return;
    }

    const connectLink = findNextConnect();
    if (!connectLink) {
      updateBadge('Aktiv - keine Buttons', '#555');
      return;
    }

    const name = connectLink.getAttribute('aria-label') || connectLink.textContent.trim() || 'Unknown';
    const profileId = getProfileId(connectLink);

    // Track by profile ID to survive DOM replacement
    if (profileId) processedProfiles.add(profileId);

    pending = true;
    let ok = false;

    if (profileId) {
      console.log(LOG, 'Found profileId:', profileId, 'for', name);
      const result = await sendInvitation(profileId, name);

      if (result === 'ok') {
        ok = true;
      } else if (result === 'rate_limited') {
        console.log(LOG, 'Rate limited by LinkedIn! Pausing for 60s...');
        updateBadge('Rate-Limit! 60s Pause...', '#c00');
        rateLimited = true;
        setTimeout(() => {
          rateLimited = false;
          console.log(LOG, 'Rate limit pause ended, resuming');
          updateBadge('Aktiv (' + count + ' gesendet)', '#2e7d32');
        }, 60000);
        pending = false;
        return;
      } else {
        // API error (not rate limit) — try click fallback
        console.log(LOG, 'API failed, trying click fallback');
        ok = await clickFallback(connectLink, name);
      }
    } else {
      console.log(LOG, 'No profile ID found, using click fallback for', name);
      ok = await clickFallback(connectLink, name);
    }

    pending = false;

    if (ok) {
      count++;
      chrome.storage.local.set({ lcCount: count });
      console.log(LOG, 'Request #' + count + ' sent to', name);
      updateBadge('#' + count + ' ' + name.substring(0, 20), '#2e7d32');

      connectLink.style.opacity = '0.5';
      connectLink.style.pointerEvents = 'none';
    }
  }

  function start() {
    if (intervalId) return;
    active = true;
    pending = false;
    rateLimited = false;
    intervalId = setInterval(tick, 1500);
    updateBadge('Aktiv (' + count + ' gesendet)', '#2e7d32');
    console.log(LOG, 'Started - scanning every 1.5s');
  }

  function stop() {
    active = false;
    pending = false;
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    updateBadge('Pausiert (' + count + ' gesendet)', '#333');
    console.log(LOG, 'Stopped');
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    console.log(LOG, 'Received message:', msg);
    if (msg.action === 'toggle') {
      if (msg.enabled) start(); else stop();
      sendResponse({ ok: true });
    } else if (msg.action === 'getStatus') {
      sendResponse({ active, count });
    } else if (msg.action === 'resetCount') {
      count = 0;
      chrome.storage.local.set({ lcCount: 0 });
      sendResponse({ ok: true });
    }
  });

  chrome.storage.local.get(['lcCount'], (result) => {
    if (result.lcCount) count = result.lcCount;
  });
})();
