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
  // Kept for backwards compat / tests; matching uses SEND_WITHOUT_NOTE_RE.
  const SEND_WITHOUT_NOTE = [
    'Ohne Notiz senden',     // DE
    'Send without a note',   // EN
    'Enviar sin nota',       // ES
    'Invia senza nota',      // IT
    'Envoyer sans note',     // FR
    'Enviar sem nota'        // PT
  ];

  // LinkedIn A/B-tests the wording: "Notiz" vs "Nachricht" (DE), "note" vs
  // "message" (EN), etc. Match both variants, anchored so the sibling button
  // ("Nachricht senden" / "Send with a message") can never match.
  const SEND_WITHOUT_NOTE_RE = [
    /^ohne\s+(notiz|nachricht)\s+senden$/i,          // DE
    /^send\s+without\s+(a\s+)?(note|message)$/i,     // EN
    /^enviar\s+sin\s+(nota|mensaje)$/i,              // ES
    /^invia(?:re)?\s+senza\s+(nota|messaggio)$/i,    // IT
    /^envoyer\s+sans\s+(note|message)$/i,            // FR
    /^enviar\s+sem\s+(nota|mensagem)$/i,             // PT
    /^verzend(?:en)?\s+zonder\s+(notitie|bericht)$/i // NL
  ];

  function matchesSendWithoutNote(el) {
    const aria = (el.getAttribute('aria-label') || '').trim();
    const text = el.textContent.trim();
    return SEND_WITHOUT_NOTE_RE.some((re) => re.test(aria) || re.test(text));
  }

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

  // A connect element the click fallback failed on this many times is skipped,
  // so one broken card can't wedge the whole run (content.js bumps the count).
  const MAX_CLICK_FAILS = 3;

  function tooManyFails(el) {
    return (parseInt(el.getAttribute('data-lc-fails'), 10) || 0) >= MAX_CLICK_FAILS;
  }

  function findNextConnect(processedProfiles) {
    // Strategy 1: legacy data-view-name container (older LinkedIn UIs)
    const dvn = document.querySelectorAll('[data-view-name="edge-creation-connect-action"] a, [data-view-name="edge-creation-connect-action"] button');
    for (const el of dvn) {
      if (!isConnectButton(el)) continue;
      if (tooManyFails(el)) continue;
      if (el.closest('[role="dialog"], .artdeco-modal, dialog')) continue;
      const pid = getProfileId(el);
      if (pid && processedProfiles.has(pid)) continue;
      return el;
    }

    // Strategy 2: SDUI / generic — clickable elements matched by text, aria-label or href
    const candidates = document.querySelectorAll('a, button, [role="button"]');
    for (const el of candidates) {
      if (!isConnectButton(el)) continue;
      if (tooManyFails(el)) continue;
      if (el.closest('[role="dialog"], .artdeco-modal, dialog')) continue;
      const pid = getProfileId(el);
      if (pid && processedProfiles.has(pid)) continue;
      return el;
    }

    return null;
  }

  function findConfirmButton() {
    // 1. Inside known dialog containers: aria-label or text, any wording variant
    const modals = document.querySelectorAll('[role="dialog"], .artdeco-modal, dialog');
    for (const modal of modals) {
      const clickables = modal.querySelectorAll('button, a, [role="button"]');
      for (const btn of clickables) {
        if (matchesSendWithoutNote(btn)) return btn;
      }

      // send-invite modal → primary action button
      if (modal.classList.contains('send-invite') || modal.querySelector('.send-invite')) {
        const primary = modal.querySelector('.artdeco-button--primary');
        if (primary) return primary;
      }
    }

    // 2. SDUI fallback: newer dialogs aren't always marked role="dialog" /
    // .artdeco-modal. The "send without note/message" wording only ever
    // appears in this dialog, so a document-wide scan is safe.
    const all = document.querySelectorAll('button, a, [role="button"]');
    for (const btn of all) {
      if (matchesSendWithoutNote(btn)) return btn;
    }

    return null;
  }

  function realClick(el) {
    // LinkedIn's SDUI (React) components listen to *pointer* events; the legacy
    // Ember ones to mouse events. Dispatch a full pointer+mouse sequence with
    // real coordinates so both frameworks accept the click.
    let cx = 0, cy = 0;
    if (typeof el.getBoundingClientRect === 'function') {
      const r = el.getBoundingClientRect();
      cx = r.left + r.width / 2;
      cy = r.top + r.height / 2;
    }
    const base = {
      bubbles: true, cancelable: true, composed: true,
      view: (el.ownerDocument && el.ownerDocument.defaultView) || null,
      detail: 1, button: 0, clientX: cx, clientY: cy
    };
    const PE = typeof PointerEvent === 'function' ? PointerEvent : null;
    const fire = (Ctor, type, extra) => {
      const init = Object.assign({}, base, extra);
      let ev;
      try {
        ev = new Ctor(type, init);
      } catch (e) {
        // Some environments reject the `view` member — retry without it.
        delete init.view;
        ev = new Ctor(type, init);
      }
      el.dispatchEvent(ev);
    };
    const pointerInit = { pointerId: 1, pointerType: 'mouse', isPrimary: true };

    try { el.focus({ preventScroll: true }); } catch (e) { /* not focusable */ }
    if (PE) fire(PE, 'pointerover', pointerInit);
    if (PE) fire(PE, 'pointerdown', Object.assign({ buttons: 1 }, pointerInit));
    fire(MouseEvent, 'mousedown', { buttons: 1 });
    if (PE) fire(PE, 'pointerup', pointerInit);
    fire(MouseEvent, 'mouseup');
    fire(MouseEvent, 'click');
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

  // --- Contact log: card scraping + CSV export -----------------------------
  // Locale phrasings that wrap the person's name in the connect element's
  // aria-label. Capture group 1 is the bare name.
  const NAME_FROM_ARIA = [
    /^(.+?)\s+als\s+Kontakt\s+einladen$/i,               // DE
    /^Invite\s+(.+?)\s+to\s+connect$/i,                  // EN
    /^Se\s+mettre\s+en\s+relation\s+avec\s+(.+)$/i,      // FR
    /^Invitar\s+a\s+(.+?)\s+a\s+conectar$/i,             // ES
    /^Invita(?:re)?\s+(.+?)\s+a\s+collegar(?:si|ti)$/i   // IT
  ];

  // Trailing connection-degree marker: "· 2.", "• 3rd+", "· 1"
  const DEGREE_SUFFIX_RE = /\s*[·•∙]\s*\d\s*(?:\.|st|nd|rd|th)?\+?\s*$/i;

  // A card text line that is only the connection degree.
  const DEGREE_LINE_RE = /^[·•∙\s]*(\d)\s*(?:\.|st|nd|rd|th)?\+?(?:\s*(?:Grad(?:es)?|degree|Kontakt|contact|contatto|grado).*)?$/i;

  // Other action buttons and boilerplate that live in the same card and must
  // never be mistaken for a headline or a location.
  const CARD_ACTION_TEXTS = CONNECT_TEXTS.concat([
    'Folgen', 'Follow', 'Seguir', 'Suivre', 'Seguire', 'Volgen',
    'Nachricht', 'Message', 'Mensaje', 'Messaggio',
    'Ausstehend', 'Pending', 'Mehr', 'More'
  ]).map((t) => t.toLowerCase());

  const CARD_NOISE_RE = /^(?:\d+\s+)?(?:gemeinsame|mutual|shared)\b|^(?:status|online)$/i;

  // Connector between role and employer inside a headline.
  const HEADLINE_COMPANY_RE = /\s(?:bei|at|@|chez|presso|en)\s+(.+)$/i;

  const CSV_COLUMNS = [
    ['Datum', (r) => formatTimestamp(r.ts)],
    ['Name', (r) => r.name],
    ['Profil-URL', (r) => r.profileUrl],
    ['Headline', (r) => r.headline],
    ['Firma', (r) => r.company],
    ['Ort', (r) => r.location],
    ['Grad', (r) => r.degree],
    ['Profil-ID', (r) => r.profileId],
    ['Methode', (r) => r.method],
    ['Suchseite', (r) => r.pageUrl]
  ];

  // Keep the stored log bounded — chrome.storage.local has a hard quota and a
  // log this long already covers years of use at LinkedIn's invite limits.
  const LOG_CAP = 5000;

  function normalizeSpace(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  // Strip LinkedIn's invite phrasing and degree marker off an aria-label or a
  // card link text, leaving the person's name (or '' for a bare button label).
  function cleanName(raw) {
    let s = normalizeSpace(raw);
    if (!s) return '';
    for (const re of NAME_FROM_ARIA) {
      const m = s.match(re);
      if (m) { s = m[1].trim(); break; }
    }
    s = s.replace(DEGREE_SUFFIX_RE, '').trim();
    if (CARD_ACTION_TEXTS.includes(s.toLowerCase())) return '';
    return s;
  }

  // The card containing this connect element: the nearest ancestor whose /in/
  // links all point at ONE profile. Same rule as getVanityFromCard — a
  // container with several profiles is the result list, not a card.
  function findCardRoot(connectLink) {
    let el = connectLink;
    for (let i = 0; i < 20 && el; i++) {
      if (el.querySelectorAll) {
        const links = el.querySelectorAll('a[href*="/in/"]');
        if (links.length) {
          const vanities = new Set();
          for (const a of links) {
            const m = (a.getAttribute('href') || '').match(/\/in\/([^/?#]+)/);
            if (m) vanities.add(decodeURIComponent(m[1]));
          }
          if (vanities.size === 1) return { root: el, vanity: vanities.values().next().value };
          if (vanities.size > 1) return { root: null, vanity: null }; // ambiguous container
        }
      }
      el = el.parentElement;
    }
    return { root: null, vanity: null };
  }

  function getVanityFromCard(connectLink) {
    return findCardRoot(connectLink).vanity;
  }

  // Visible text of a subtree, one entry per element that owns text directly.
  // LinkedIn nests text in hashed-class <span>s and renders visually-hidden
  // duplicates, so leaf-level collection + dedupe is what survives its DOM.
  function textLines(root, skip) {
    const out = [];
    const seen = new Set();
    if (!root || !root.querySelectorAll) return out;
    const nodes = [root].concat(Array.from(root.querySelectorAll('*')));
    for (const node of nodes) {
      if (skip && skip.some((s) => s && s.contains && s.contains(node))) continue;
      let text = '';
      for (const child of node.childNodes) {
        if (child.nodeType === 3) text += child.nodeValue;
      }
      const line = normalizeSpace(text);
      if (!line || line.length > 300) continue;
      const key = line.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(line);
    }
    return out;
  }

  function firstLine(root, skip) {
    const lines = textLines(root, skip);
    return lines.length ? lines[0] : '';
  }

  // Best-effort read of everything the search result card shows about a person.
  // Every field degrades to '' — a LinkedIn DOM change empties a column, it
  // never breaks the send.
  function extractCardInfo(connectLink) {
    const info = { name: '', vanity: '', profileUrl: '', headline: '', company: '', location: '', degree: '' };
    if (!connectLink) return info;

    const ariaName = cleanName(connectLink.getAttribute && connectLink.getAttribute('aria-label'));
    const { root, vanity } = findCardRoot(connectLink);
    if (vanity) {
      info.vanity = vanity;
      info.profileUrl = 'https://www.linkedin.com/in/' + vanity;
    }
    if (!root) {
      info.name = ariaName;
      return info;
    }

    const profileLinks = Array.from(root.querySelectorAll('a[href*="/in/"]'))
      .filter((a) => a !== connectLink && !connectLink.contains(a) && !a.contains(connectLink));
    const companyLink = Array.from(root.querySelectorAll('a[href*="/company/"]'))
      .find((a) => a !== connectLink && !connectLink.contains(a));

    for (const a of profileLinks) {
      const candidate = cleanName(firstLine(a));
      if (candidate) { info.name = candidate; break; }
    }
    if (!info.name) info.name = ariaName;

    if (companyLink) info.company = firstLine(companyLink);

    const skip = [connectLink].concat(profileLinks, companyLink ? [companyLink] : []);
    const lines = textLines(root, skip).filter((line) => {
      if (CARD_ACTION_TEXTS.includes(line.toLowerCase())) return false;
      if (CARD_NOISE_RE.test(line)) return false;
      return true;
    });

    const rest = [];
    for (const line of lines) {
      const m = !info.degree && line.match(DEGREE_LINE_RE);
      if (m) info.degree = m[1] + '.';
      else rest.push(line);
    }

    info.headline = rest[0] || '';
    info.location = rest[1] || '';

    if (!info.company && info.headline) {
      const m = info.headline.match(HEADLINE_COMPANY_RE);
      if (m) info.company = m[1].trim();
    }

    return info;
  }

  // ISO timestamp → "DD.MM.YYYY HH:MM" in the user's own timezone.
  function formatTimestamp(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear() +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  // One CSV field: flattened, formula-guarded, quoted, inner quotes doubled.
  // The leading-quote guard matters — these are scraped names going into Excel.
  function csvCell(value) {
    let s = String(value == null ? '' : value).replace(/[\r\n\t]+/g, ' ').trim();
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }

  // Semicolon-separated + UTF-8 BOM: what German Excel opens into columns
  // without an import wizard. Plain parsers read it just as well.
  function toCsv(records) {
    const rows = [CSV_COLUMNS.map((c) => csvCell(c[0])).join(';')];
    for (const r of records || []) {
      const rec = r || {};
      rows.push(CSV_COLUMNS.map((c) => csvCell(c[1](rec))).join(';'));
    }
    return '﻿' + rows.join('\r\n');
  }

  function csvFilename(date) {
    const d = (date instanceof Date && !isNaN(date.getTime())) ? date : new Date();
    const p = (n) => String(n).padStart(2, '0');
    return 'linkedin-spider-anfragen-' +
      d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      '_' + p(d.getHours()) + p(d.getMinutes()) + '.csv';
  }

  // Append without mutating; skip a profile already logged; FIFO past the cap.
  function appendRecord(log, record, cap) {
    const list = Array.isArray(log) ? log.slice() : [];
    const limit = (typeof cap === 'number' && cap > 0) ? cap : LOG_CAP;
    const id = record && record.profileId;
    if (id && list.some((r) => r && r.profileId === id)) return list;
    list.push(record);
    return list.length > limit ? list.slice(list.length - limit) : list;
  }

  // Assemble one log entry: the card snapshot (taken BEFORE sending, LinkedIn
  // swaps the card out afterwards) plus what the send itself knows.
  function buildRecord(cardInfo, meta) {
    const c = cardInfo || {};
    const m = meta || {};
    const now = (m.now instanceof Date && !isNaN(m.now.getTime())) ? m.now : new Date();
    const profileId = m.profileId || '';
    let profileUrl = c.profileUrl || '';
    if (!profileUrl && profileId) profileUrl = 'https://www.linkedin.com/in/' + profileId;
    return {
      ts: now.toISOString(),
      name: c.name || '',
      profileUrl,
      headline: c.headline || '',
      company: c.company || '',
      location: c.location || '',
      degree: c.degree || '',
      profileId,
      method: m.method || '',
      pageUrl: m.pageUrl || ''
    };
  }

  // A data: URL rather than a blob: URL — chrome.downloads with saveAs:true
  // closes the popup, which revokes any blob URL the popup created before the
  // download starts. A data URL carries the bytes with it.
  function csvDataUrl(csv) {
    return 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  }

  function profileIdsFromLog(log) {
    const set = new Set();
    for (const r of log || []) {
      if (r && r.profileId) set.add(r.profileId);
    }
    return set;
  }

  const LC = {
    getCsrfToken,
    getProfileId,
    getVanityFromCard,
    findCardRoot,
    isConnectButton,
    findNextConnect,
    findConfirmButton,
    realClick,
    isInviteRequest,
    buildInviteRequest,
    isUsableRecipe,
    DEFAULT_INVITE_RECIPE,
    cleanName,
    extractCardInfo,
    formatTimestamp,
    toCsv,
    csvFilename,
    csvDataUrl,
    buildRecord,
    appendRecord,
    profileIdsFromLog,
    CSV_COLUMNS,
    LOG_CAP,
    CONNECT_TEXTS,
    SEND_WITHOUT_NOTE,
    SEND_WITHOUT_NOTE_RE,
    MAX_CLICK_FAILS
  };

  root.LC = LC;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = LC;
  }
})(typeof window !== 'undefined' ? window : globalThis);
