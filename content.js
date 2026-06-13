(() => {
  const LOG = '[LC]';
  const {
    getCsrfToken, getProfileId, findNextConnect, findConfirmButton, realClick,
    buildInviteRequest, isUsableRecipe, DEFAULT_INVITE_RECIPE
  } = window.LC;
  let active = false;
  let intervalId = null;
  let count = 0;
  let pending = false;
  let rateLimited = false;
  let learnedRecipe = null; // self-healed invite recipe captured from a live request
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
  badge.textContent = '🕸️ ready';
  document.body.appendChild(badge);

  function updateBadge(text, color) {
    badge.textContent = '🕸️ ' + text;
    badge.style.background = color || '#333';
  }

  // --- Self-healing: learn the live invite request from the MAIN-world interceptor
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== 'lc-interceptor' || data.type !== 'invite-captured') return;
    const recipe = data.recipe;
    if (!isUsableRecipe(recipe)) return;
    const isNew = !learnedRecipe || learnedRecipe.url !== recipe.url || learnedRecipe.body !== recipe.body;
    learnedRecipe = recipe;
    chrome.storage.local.set({ lcRecipe: recipe });
    if (isNew) {
      console.log(LOG, 'Learned invite recipe from live request:', recipe.url);
      updateBadge('🧬 Recipe learned', '#6a1b9a');
    }
  });

  // Try one recipe. Returns 'ok' | 'rate_limited' | 'error'.
  async function trySendWithRecipe(recipe, profileId) {
    const csrf = getCsrfToken();
    if (!csrf) {
      console.log(LOG, 'No CSRF token found');
      updateBadge('❌ No CSRF Token!', '#c00');
      return 'error';
    }
    const req = buildInviteRequest(recipe, profileId, csrf);
    if (!req) return 'error';

    try {
      const resp = await fetch(req.url, {
        method: req.method,
        credentials: 'include',
        headers: req.headers,
        body: req.body
      });
      if (resp.ok) return 'ok';
      const text = await resp.text().catch(() => '');
      console.log(LOG, 'Invitation failed:', resp.status, text.substring(0, 200));
      if (resp.status === 429) return 'rate_limited';
      return 'error';
    } catch (err) {
      console.log(LOG, 'Invitation error:', err.message);
      return 'error';
    }
  }

  // Send via API, preferring the self-healed recipe, then the built-in default.
  async function sendInvitation(profileId, name) {
    const urn = 'urn:li:fsd_profile:' + profileId;
    console.log(LOG, 'Sending invitation to', name, '(' + urn + ')');
    updateBadge('⏳ ' + name.substring(0, 20) + '...', '#0a66c2');

    const attempts = [];
    if (learnedRecipe) attempts.push({ recipe: learnedRecipe, learned: true });
    attempts.push({ recipe: DEFAULT_INVITE_RECIPE, learned: false });

    for (const { recipe, learned } of attempts) {
      const result = await trySendWithRecipe(recipe, profileId);
      if (result === 'ok') {
        console.log(LOG, 'Invitation sent to', name, learned ? '(learned recipe)' : '(default recipe)');
        return 'ok';
      }
      if (result === 'rate_limited') return 'rate_limited';
      // A learned recipe that errors is probably stale — discard it so the next
      // click fallback re-teaches us a fresh one.
      if (learned) {
        console.log(LOG, 'Learned recipe failed — discarding to re-learn');
        learnedRecipe = null;
        chrome.storage.local.remove('lcRecipe');
      }
    }
    return 'error';
  }

  async function clickFallback(connectLink, name) {
    console.log(LOG, 'Using click fallback for', name);
    updateBadge('⏳ ' + name.substring(0, 20) + '...', '#0a66c2');
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
    updateBadge('❌ ' + name.substring(0, 20), '#c00');
    return false;
  }

  async function tick() {
    if (!active || pending) return;

    if (rateLimited) {
      updateBadge('❌ Rate-Limit! Waiting...', '#c00');
      return;
    }

    // First: check if there's an open confirm dialog to handle
    const confirmBtn = findConfirmButton();
    if (confirmBtn) {
      console.log(LOG, 'Found open confirm dialog, clicking');
      realClick(confirmBtn);
      return;
    }

    const connectLink = findNextConnect(processedProfiles);
    if (!connectLink) {
      updateBadge('✅ Active - no buttons', '#555');
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
        updateBadge('❌ Rate-Limit! 60s pause...', '#c00');
        rateLimited = true;
        setTimeout(() => {
          rateLimited = false;
          console.log(LOG, 'Rate limit pause ended, resuming');
          updateBadge('✅ Active (' + count + ' sent)', '#2e7d32');
        }, 60000);
        pending = false;
        return;
      } else {
        // API error (not rate limit) — try click fallback. This also triggers
        // LinkedIn's own request, which the interceptor captures to self-heal.
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
      updateBadge('✅ #' + count + ' ' + name.substring(0, 20), '#2e7d32');

      // Replace button with 🍻 emoji
      const emojiSpan = document.createElement('span');
      emojiSpan.textContent = '🍻';
      emojiSpan.style.cssText = 'font-size:20px;cursor:default;';
      emojiSpan.setAttribute('data-lc-processed', 'true');
      connectLink.replaceWith(emojiSpan);
    }
  }

  function start() {
    if (intervalId) return;
    active = true;
    pending = false;
    rateLimited = false;
    intervalId = setInterval(tick, 1500);
    updateBadge('✅ Active (' + count + ' sent)', '#2e7d32');
    console.log(LOG, 'Started - scanning every 1.5s');
  }

  function stop() {
    active = false;
    pending = false;
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    updateBadge('❌ Paused (' + count + ' sent)', '#333');
    console.log(LOG, 'Stopped');
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    console.log(LOG, 'Received message:', msg);
    if (msg.action === 'toggle') {
      if (msg.enabled) start(); else stop();
      sendResponse({ ok: true });
    } else if (msg.action === 'getStatus') {
      sendResponse({ active, count, healed: !!learnedRecipe });
    } else if (msg.action === 'resetCount') {
      count = 0;
      chrome.storage.local.set({ lcCount: 0 });
      sendResponse({ ok: true });
    }
  });

  chrome.storage.local.get(['lcCount', 'lcRecipe'], (result) => {
    if (result.lcCount) count = result.lcCount;
    if (result.lcRecipe && isUsableRecipe(result.lcRecipe)) {
      learnedRecipe = result.lcRecipe;
      console.log(LOG, 'Restored learned invite recipe from storage');
    }
  });
})();
