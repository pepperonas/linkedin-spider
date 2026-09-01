(() => {
  const LOG = '[LC]';
  const {
    getCsrfToken, getProfileId, getVanityFromCard, findNextConnect, findConfirmButton,
    realClick, buildInviteRequest, isUsableRecipe, DEFAULT_INVITE_RECIPE, MAX_CLICK_FAILS,
    extractCardInfo, buildRecord, appendRecord, profileIdsFromLog, LOG_CAP,
    appendEvent, backfillEvents, weekQuota
  } = window.LC;
  let active = false;
  let intervalId = null;
  let count = 0;
  let pending = false;
  let rateLimited = false;
  let learnedRecipe = null; // self-healed invite recipe captured from a live request
  let stuckDialogTicks = 0; // consecutive ticks a confirm dialog refused to close
  let contextGone = false;  // the extension was reloaded out from under this page
  const processedProfiles = new Set();
  const vanityCache = new Map(); // vanity name -> resolved fsd_profile ID (or null)

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

  // The badge keeps the weekly allowance in view while requests are going out —
  // that is exactly when it matters. Text and quota are tracked separately so a
  // quota refresh never wipes the state message and vice versa.
  let badgeText = 'ready';
  let badgeColor = '#333';
  let quotaSuffix = '';

  function renderBadge() {
    badge.textContent = '🕸️ ' + badgeText + (quotaSuffix ? ' · ' + quotaSuffix : '');
    badge.style.background = badgeColor;
  }

  function updateBadge(text, color) {
    // Once we have given up, the reload notice is the only thing worth showing:
    // a later "sent" message would paint over the one line that explains why
    // nothing is being recorded any more.
    if (contextGone) return;
    badgeText = text;
    badgeColor = color || '#333';
    renderBadge();
  }

  function setQuotaFromEvents(events) {
    const q = weekQuota(events, Date.now());
    quotaSuffix = q.used + '/' + q.limit + ' wk';
    renderBadge();
  }

  // --- Surviving an extension reload ---------------------------------------
  // Updating or reloading the extension orphans the content script already
  // running in an open tab: it keeps executing, but every chrome.* call throws
  // "Extension context invalidated". Until now that killed the run silently —
  // no sends, no log entries, an unchanged badge, and a popup that could not
  // reach the tab. The only cure is reloading the page, so say exactly that.
  function contextLost() {
    return contextGone || !(chrome.runtime && chrome.runtime.id);
  }

  function giveUp(why) {
    if (contextGone) return;
    contextGone = true;
    active = false;
    if (intervalId) { clearInterval(intervalId); intervalId = null; }
    badgeText = '⚠️ Reload this page';
    badgeColor = '#c00';
    quotaSuffix = '';
    try { renderBadge(); } catch (e) { /* page torn down too */ }
    console.log(LOG, 'Extension context is gone (' + why + ') — reload the page to continue');
  }

  function storageGet(keys, cb) {
    if (contextLost()) { giveUp('get'); return; }
    try {
      chrome.storage.local.get(keys, (res) => {
        if (chrome.runtime && chrome.runtime.lastError) { giveUp('get callback'); return; }
        cb(res || {});
      });
    } catch (e) {
      giveUp('get: ' + e.message);
    }
  }

  function storageSet(obj) {
    if (contextLost()) { giveUp('set'); return; }
    try {
      chrome.storage.local.set(obj);
    } catch (e) {
      giveUp('set: ' + e.message);
    }
  }

  function storageRemove(key) {
    if (contextLost()) { giveUp('remove'); return; }
    try { chrome.storage.local.remove(key); } catch (e) { giveUp('remove: ' + e.message); }
  }

  // --- 🍻 Beer-emoji success marker: Material 3 Expressive motion ---------------
  // A "spatial spring" drop with gravity acceleration, an impact squash & stretch,
  // and decaying bounces that overshoot and settle into place (M3 Expressive).
  function injectStyles() {
    if (document.getElementById('lc-styles')) return;
    const style = document.createElement('style');
    style.id = 'lc-styles';
    style.textContent = `
@keyframes lc-beer-drop {
  /* fall — accelerating under gravity (ease-in) */
  0%   { transform: translateY(-56px) scale(.5) rotate(-22deg); opacity: 0;
         animation-timing-function: cubic-bezier(.55,0,.95,.4); }
  /* impact — hard squash onto the baseline */
  38%  { transform: translateY(0) scaleX(1.3) scaleY(.7) rotate(4deg); opacity: 1;
         animation-timing-function: cubic-bezier(.2,.7,.3,1); }
  /* rebound up — stretch (spring overshoot) */
  55%  { transform: translateY(-18px) scaleX(.85) scaleY(1.18) rotate(-6deg);
         animation-timing-function: cubic-bezier(.5,0,.9,.45); }
  /* second landing — softer squash (damping) */
  70%  { transform: translateY(0) scaleX(1.15) scaleY(.9) rotate(3deg);
         animation-timing-function: cubic-bezier(.2,.7,.3,1); }
  /* small hop */
  82%  { transform: translateY(-6px) scaleX(.96) scaleY(1.05) rotate(-1deg);
         animation-timing-function: cubic-bezier(.5,0,.9,.45); }
  91%  { transform: translateY(0) scaleX(1.05) scaleY(.97);
         animation-timing-function: cubic-bezier(.3,.6,.4,1); }
  100% { transform: translateY(0) scale(1) rotate(0); opacity: 1; }
}
/* impact shockwave ring — amber, expands once on landing */
@keyframes lc-beer-shock {
  0%   { transform: translate(-50%,-50%) scale(.25); opacity: .55; }
  100% { transform: translate(-50%,-50%) scale(2.8); opacity: 0; }
}
/* hover — gentle "clink" wobble pivoting from the base */
@keyframes lc-beer-clink {
  0%,100% { transform: rotate(0) scale(1); }
  25%     { transform: rotate(-9deg) scale(1.1); }
  50%     { transform: rotate(0) scale(1.05); }
  75%     { transform: rotate(9deg) scale(1.1); }
}
.lc-beer {
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 20px; line-height: 1; cursor: default; position: relative;
  transform-origin: 50% 100%; will-change: transform;
  animation: lc-beer-drop .9s both;
}
.lc-beer::after {
  content: ''; position: absolute; left: 50%; top: 62%;
  width: 24px; height: 24px; border-radius: 50%;
  border: 2px solid rgba(255,193,7,.85);
  transform: translate(-50%,-50%) scale(.25);
  animation: lc-beer-shock .6s .3s ease-out both;
  pointer-events: none;
}
.lc-beer:hover { animation: lc-beer-clink 1.5s ease-in-out infinite; }
/* Custom M3 Expressive tooltip (fixed-positioned to escape overflow clipping) */
.lc-tip {
  position: fixed; z-index: 100000; max-width: 260px; box-sizing: border-box;
  background: linear-gradient(135deg,#3a2e16,#241c0d);
  color: #ffe7b3; font: 600 12.5px/1.4 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;
  letter-spacing: .1px; padding: 10px 14px; border-radius: 14px;
  border: 1px solid rgba(255,193,7,.28);
  box-shadow: 0 10px 30px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.06);
  pointer-events: none; opacity: 0;
  transform: translateY(6px) scale(.86); transform-origin: 50% 120%;
  transition: opacity .18s ease, transform .36s cubic-bezier(.2,1.35,.4,1);
}
.lc-tip.lc-tip-show { opacity: 1; transform: translateY(0) scale(1); }
.lc-tip::after {
  content: ''; position: absolute; left: var(--lc-caret,50%); bottom: -6px;
  width: 12px; height: 12px; background: #241c0d;
  border-right: 1px solid rgba(255,193,7,.28);
  border-bottom: 1px solid rgba(255,193,7,.28);
  transform: translateX(-50%) rotate(45deg);
}
.lc-tip.lc-tip-below { transform-origin: 50% -20%; }
.lc-tip.lc-tip-below::after {
  bottom: auto; top: -6px; background: #3a2e16;
  border: 0; border-left: 1px solid rgba(255,193,7,.28);
  border-top: 1px solid rgba(255,193,7,.28);
}
@media (prefers-reduced-motion: reduce) {
  .lc-beer, .lc-beer:hover { animation: none !important; }
  .lc-beer::after { display: none; }
  .lc-tip { transition: opacity .12s ease; transform: none; }
  .lc-tip.lc-tip-show { transform: none; }
}
`;
    (document.head || document.documentElement).appendChild(style);
  }

  let tipEl = null;
  function showTip(target) {
    if (!tipEl) {
      tipEl = document.createElement('div');
      tipEl.className = 'lc-tip';
      tipEl.textContent = '🍻 Networking, bottled and served by LinkedIn Spider';
      document.body.appendChild(tipEl);
    }
    const r = target.getBoundingClientRect();
    tipEl.classList.add('lc-tip-show');
    const tr = tipEl.getBoundingClientRect();
    let left = r.left + r.width / 2 - tr.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tr.width - 8));
    let top = r.top - tr.height - 10;
    const below = top < 8;
    if (below) top = r.bottom + 10;
    tipEl.classList.toggle('lc-tip-below', below);
    tipEl.style.left = left + 'px';
    tipEl.style.top = top + 'px';
    tipEl.style.setProperty('--lc-caret', (r.left + r.width / 2 - left) + 'px');
  }
  function hideTip() {
    if (tipEl) tipEl.classList.remove('lc-tip-show');
  }

  function makeBeerEmoji() {
    injectStyles();
    const span = document.createElement('span');
    span.className = 'lc-beer';
    span.textContent = '🍻';
    span.setAttribute('data-lc-processed', 'true');
    span.setAttribute('role', 'img');
    span.setAttribute('aria-label', 'Connection request sent');
    span.addEventListener('mouseenter', () => showTip(span));
    span.addEventListener('mouseleave', hideTip);
    return span;
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
    storageSet({ lcRecipe: recipe });
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
        storageRemove('lcRecipe');
      }
    }
    return 'error';
  }

  // Cards without a profile URN in the DOM: resolve the fsd_profile ID from the
  // card's /in/<vanity> link via a Voyager profile lookup. This keeps such cards
  // on the direct API path — no click fallback, no invite overlay needed.
  async function resolveProfileIdByVanity(vanity) {
    if (vanityCache.has(vanity)) return vanityCache.get(vanity);
    let id = null;
    try {
      const res = await fetch(
        '/voyager/api/identity/dash/profiles?q=memberIdentity&memberIdentity=' +
          encodeURIComponent(vanity),
        {
          method: 'GET',
          headers: {
            'csrf-token': getCsrfToken(),
            'x-restli-protocol-version': '2.0.0',
            accept: 'application/vnd.linkedin.normalized+json+2.1'
          },
          credentials: 'include'
        }
      );
      if (res.ok) {
        const text = await res.text();
        const m = text.match(/urn:li:fsd_profile:([A-Za-z0-9_=-]+)/);
        if (m) id = m[1];
      }
    } catch (e) { /* network error — fall back to click */ }
    console.log(LOG, 'Vanity lookup', vanity, '→', id || 'not resolved');
    vanityCache.set(vanity, id);
    return id;
  }

  // Clicks the confirm button and verifies the dialog actually closed
  // (retries the click a few times — a single synthetic click can get lost).
  async function confirmAndVerify() {
    for (let round = 0; round < 3; round++) {
      const confirmBtn = findConfirmButton();
      if (!confirmBtn) return true; // dialog gone = confirmed (or never opened)
      console.log(LOG, 'Found confirm button, clicking (round ' + (round + 1) + ')');
      realClick(confirmBtn);
      for (let i = 0; i < 5; i++) {
        await new Promise(r => setTimeout(r, 300));
        if (!findConfirmButton()) return true;
      }
    }
    console.log(LOG, 'Confirm dialog would not close');
    return false;
  }

  async function clickFallback(connectLink, name) {
    console.log(LOG, 'Using click fallback for', name);
    updateBadge('⏳ ' + name.substring(0, 20) + '...', '#0a66c2');
    realClick(connectLink);

    // Wait for either: confirm dialog, or button text change to "Ausstehend"/"Pending"
    // (20 x 300ms — heavy search pages can take several seconds to open the dialog)
    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise(r => setTimeout(r, 300));

      // Check for confirm dialog
      if (findConfirmButton()) {
        return await confirmAndVerify();
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

    // Nothing happened at all: LinkedIn ignored the click. Count the failure on
    // the element itself — after LC.MAX_CLICK_FAILS tries findNextConnect skips
    // it, so one broken card can't wedge the whole run.
    const fails = (parseInt(connectLink.getAttribute('data-lc-fails'), 10) || 0) + 1;
    connectLink.setAttribute('data-lc-fails', String(fails));
    console.log(LOG, 'No confirm dialog or state change for', name, '(fail ' + fails + '/' + MAX_CLICK_FAILS + ')');
    updateBadge('❌ ' + name.substring(0, 20), '#c00');
    return false;
  }

  // Persist one sent request: the contact record AND a bare timestamp.
  // The timestamp series is what the weekly quota and the chart count — the
  // contact log is deduplicated, capped and user-clearable, so counting it
  // would under-report what LinkedIn actually saw.
  // Both are re-read immediately before writing so a second LinkedIn tab's
  // entries aren't clobbered by a stale in-memory copy.
  function recordSuccess(cardInfo, profileId, method) {
    const record = buildRecord(cardInfo, {
      profileId: profileId || '',
      method,
      pageUrl: location.href
    });
    const when = Date.parse(record.ts);
    storageGet(['lcLog', 'lcEvents'], (res) => {
      const events = appendEvent(res.lcEvents, when);
      storageSet({
        lcLog: appendRecord(res.lcLog, record, LOG_CAP),
        lcEvents: events
      });
      setQuotaFromEvents(events);
    });
    console.log(LOG, 'Logged contact:', record.name || '(no name)', record.profileUrl);
  }

  async function tick() {
    if (!active || pending) return;
    if (contextLost()) { giveUp('tick'); return; }

    if (rateLimited) {
      updateBadge('❌ Rate-Limit! Waiting...', '#c00');
      return;
    }

    // First: check if there's an open confirm dialog to handle
    const confirmBtn = findConfirmButton();
    if (confirmBtn) {
      stuckDialogTicks++;
      if (stuckDialogTicks > 5) {
        // Confirm click isn't registering — dismiss the modal so the run
        // doesn't stall on it forever.
        console.log(LOG, 'Confirm dialog stuck, dismissing it');
        const dismiss = document.querySelector(
          '[data-test-modal-close-btn], .artdeco-modal__dismiss, ' +
          'button[aria-label="Verwerfen"], button[aria-label="Dismiss"]'
        );
        if (dismiss) realClick(dismiss);
        stuckDialogTicks = 0;
        return;
      }
      console.log(LOG, 'Found open confirm dialog, clicking');
      realClick(confirmBtn);
      return;
    }
    stuckDialogTicks = 0;

    const connectLink = findNextConnect(processedProfiles);
    if (!connectLink) {
      updateBadge('✅ Active - no buttons', '#555');
      return;
    }

    const name = connectLink.getAttribute('aria-label') || connectLink.textContent.trim() || 'Unknown';
    pending = true;
    let ok = false;
    let method = '';

    // Snapshot the card BEFORE sending — on success LinkedIn swaps the card
    // markup out, and then there is nothing left to read about this person.
    const cardInfo = extractCardInfo(connectLink);

    let profileId = getProfileId(connectLink);

    // No URN in the DOM? Resolve it from the card's /in/<vanity> profile link so
    // this card still takes the API path instead of the fragile click fallback.
    if (!profileId) {
      const vanity = getVanityFromCard(connectLink);
      if (vanity) {
        profileId = await resolveProfileIdByVanity(vanity);
      }
    }

    // Vanity-resolved cards can't be filtered inside findNextConnect (no URN in
    // the DOM) — if this person was already handled, just mark the button.
    if (profileId && processedProfiles.has(profileId)) {
      console.log(LOG, 'Already processed', name, '— marking without re-sending');
      connectLink.replaceWith(makeBeerEmoji());
      pending = false;
      return;
    }

    // Track by profile ID to survive DOM replacement
    if (profileId) processedProfiles.add(profileId);

    if (profileId) {
      console.log(LOG, 'Found profileId:', profileId, 'for', name);
      const result = await sendInvitation(profileId, name);

      if (result === 'ok') {
        ok = true;
        method = 'api';
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
        if (ok) method = 'click';
      }
    } else {
      console.log(LOG, 'No profile ID found, using click fallback for', name);
      ok = await clickFallback(connectLink, name);
      if (ok) method = 'click';
    }

    pending = false;

    if (ok) {
      count++;
      storageSet({ lcCount: count });
      recordSuccess(cardInfo, profileId, method);
      console.log(LOG, 'Request #' + count + ' sent to', name);
      updateBadge('✅ #' + count + ' ' + name.substring(0, 20), '#2e7d32');

      // Replace button with an animated 🍻 emoji (M3 Expressive drop + bounce)
      connectLink.replaceWith(makeBeerEmoji());
    }
  }

  function start() {
    if (intervalId) return;
    if (contextLost()) { giveUp('start'); return; }
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
      sendResponse({ active, count, healed: !!learnedRecipe, contextGone });
    } else if (msg.action === 'resetCount') {
      count = 0;
      storageSet({ lcCount: 0 });
      sendResponse({ ok: true });
    } else if (msg.action === 'reloadState') {
      // A restore rewrote storage under us — pull the new state into memory so
      // this tab doesn't keep running on the pre-restore counters.
      storageGet(['lcCount', 'lcRecipe', 'lcLog', 'lcEvents'], applyStoredState);
      sendResponse({ ok: true });
    } else if (msg.action === 'clearLog') {
      // Also drop the in-memory guard, otherwise the popup would clear the log
      // while this tab silently keeps skipping the very people it just forgot.
      processedProfiles.clear();
      storageSet({ lcLog: [] });
      sendResponse({ ok: true });
    }
  });

  function applyStoredState(result) {
    count = result.lcCount || 0;
    if (result.lcRecipe && isUsableRecipe(result.lcRecipe)) {
      learnedRecipe = result.lcRecipe;
      console.log(LOG, 'Restored learned invite recipe from storage');
    }
    // Cross-session duplicate guard: nobody already in the log gets asked twice.
    const known = profileIdsFromLog(result.lcLog);
    for (const id of known) processedProfiles.add(id);
    if (known.size) console.log(LOG, 'Skipping', known.size, 'already-contacted profiles');

    // First run after the upgrade: seed the quota history from the timestamps
    // already in the contact log. Keyed on "undefined", not on "empty" — an
    // empty series is a real state (log cleared) and must not be re-seeded.
    let events = result.lcEvents;
    if (events === undefined) {
      events = backfillEvents(result.lcLog);
      storageSet({ lcEvents: events });
      if (events.length) console.log(LOG, 'Seeded quota history with', events.length, 'past requests');
    }
    setQuotaFromEvents(events);
  }

  storageGet(['lcCount', 'lcRecipe', 'lcLog', 'lcEvents'], applyStoredState);
})();
