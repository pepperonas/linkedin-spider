(() => {
  const LOG = '[LC]';
  let active = false;
  let intervalId = null;
  let count = 0;
  let pending = false;

  const API_URL = '/voyager/api/voyagerRelationshipsDashMemberRelationships?action=verifyQuotaAndCreateV2&decorationId=com.linkedin.voyager.dash.deco.relationships.InvitationCreationResultWithInvitee-2';

  console.log(LOG, 'Content script loaded on', location.href);

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
    for (let i = 0; i < 15 && el; i++) {
      const key = el.getAttribute('componentkey');
      if (key && key.startsWith('SearchResults')) {
        return key.slice('SearchResults'.length);
      }
      el = el.parentElement;
    }
    return null;
  }

  function findNextConnect() {
    const links = document.querySelectorAll('[data-view-name="edge-creation-connect-action"] a');
    for (const a of links) {
      if (a.dataset.lcProcessed) continue;
      return a;
    }
    const inviteLinks = document.querySelectorAll('a[aria-label$="einladen"]');
    for (const a of inviteLinks) {
      if (a.dataset.lcProcessed) continue;
      if (a.closest('[role="dialog"], .artdeco-modal, dialog')) continue;
      return a;
    }
    return null;
  }

  async function sendInvitation(profileId, name) {
    const csrf = getCsrfToken();
    if (!csrf) {
      console.log(LOG, 'No CSRF token found');
      updateBadge('Kein CSRF Token!', '#c00');
      return false;
    }

    const urn = 'urn:li:fsd_profile:' + profileId;
    console.log(LOG, 'Sending invitation to', name, '(' + urn + ')');
    updateBadge('Sende an ' + name.substring(0, 20) + '...', '#0a66c2');

    try {
      const resp = await fetch(API_URL, {
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
        updateBadge('#' + (count + 1) + ' ' + name.substring(0, 20), '#2e7d32');
        return true;
      } else {
        const text = await resp.text().catch(() => '');
        console.log(LOG, 'Invitation failed:', resp.status, text.substring(0, 200));
        updateBadge('Fehler ' + resp.status, '#c00');
        return false;
      }
    } catch (err) {
      console.log(LOG, 'Invitation error:', err.message);
      updateBadge('Fehler: ' + err.message.substring(0, 30), '#c00');
      return false;
    }
  }

  async function tick() {
    if (!active || pending) return;

    const connectLink = findNextConnect();
    if (!connectLink) {
      console.log(LOG, 'No connect buttons found this tick');
      updateBadge('Aktiv - keine Buttons', '#555');
      return;
    }

    const name = connectLink.getAttribute('aria-label') || 'Unknown';
    const profileId = getProfileId(connectLink);

    connectLink.dataset.lcProcessed = 'true';

    if (!profileId) {
      console.log(LOG, 'Could not find profile ID for', name);
      updateBadge('Keine Profil-ID: ' + name.substring(0, 20), '#c00');
      return;
    }

    pending = true;
    const ok = await sendInvitation(profileId, name);
    pending = false;

    if (ok) {
      count++;
      chrome.storage.local.set({ lcCount: count });
      console.log(LOG, 'Request #' + count + ' sent to', name);

      const span = connectLink.querySelector('span');
      if (span) span.textContent = 'Gesendet';
      connectLink.style.opacity = '0.5';
      connectLink.style.pointerEvents = 'none';
    }
  }

  function start() {
    if (intervalId) return;
    active = true;
    pending = false;
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
