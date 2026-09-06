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

  // ops said "do not contact" — the content script marks the card once it
  // has read the profile URL; from then on the scan walks past it.
  function isBlockedCard(el) {
    return el.hasAttribute('data-lc-blocked');
  }

  function findNextConnect(processedProfiles) {
    // Strategy 1: legacy data-view-name container (older LinkedIn UIs)
    const dvn = document.querySelectorAll('[data-view-name="edge-creation-connect-action"] a, [data-view-name="edge-creation-connect-action"] button');
    for (const el of dvn) {
      if (!isConnectButton(el)) continue;
      if (tooManyFails(el) || isBlockedCard(el)) continue;
      if (el.closest('[role="dialog"], .artdeco-modal, dialog')) continue;
      const pid = getProfileId(el);
      if (pid && processedProfiles.has(pid)) continue;
      return el;
    }

    // Strategy 2: SDUI / generic — clickable elements matched by text, aria-label or href
    const candidates = document.querySelectorAll('a, button, [role="button"]');
    for (const el of candidates) {
      if (!isConnectButton(el)) continue;
      if (tooManyFails(el) || isBlockedCard(el)) continue;
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
    ['Suchbegriff', (r) => searchQueryOf(r)],
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

  // The words typed into LinkedIn's search box, read back off the search URL.
  // "hausverwaltung Berlin" / "CTO Frankfurt" carries the segment AND the city
  // — which the card itself often does not: where LinkedIn shows no location,
  // the headline slides into that line, and ops measured 39 leads whose address
  // was in truth a job title. The term is stored verbatim; interpreting it
  // (city, segment) is ops' job, so there is one mapping and not two.
  function searchQueryFrom(url) {
    const s = String(url == null ? '' : url);
    const q = s.indexOf('?');
    if (q < 0) return '';
    // Only a search page carries a search term. A profile URL's ?trk= does not,
    // and a person is not a query.
    if (!isSearchPage(s.slice(0, q))) return '';
    const hash = s.indexOf('#', q);
    const query = hash < 0 ? s.slice(q + 1) : s.slice(q + 1, hash);
    let params;
    try { params = new URLSearchParams(query); } catch (e) { return ''; }
    return normalizeSpace(params.get('keywords'));
  }

  // The term of a stored record. Older entries predate the field but carry the
  // search URL they were sent from, so the whole existing log answers too —
  // no migration, and a re-sync enriches leads that are already in ops.
  function searchQueryOf(record) {
    const r = record || {};
    return normalizeSpace(r.searchQuery) || searchQueryFrom(r.pageUrl);
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
      pageUrl: m.pageUrl || '',
      searchQuery: normalizeSpace(m.searchQuery) || searchQueryFrom(m.pageUrl)
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

  // --- Weekly quota, activity chart, backup ---------------------------------
  // LinkedIn hands out a free allowance of connection requests per week. The
  // quota is counted from `lcEvents` — a bare list of send timestamps — and NOT
  // from the contact log: that one is deduplicated, capped and user-clearable,
  // so it would under-report what LinkedIn actually saw.
  const WEEKLY_QUOTA = 200;
  const EVENT_MAX_AGE_DAYS = 400; // keeps the 1-year chart complete, bounds storage
  const EVENT_CAP = 20000;
  const DAY_MS = 24 * 60 * 60 * 1000;

  const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  // Selectable chart periods. `count` is explicit rather than derived from
  // `days` — 90 days is 13 week columns, a year is 12 month columns.
  const CHART_RANGES = [
    { key: '7d', label: '7 d', days: 7, bucket: 'day', count: 7 },
    { key: '30d', label: '30 d', days: 30, bucket: 'day', count: 30 },
    { key: '90d', label: '90 d', days: 90, bucket: 'week', count: 13 },
    { key: '1y', label: '1 y', days: 365, bucket: 'month', count: 12 }
  ];

  function rangeByKey(key) {
    return CHART_RANGES.find((r) => r.key === key) || CHART_RANGES[0];
  }

  // Epoch ms from a number, an ISO string or a Date; NaN for anything else.
  function toMs(value) {
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
    if (typeof value === 'string') return Date.parse(value);
    return NaN;
  }

  function normalizeEvents(list) {
    const out = [];
    for (const v of Array.isArray(list) ? list : []) {
      const ms = toMs(v);
      if (Number.isFinite(ms)) out.push(ms);
    }
    return out.sort((a, b) => a - b);
  }

  // Append without mutating; prune by age first, then by hard cap.
  function appendEvent(events, when, opts) {
    const o = opts || {};
    const now = Number.isFinite(toMs(o.now)) ? toMs(o.now) : Date.now();
    const maxAge = typeof o.maxAgeDays === 'number' ? o.maxAgeDays : EVENT_MAX_AGE_DAYS;
    const cap = typeof o.cap === 'number' && o.cap > 0 ? o.cap : EVENT_CAP;
    const ms = Number.isFinite(toMs(when)) ? toMs(when) : now;
    const cutoff = now - maxAge * DAY_MS;
    const list = normalizeEvents(events).filter((t) => t >= cutoff);
    list.push(ms);
    // Keep the series sorted: the cap below drops from the front, so an
    // out-of-order write would otherwise evict the wrong (newer) entry.
    list.sort((a, b) => a - b);
    return list.length > cap ? list.slice(list.length - cap) : list;
  }

  // One pass over the contact log, then ONE sort. Appending record by record
  // re-sorted the whole series each time — 619 ms for a 5000-entry log, growing
  // as n², and it runs synchronously on every LinkedIn page load.
  function backfillEvents(log, opts) {
    const o = opts || {};
    const now = Number.isFinite(toMs(o.now)) ? toMs(o.now) : Date.now();
    const maxAge = typeof o.maxAgeDays === 'number' ? o.maxAgeDays : EVENT_MAX_AGE_DAYS;
    const cap = typeof o.cap === 'number' && o.cap > 0 ? o.cap : EVENT_CAP;
    const cutoff = now - maxAge * DAY_MS;
    const out = [];
    for (const r of Array.isArray(log) ? log : []) {
      const ms = toMs(r && r.ts);
      if (Number.isFinite(ms) && ms >= cutoff) out.push(ms);
    }
    out.sort((a, b) => a - b);
    return out.length > cap ? out.slice(out.length - cap) : out;
  }

  // --- Local calendar arithmetic (never ms maths — DST would drift) ---------
  function startOfDay(value) {
    const d = new Date(toMs(value));
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function addDays(value, n) {
    const d = new Date(toMs(value));
    d.setDate(d.getDate() + n);
    return d.getTime();
  }

  function startOfMonth(value) {
    const d = new Date(toMs(value));
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function addMonths(value, n) {
    const d = new Date(toMs(value));
    d.setMonth(d.getMonth() + n);
    return d.getTime();
  }

  // Monday 00:00 local — the German/ISO week, matching the rest of the suite.
  function startOfWeek(value) {
    const d = new Date(toMs(value));
    d.setHours(0, 0, 0, 0);
    const dow = d.getDay();               // 0 = Sunday
    d.setDate(d.getDate() - ((dow + 6) % 7));
    return d.getTime();
  }

  function isoWeek(value) {
    const d = new Date(toMs(value));
    d.setHours(0, 0, 0, 0);
    // Shift onto the Thursday of this ISO week, then count weeks from Jan 4th.
    d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
    const firstThursday = new Date(d.getFullYear(), 0, 4);
    firstThursday.setDate(firstThursday.getDate() + 3 - ((firstThursday.getDay() + 6) % 7));
    return 1 + Math.round((d - firstThursday) / (7 * DAY_MS));
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function formatDay(ms) {
    const d = new Date(ms);
    return pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + '.' + d.getFullYear();
  }

  // Where the current week stands against the free allowance. `rolling7` is the
  // last 168 h — LinkedIn throttles on a rolling window, so a Sunday-plus-Monday
  // burst can trip it while the calendar week still looks harmless.
  function weekQuota(events, now, limit) {
    const nowMs = Number.isFinite(toMs(now)) ? toMs(now) : Date.now();
    const max = typeof limit === 'number' && limit > 0 ? limit : WEEKLY_QUOTA;
    const list = normalizeEvents(events);
    const weekStart = startOfWeek(nowMs);
    const rollingStart = nowMs - 7 * DAY_MS;
    let used = 0;
    let rolling7 = 0;
    for (const t of list) {
      if (t >= weekStart) used++;
      if (t >= rollingStart) rolling7++;
    }
    return {
      used,
      limit: max,
      remaining: Math.max(0, max - used),
      percent: Math.min(100, Math.round((used / max) * 100)),
      weekStart,
      resetsAt: addDays(weekStart, 7),
      rolling7
    };
  }

  // Chronological columns for the selected period, oldest first, no gaps.
  function bucketEvents(events, rangeKey, now) {
    const range = rangeByKey(rangeKey);
    const nowMs = Number.isFinite(toMs(now)) ? toMs(now) : Date.now();
    const list = normalizeEvents(events);

    const starts = [];
    for (let i = range.count - 1; i >= 0; i--) {
      if (range.bucket === 'day') starts.push(addDays(startOfDay(nowMs), -i));
      else if (range.bucket === 'week') starts.push(addDays(startOfWeek(nowMs), -7 * i));
      else starts.push(addMonths(startOfMonth(nowMs), -i));
    }
    const afterLast = range.bucket === 'day' ? addDays(starts[starts.length - 1], 1)
      : range.bucket === 'week' ? addDays(starts[starts.length - 1], 7)
        : addMonths(starts[starts.length - 1], 1);

    const buckets = starts.map((start, i) => {
      const end = i + 1 < starts.length ? starts[i + 1] : afterLast;
      const d = new Date(start);
      let label, title;
      if (range.bucket === 'day') {
        label = d.getDate() + '.' + (d.getMonth() + 1) + '.';
        title = formatDay(start);
      } else if (range.bucket === 'week') {
        label = 'W' + isoWeek(start);
        title = 'Week ' + isoWeek(start) + ' · from ' + formatDay(start);
      } else {
        label = MONTHS_SHORT[d.getMonth()];
        title = MONTHS_LONG[d.getMonth()] + ' ' + d.getFullYear();
      }
      return { start, end, label, title, count: 0, current: i === starts.length - 1 };
    });

    for (const t of list) {
      if (t < buckets[0].start || t >= afterLast) continue;
      for (let i = buckets.length - 1; i >= 0; i--) {
        if (t >= buckets[i].start) { buckets[i].count++; break; }
      }
    }
    return buckets;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  // Hand-rolled inline SVG: a Chrome popup runs under script-src 'self', so a
  // CDN chart library is not loadable — and a bundled one would be the only
  // runtime dependency in the whole extension.
  function chartSvg(buckets, opts) {
    const o = opts || {};
    const width = o.width || 300;
    const height = o.height || 96;
    const list = Array.isArray(buckets) ? buckets : [];
    const head = '<svg class="lc-chart" viewBox="0 0 ' + width + ' ' + height +
      '" width="100%" height="' + height + '" role="img" aria-label="Requests over time" xmlns="http://www.w3.org/2000/svg">';
    const peak = list.reduce((m, b) => Math.max(m, b.count || 0), 0);

    if (!list.length || peak === 0) {
      return head + '<text class="lc-empty" x="' + (width / 2) + '" y="' + (height / 2) +
        '" text-anchor="middle" dominant-baseline="middle">No requests in this period</text></svg>';
    }

    const padL = 24, padR = 4, padT = 10, padB = 14;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;
    const base = padT + plotH;
    const slot = plotW / list.length;
    const barW = Math.max(2, round2(slot * 0.68));

    let out = head;
    out += '<line class="lc-axis" x1="' + padL + '" y1="' + base + '" x2="' + (padL + plotW) + '" y2="' + base + '"></line>';
    out += '<text class="lc-ax" x="' + (padL - 4) + '" y="' + (padT + 4) + '" text-anchor="end">' + peak + '</text>';
    out += '<text class="lc-ax" x="' + (padL - 4) + '" y="' + base + '" text-anchor="end">0</text>';

    list.forEach((b, i) => {
      const h = round2(((b.count || 0) / peak) * plotH);
      const x = round2(padL + i * slot + (slot - barW) / 2);
      const cls = 'lc-bar' + (b.current ? ' lc-bar-current' : '');
      out += '<rect class="' + cls + '" x="' + x + '" y="' + round2(base - h) +
        '" width="' + barW + '" height="' + h + '" rx="2"></rect>';
    });

    // Transparent full-height hit areas on top, so a zero-count column still
    // has a hover target and the tooltip is never swallowed by the bar.
    list.forEach((b, i) => {
      const x = round2(padL + i * slot);
      out += '<rect class="lc-hit" x="' + x + '" y="' + padT + '" width="' + round2(slot) +
        '" height="' + plotH + '"><title>' + escapeHtml(b.title) + ': ' +
        (b.count || 0) + (b.current ? ' (in progress)' : '') + '</title></rect>';
    });

    const step = Math.ceil(list.length / 6);
    list.forEach((b, i) => {
      if ((list.length - 1 - i) % step !== 0) return;
      const x = round2(padL + i * slot + slot / 2);
      out += '<text class="lc-tick" x="' + x + '" y="' + (height - 3) + '" text-anchor="middle">' +
        escapeHtml(b.label) + '</text>';
    });

    return out + '</svg>';
  }

  // --- Backup / restore -----------------------------------------------------
  const BACKUP_APP = 'linkedin-spider';
  const BACKUP_SCHEMA = 1;
  const BACKUP_KEYS = ['lcEnabled', 'lcCount', 'lcLog', 'lcEvents', 'lcRecipe', 'lcRange', 'lcSeen', 'lcPace',
    'lcTerms', 'lcCities', 'lcStats', 'lcCity'];
  const RECORD_FIELDS = ['ts', 'name', 'profileUrl', 'headline', 'company', 'location',
    'degree', 'profileId', 'method', 'pageUrl', 'searchQuery'];
  // Headers that carry a live session. The recipe works without them (a fresh
  // CSRF token is injected on every send), so a backup file must not leak one.
  const SECRET_HEADERS = ['csrf-token', 'cookie', 'authorization', 'x-li-identity'];

  function sanitizeRecipeForBackup(recipe) {
    if (!isUsableRecipe(recipe)) return null;
    const headers = {};
    for (const [k, v] of Object.entries(recipe.headers || {})) {
      if (SECRET_HEADERS.includes(String(k).toLowerCase())) continue;
      headers[k] = String(v);
    }
    const out = { url: recipe.url, method: recipe.method || 'POST', headers };
    if (recipe.bodyTemplate) out.bodyTemplate = recipe.bodyTemplate;
    if (recipe.body) out.body = recipe.body;
    return out;
  }

  function buildBackup(state, meta) {
    const s = state || {};
    const m = meta || {};
    const now = (m.now instanceof Date && !isNaN(m.now.getTime())) ? m.now : new Date();
    return {
      app: BACKUP_APP,
      type: 'backup',
      schema: BACKUP_SCHEMA,
      version: m.version || '',
      exportedAt: now.toISOString(),
      data: {
        lcEnabled: !!s.lcEnabled,
        lcCount: Math.max(0, Math.floor(Number(s.lcCount) || 0)),
        lcLog: Array.isArray(s.lcLog) ? s.lcLog : [],
        lcEvents: normalizeEvents(s.lcEvents),
        lcRecipe: sanitizeRecipeForBackup(s.lcRecipe),
        lcRange: rangeByKey(s.lcRange).key,
        lcSeen: addSeen([], Array.isArray(s.lcSeen) ? s.lcSeen : []),
        lcPace: normalizePace(s.lcPace),
        lcTerms: normalizeTerms(s.lcTerms),
        lcCities: normalizeCities(s.lcCities),
        lcStats: normalizeStats(s.lcStats),
        lcCity: normalizeSpace(s.lcCity)
      }
    };
  }

  function sanitizeRecord(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const out = {};
    for (const f of RECORD_FIELDS) out[f] = normalizeSpace(raw[f]);
    return out;
  }

  // Strict on purpose: a foreign or damaged file is rejected whole, so a bad
  // import can never half-overwrite a good log.
  function parseBackup(text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return { ok: false, error: 'This file is not a valid JSON file.' };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
        parsed.app !== BACKUP_APP || parsed.type !== 'backup') {
      return { ok: false, error: 'This file is not a LinkedIn Spider backup.' };
    }
    const schema = Number(parsed.schema);
    if (!Number.isFinite(schema) || schema < 1) {
      return { ok: false, error: 'This backup has no readable schema version.' };
    }
    if (schema > BACKUP_SCHEMA) {
      return { ok: false, error: 'This backup was written by a newer version of LinkedIn Spider.' };
    }
    const d = parsed.data;
    if (!d || typeof d !== 'object' || Array.isArray(d)) {
      return { ok: false, error: 'This backup contains no data.' };
    }

    const lcLog = (Array.isArray(d.lcLog) ? d.lcLog : []).map(sanitizeRecord).filter(Boolean);
    const data = {
      // Never resume sending off the back of a restore — the user has to arm it.
      lcEnabled: false,
      lcCount: Math.max(0, Math.floor(Number(d.lcCount) || 0)),
      lcLog,
      lcEvents: normalizeEvents(d.lcEvents),
      lcRecipe: isUsableRecipe(d.lcRecipe) ? d.lcRecipe : null,
      lcRange: rangeByKey(d.lcRange).key,
      lcSeen: addSeen([], Array.isArray(d.lcSeen) ? d.lcSeen : []),
      lcPace: normalizePace(d.lcPace),
      // An older backup has no catalogue — it restores the delivered lists and
      // an empty tally, never "undefined" (which the content script would then
      // re-seed from the log, quietly resurrecting counts the file did not have).
      lcTerms: normalizeTerms(d.lcTerms),
      lcCities: normalizeCities(d.lcCities),
      lcStats: normalizeStats(d.lcStats),
      lcCity: normalizeSpace(d.lcCity)
    };
    return {
      ok: true,
      data,
      version: typeof parsed.version === 'string' ? parsed.version : '',
      exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : '',
      stats: { contacts: data.lcLog.length, events: data.lcEvents.length }
    };
  }

  function stampedName(prefix, ext, date) {
    const d = (date instanceof Date && !isNaN(date.getTime())) ? date : new Date();
    return prefix + '-' + d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      '_' + pad2(d.getHours()) + pad2(d.getMinutes()) + '.' + ext;
  }

  function backupFilename(date) { return stampedName('linkedin-spider-backup', 'json', date); }
  function reportFilename(date) { return stampedName('linkedin-spider-report', 'html', date); }

  function jsonDataUrl(value) {
    return 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(value, null, 2));
  }

  function htmlDataUrl(html) {
    return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
  }

  // Self-contained HTML report: the same chart the popup draws, plus the quota
  // and the contact table. No external assets — it has to open from disk.
  // The tally that replaces a hand-kept "(100x)" note. Left out entirely when
  // nothing has been counted yet — an empty table in a report is noise.
  function statsSection(stats) {
    const rows = statsRows(stats);
    if (!rows.length) return '';
    const total = rows.reduce((n, r) => n + r.n, 0);
    const body = rows.map((r) => '<tr><td>' + escapeHtml(r.term) + '</td><td>' +
      escapeHtml(r.city || '—') + '</td><td>' + r.n + '</td><td>' +
      escapeHtml(r.last ? formatTimestamp(new Date(r.last).toISOString()) : '') +
      '</td></tr>').join('\n');
    return '<section><h2>Sent per search (' + rows.length + ')</h2>' +
      '<table><thead><tr><th>Term</th><th>City</th><th>Sent</th><th>Last</th></tr></thead>' +
      '<tbody>' + body + '</tbody></table>' +
      '<div class="sub">' + total + ' request' + (total === 1 ? '' : 's') +
      ' across ' + rows.length + ' combination' + (rows.length === 1 ? '' : 's') + '</div></section>';
  }

  function reportHtml(opts) {
    const o = opts || {};
    const q = o.quota || weekQuota([], Date.now());
    const buckets = Array.isArray(o.buckets) ? o.buckets : [];
    const records = Array.isArray(o.records) ? o.records : [];
    const total = buckets.reduce((a, b) => a + (b.count || 0), 0);
    const generated = (o.generatedAt instanceof Date) ? o.generatedAt : new Date();

    const rows = records.map((r) => '<tr>' + CSV_COLUMNS
      .map((c) => '<td>' + escapeHtml(c[1](r || {})) + '</td>').join('') + '</tr>').join('\n');

    return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8">' +
      '<title>LinkedIn Spider report</title><style>' +
      'body{font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;margin:32px;color:#1d2226;background:#fff}' +
      'h1{font-size:20px;color:#0a66c2;margin:0 0 4px}.meta{color:#666;font-size:12px;margin-bottom:24px}' +
      'section{margin-bottom:28px}h2{font-size:14px;text-transform:uppercase;letter-spacing:.5px;color:#666;margin:0 0 8px}' +
      '.big{font-size:26px;font-weight:700;color:#0a66c2}.sub{color:#666;font-size:12px}' +
      '.track{height:8px;border-radius:4px;background:#e6e9ec;overflow:hidden;max-width:640px;margin:8px 0}' +
      '.fill{height:100%;background:#0a66c2}' +
      'svg{max-width:680px;border:1px solid #e6e9ec;border-radius:6px;background:#fafbfc}' +
      '.lc-bar{fill:#0a66c2}.lc-bar-current{fill:#7fb0e3}.lc-hit{fill:#000;opacity:0}' +
      '.lc-axis{stroke:#d0d5da;stroke-width:1}.lc-ax,.lc-tick{fill:#6a7078;font-size:9px}' +
      '.lc-empty{fill:#6a7078;font-size:11px}' +
      'table{border-collapse:collapse;width:100%;font-size:12px}' +
      'th,td{border-bottom:1px solid #e6e9ec;padding:6px 8px;text-align:left;vertical-align:top}' +
      'th{background:#f3f6f8;font-weight:600}footer{margin-top:32px;color:#6a7078;font-size:11px}' +
      'footer a{color:#0a66c2}</style></head><body>' +
      '<h1>LinkedIn Spider — activity report</h1>' +
      '<div class="meta">Generated ' + escapeHtml(formatTimestamp(generated.toISOString())) +
      ' · version ' + escapeHtml(o.version || '') + '</div>' +
      '<section><h2>Weekly quota</h2><div class="big">' + q.used + ' / ' + q.limit + '</div>' +
      '<div class="track"><div class="fill" style="width:' + q.percent + '%"></div></div>' +
      '<div class="sub">' + q.remaining + ' left this week · ' + q.rolling7 +
      ' in the last 7 days · resets ' + escapeHtml(formatDay(q.resetsAt)) + '</div></section>' +
      '<section><h2>Requests over time — ' + escapeHtml(o.rangeLabel || '') + '</h2>' +
      chartSvg(buckets, { width: 680, height: 200 }) +
      '<div class="sub">' + total + ' request' + (total === 1 ? '' : 's') + ' in this period</div></section>' +
      statsSection(o.stats) +
      '<section><h2>Contacts (' + records.length + ')</h2><table><thead><tr>' +
      CSV_COLUMNS.map((c) => '<th>' + escapeHtml(c[0]) + '</th>').join('') +
      '</tr></thead><tbody>' + rows + '</tbody></table></section>' +
      '<footer>LinkedIn Spider · <a href="https://celox.io">celox.io</a></footer></body></html>';
  }

  // --- Durable seen-list ------------------------------------------------------
  // The duplicate guard used to be seeded from the contact log alone — which is
  // FIFO-capped at LOG_CAP (5000 rows ≈ 25 weeks at 200 a week). After that the
  // oldest people quietly became askable again. `lcSeen` is a bare list of
  // profile IDs (~20 bytes each) that outlives the log by a wide margin.
  const SEEN_CAP = 100000;

  function addSeen(seen, ids, cap) {
    const limit = (typeof cap === 'number' && cap > 0) ? cap : SEEN_CAP;
    const list = Array.isArray(seen) ? seen.filter((x) => typeof x === 'string' && x) : [];
    const have = new Set(list);
    for (const id of Array.isArray(ids) ? ids : [ids]) {
      if (typeof id !== 'string' || !id || have.has(id)) continue;
      have.add(id);
      list.push(id);
    }
    return list.length > limit ? list.slice(list.length - limit) : list;
  }

  function seenIds(seen) {
    const out = new Set();
    for (const x of Array.isArray(seen) ? seen : []) if (typeof x === 'string' && x) out.add(x);
    return out;
  }

  // --- "Pending" state after a click, per locale ------------------------------
  // The click fallback treats the button flipping to "pending" as success. It
  // only knew DE/EN — on the other five locales a successful click without a
  // dialog counted as a failure.
  const PENDING_TEXTS = [
    'Ausstehend',     // DE
    'Pending',        // EN
    'Pendiente',      // ES
    'In attesa',      // IT
    'En attente',     // FR
    'Pendente',       // PT
    'In afwachting'   // NL
  ];

  function isPendingText(text) {
    const t = normalizeSpace(text).toLowerCase();
    if (!t) return false;
    return PENDING_TEXTS.some((p) => t.includes(p.toLowerCase()));
  }

  // The extension's job is search result pages. The badge stays out of the
  // way everywhere else unless a run is active.
  function isSearchPage(pathname) {
    return /\/search\/results\//.test(String(pathname || ''));
  }

  // After this many consecutive send failures (API error AND click fallback
  // failed) the run halts instead of grinding 3×6 s through every card on the
  // page. The most likely cause is LinkedIn's weekly invitation limit — whose
  // exact response is not known, so the guard keys on the symptom, not the
  // message.
  const MAX_CONSECUTIVE_FAILS = 5;

  // --- Update check (opt-in) --------------------------------------------------
  // Sideloaded ZIPs never update themselves. The options page can ask GitHub
  // for the latest release — only after the user granted api.github.com, which
  // is requested on their click, never on install.
  const UPDATE_API = 'https://api.github.com/repos/pepperonas/linkedin-spider/releases/latest';
  const UPDATE_ORIGIN = 'https://api.github.com/*';
  const RELEASES_URL = 'https://github.com/pepperonas/linkedin-spider/releases';
  const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

  function compareVersions(a, b) {
    const parse = (v) => String(v || '').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
    const pa = parse(a), pb = parse(b);
    for (let i = 0; i < 3; i++) {
      if ((pa[i] || 0) > (pb[i] || 0)) return 1;
      if ((pa[i] || 0) < (pb[i] || 0)) return -1;
    }
    return 0;
  }

  function parseLatestRelease(json) {
    if (!json || typeof json !== 'object') return null;
    const m = String(json.tag_name || '').match(/^v?(\d+\.\d+\.\d+)$/);
    if (!m) return null;
    const url = String(json.html_url || '');
    if (!url.startsWith('https://github.com/pepperonas/linkedin-spider/')) return null;
    return { version: m[1], url };
  }

  function updateCheckDue(info, now) {
    const at = info && typeof info.checkedAt === 'number' ? info.checkedAt : 0;
    return (now - at) >= UPDATE_CHECK_INTERVAL_MS;
  }

  // --- search catalogue: term × city, and what each combination has sent -------

  //: The three groups are the user's own segmentation and they carry meaning
  //: beyond the picker — ops separates `direkt` from `multiplikator` contacts
  //: the same way. Order is the order they are worked in, so it is preserved.
  const TERM_GROUPS = [
    { key: 'direkt', label: 'Direkte Kunden' },
    { key: 'branchen', label: 'Branchen / Unternehmen' },
    { key: 'multi', label: 'Multiplikatoren' }
  ];

  const DEFAULT_TERMS = {
    direkt: [
      'Geschäftsführer', 'Inhaber', 'CEO', 'Managing Director', 'COO',
      'Head of Operations', 'Operations Manager', 'Business Operations Manager',
      'Process Manager', 'Business Process Manager', 'Process Excellence Manager',
      'Operational Excellence Manager', 'Digitalisierungsmanager',
      'Digital Transformation Manager', 'Leiter Digitalisierung', 'CFO',
      'Head of Finance', 'Kaufmännischer Leiter', 'Head of Accounting',
      'Leiter Buchhaltung', 'Controller', 'Head of IT', 'IT-Leiter', 'IT Manager',
      'CIO', 'CTO'
    ],
    branchen: [
      'Immobilienverwaltung', 'Hausverwaltung', 'Property Management',
      'Facility Management', 'Bauunternehmen', 'Bauzulieferer', 'Gebäudetechnik',
      'Spedition', 'Logistik', 'Fulfillment', 'Großhandel', 'Maschinenbau',
      'Elektrotechnik', 'Medizintechnik', 'Pharma', 'Gesundheitswesen',
      'Arztpraxis', 'Medizinisches Versorgungszentrum', 'Pflegeunternehmen',
      'Personaldienstleister', 'Ingenieurbüro', 'Planungsbüro', 'Steuerberatung',
      'Wirtschaftsprüfung', 'Rechtsanwaltskanzlei', 'Versicherungsmakler',
      'Versicherungen', 'Energieunternehmen'
    ],
    multi: [
      'Steuerberater', 'Wirtschaftsprüfer', 'Datenschutzbeauftragter',
      'Datenschutzberater', 'IT-Systemhaus', 'MSP', 'IT-Berater',
      'IT-Sicherheitsberater', 'Cybersecurity Consultant', 'ERP-Berater',
      'DATEV-Berater', 'Unternehmensberater', 'Digitalisierungsberater',
      'Prozessberater', 'Automatisierungsberater'
    ]
  };

  const DEFAULT_CITIES = ['Berlin', 'Darmstadt', 'Frankfurt', 'Hamburg', 'Düsseldorf'];

  const TERM_MAX = 100;          // a LinkedIn search term, not an essay
  const TERMS_PER_GROUP_MAX = 300;
  const CITIES_MAX = 100;
  //: Distinct combinations kept. The planned catalogue is ~350; the cap only
  //: guards against a long tail of hand-typed one-off searches.
  const STATS_CAP = 1000;

  function dedupeStrings(list, max) {
    const out = [];
    const seen = new Set();
    for (const raw of Array.isArray(list) ? list : []) {
      const value = normalizeSpace(raw).slice(0, TERM_MAX);
      if (!value) continue;
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(value);
      if (out.length >= max) break;
    }
    return out;
  }

  // A stored term list, coerced into shape. A missing group falls back to the
  // default; an EMPTY group stays empty — deleting a whole group is a decision,
  // not damage, and re-seeding it would fight the user.
  function normalizeTerms(raw) {
    const src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    const out = {};
    for (const g of TERM_GROUPS) {
      out[g.key] = Array.isArray(src[g.key])
        ? dedupeStrings(src[g.key], TERMS_PER_GROUP_MAX)
        : DEFAULT_TERMS[g.key].slice();
    }
    return out;
  }

  function normalizeCities(raw) {
    if (!Array.isArray(raw)) return DEFAULT_CITIES.slice();
    return dedupeStrings(raw, CITIES_MAX);
  }

  function termCount(terms) {
    const t = normalizeTerms(terms);
    return TERM_GROUPS.reduce((n, g) => n + t[g.key].length, 0);
  }

  // The search LinkedIn opens for one combination. The city rides in the
  // keywords, exactly as it was typed by hand before — so the term that comes
  // back off the URL is the same string this key was built from.
  function searchQueryFor(term, city) {
    return normalizeSpace(normalizeSpace(term) + ' ' + normalizeSpace(city));
  }

  function searchUrlFor(term, city) {
    const q = searchQueryFor(term, city);
    if (!q) return '';
    return 'https://www.linkedin.com/search/results/people/?keywords=' +
      encodeURIComponent(q) + '&origin=GLOBAL_SEARCH_HEADER';
  }

  // Whole-word test — "Berlin" must not match inside "Berliner Sparkasse", and
  // a multi-word city ("Frankfurt am Main") has to match as one unit.
  function cityAt(query, city) {
    const q = normalizeSpace(query).toLowerCase();
    const c = normalizeSpace(city).toLowerCase();
    if (!q || !c) return -1;
    let from = 0;
    for (;;) {
      const at = q.indexOf(c, from);
      if (at < 0) return -1;
      const before = at === 0 ? ' ' : q[at - 1];
      const after = at + c.length >= q.length ? ' ' : q[at + c.length];
      if (/\s/.test(before) && /\s/.test(after)) return at;
      from = at + 1;
    }
  }

  // Split a sent search term back into "what" and "where", against the USER'S
  // OWN city list — not a gazetteer. That is the whole scope: these are the
  // cities they work, and the picker built most of these queries itself.
  // No city found is a normal answer ("Leiter Digitalisierung"), not a failure.
  function splitQuery(query, cities) {
    const q = normalizeSpace(query);
    if (!q) return { term: '', city: '' };
    let best = null;
    for (const city of normalizeCities(cities)) {
      const at = cityAt(q, city);
      if (at < 0) continue;
      // Prefer the city furthest right (the "<term> <city>" habit), and among
      // those the longest name — "Frankfurt am Main" beats "Frankfurt".
      if (!best || at > best.at || (at === best.at && city.length > best.city.length)) {
        best = { at, city };
      }
    }
    if (!best) return { term: q, city: '' };
    const term = normalizeSpace(q.slice(0, best.at) + ' ' + q.slice(best.at + best.city.length));
    // The city comes back in the spelling of the LIST, not of the query: the
    // key is case-insensitive either way, but a table that shows "berlin" or
    // "Berlin" depending on who wrote last reads like two different places.
    return { term, city: best.city };
  }

  //: `|` cannot appear in a key because it is stripped from terms and cities.
  function statsKey(term, city) {
    return normalizeSpace(term).toLowerCase().replace(/\|/g, ' ') + '|' +
      normalizeSpace(city).toLowerCase().replace(/\|/g, ' ');
  }

  function normalizeStats(raw) {
    const src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    const out = {};
    for (const key of Object.keys(src)) {
      const e = src[key];
      if (!e || typeof e !== 'object') continue;
      const n = Math.floor(Number(e.n));
      if (!Number.isFinite(n) || n <= 0) continue;
      out[key] = {
        term: normalizeSpace(e.term),
        city: normalizeSpace(e.city),
        n,
        first: Number(e.first) || 0,
        last: Number(e.last) || 0
      };
    }
    return out;
  }

  // Count one sent request against its combination. Without a term there is
  // nothing to count — a request sent off a profile page is still a request,
  // and `lcEvents` (the quota) counts it; only this breakdown skips it.
  function bumpStat(stats, term, city, when) {
    const t = normalizeSpace(term);
    if (!t) return stats && typeof stats === 'object' ? stats : {};
    const ts = Number(when) || Date.now();
    const key = statsKey(t, city);
    const next = Object.assign({}, normalizeStats(stats));
    const cur = next[key];
    next[key] = {
      // Keep the spelling first seen — the key ignores case, the label should
      // not flicker between "CTO Berlin" and "cto berlin".
      term: (cur && cur.term) ? cur.term : t,
      city: (cur && cur.city) ? cur.city : normalizeSpace(city),
      n: (cur ? cur.n : 0) + 1,
      first: cur && cur.first ? cur.first : ts,
      last: ts
    };
    const over = Object.keys(next).length - STATS_CAP;
    if (over > 0) {
      // Evict the combinations idle longest — never the one just written. The
      // fresh key is taken OUT of the candidates before slicing: skipping it
      // inside the loop deletes one too few and the cap creeps up (a test
      // caught exactly that, with a fresh entry carrying the oldest stamp).
      const evictable = Object.keys(next).filter((k) => k !== key)
        .sort((a, b) => (next[a].last || 0) - (next[b].last || 0));
      for (const k of evictable.slice(0, over)) delete next[k];
    }
    return next;
  }

  // The starting stand, read once out of the contact log. Best-effort by
  // nature: the log is deduplicated and capped, so it under-reports a long
  // history — but it reproduces a hand-kept tally exactly where the log still
  // reaches. One pass, no per-record re-sorting (the 619 ms lesson).
  function backfillStats(log, cities) {
    const list = normalizeCities(cities);
    const out = {};
    for (const r of Array.isArray(log) ? log : []) {
      if (!r || typeof r !== 'object') continue;
      const { term, city } = splitQuery(searchQueryOf(r), list);
      if (!term) continue;
      const key = statsKey(term, city);
      const ts = Date.parse(r.ts) || 0;
      const cur = out[key];
      if (cur) {
        cur.n += 1;
        if (ts && (!cur.first || ts < cur.first)) cur.first = ts;
        if (ts > cur.last) cur.last = ts;
      } else {
        out[key] = { term, city, n: 1, first: ts, last: ts };
      }
    }
    return out;
  }

  function statCountFor(stats, term, city) {
    const e = normalizeStats(stats)[statsKey(term, city)];
    return e ? e.n : 0;
  }

  // Flat rows for a table: most sent first, then most recent, then by name so
  // the order never wobbles between renders.
  function statsRows(stats) {
    const s = normalizeStats(stats);
    return Object.keys(s).map((k) => s[k]).sort((a, b) =>
      (b.n - a.n) || ((b.last || 0) - (a.last || 0)) ||
      a.term.localeCompare(b.term) || a.city.localeCompare(b.city));
  }

  // --- ops blocklist: the back channel (ops → extension) -----------------------
  // ops knows whom NOT to ask again: closed leads (won/lost/dormant), people who
  // are customers already, contacts marked as no longer in their role. The
  // worker fetches the `linkedin_norm` keys, the content script matches the
  // card's profile URL against them BEFORE sending.
  const OPS_BLOCKLIST_PATH = '/api/rainmaker/leads/import/linkedin-spider/blocklist';

  // ⚠️ Mirror of ops `services/lead_dedup.py::norm_linkedin`, pinned with the
  // same examples in test/blocklist.test.js. Change both or neither.
  function opsNormLinkedin(url) {
    let u = String(url == null ? '' : url).trim().toLowerCase();
    u = u.replace(/^https?:\/\//, '');
    u = u.replace(/^[a-z0-9-]*\.?linkedin\.com/, 'linkedin.com');
    u = u.replace(/[?#].*$/, '');
    u = u.replace(/\/+$/, '').trim();
    return u || null;
  }

  function normalizeBlock(raw) {
    const b = raw && typeof raw === 'object' ? raw : {};
    const seen = new Set();
    const norms = [];
    for (const n of Array.isArray(b.norms) ? b.norms : []) {
      if (typeof n !== 'string' || !n || seen.has(n)) continue;
      seen.add(n);
      norms.push(n);
    }
    return { at: typeof b.at === 'number' ? b.at : 0, norms, count: norms.length };
  }

  function blockSet(block) {
    return new Set(normalizeBlock(block).norms);
  }

  function isBlockedUrl(url, set) {
    if (!set || !set.size) return false;
    const key = opsNormLinkedin(url);
    return !!key && set.has(key);
  }

  async function opsFetchBlocklist(opts) {
    const o = opts || {};
    const settings = o.settings || {};
    const now = typeof o.now === 'number' ? o.now : Date.now();
    const base = opsNormalizeUrl(settings.baseUrl);
    if (!opsValidToken(settings.token)) return { ok: false, error: 'No valid ops API token configured' };
    if (!base) return { ok: false, error: 'Invalid ops URL' };
    const fetchFn = o.fetchFn || (typeof fetch === 'function' ? fetch : null);
    let resp;
    try {
      resp = await fetchFn(base + OPS_BLOCKLIST_PATH, {
        method: 'GET',
        headers: { 'Authorization': 'Bearer ' + settings.token, 'Accept': 'application/json' }
      });
    } catch (e) {
      return { ok: false, error: 'ops unreachable: ' + (e && e.message ? e.message : String(e)) };
    }
    if (!resp.ok) return { ok: false, status: resp.status, error: 'ops answered ' + resp.status };
    let body;
    try { body = await resp.json(); } catch (e) { return { ok: false, error: 'Unexpected payload (not JSON)' }; }
    if (!body || !Array.isArray(body.norms)) return { ok: false, error: 'Unexpected payload (no norms)' };
    return { ok: true, block: normalizeBlock({ at: now, norms: body.norms }) };
  }

  // --- pacing: jitter, hourly/daily caps, stop at X % of the weekly allowance --
  // The 1.5-s metronome was the extension's most recognisable fingerprint. All
  // caps are OFF by default (0 = unlimited); jitter is on because it costs
  // nothing and a human never clicks on a fixed beat.
  const TICK_MS = 1500;
  const JITTER = 0.4;   // ±40 % around TICK_MS → 900–2100 ms
  const PACE_DEFAULTS = Object.freeze({ jitter: true, perHour: 0, perDay: 0, stopAtPercent: 0 });

  function clampInt(value, min, max) {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  function normalizePace(raw) {
    const p = raw && typeof raw === 'object' ? raw : {};
    return {
      jitter: p.jitter === undefined ? PACE_DEFAULTS.jitter : !!p.jitter,
      perHour: clampInt(p.perHour, 0, WEEKLY_QUOTA),
      perDay: clampInt(p.perDay, 0, WEEKLY_QUOTA),
      stopAtPercent: clampInt(p.stopAtPercent, 0, 100)
    };
  }

  function nextTickDelay(jitter, rnd) {
    if (!jitter) return TICK_MS;
    const r = typeof rnd === 'function' ? rnd() : Math.random();
    return Math.round(TICK_MS * (1 - JITTER + 2 * JITTER * r));
  }

  // Whether the next send must wait, and until when. Order matters: the hourly
  // cap lifts soonest, the weekly stop latest — report what lifts first.
  function paceBlocked(events, pace, now) {
    const nowMs = Number.isFinite(toMs(now)) ? toMs(now) : Date.now();
    const p = normalizePace(pace);
    const list = normalizeEvents(events);
    const open = { blocked: false, reason: null, resumeAt: null };

    if (p.perHour > 0) {
      const since = nowMs - 60 * 60 * 1000;
      const lastHour = list.filter((t) => t >= since);
      if (lastHour.length >= p.perHour) {
        return { blocked: true, reason: 'hour', resumeAt: Math.min(...lastHour) + 60 * 60 * 1000 };
      }
    }
    if (p.perDay > 0) {
      const dayStart = startOfDay(nowMs);
      const today = list.filter((t) => t >= dayStart).length;
      if (today >= p.perDay) return { blocked: true, reason: 'day', resumeAt: addDays(dayStart, 1) };
    }
    if (p.stopAtPercent > 0) {
      const q = weekQuota(list, nowMs);
      if (q.percent >= p.stopAtPercent) return { blocked: true, reason: 'quota', resumeAt: q.resetsAt };
    }
    return open;
  }

  // --- ops sync: push sent requests into celox ops as Rainmaker leads --------
  // ops takes the same row shape the CSV carries and answers per row. Every
  // record is acknowledged by ops before it counts as synced; the state lives
  // in its OWN storage key (`lcOpsState`, keyed by profile) so the service
  // worker never rewrites `lcLog` while the content script is appending to it.
  const OPS_DEFAULT_URL = 'https://ops.celox.io';
  const OPS_IMPORT_PATH = '/api/rainmaker/leads/import/linkedin-spider';
  const OPS_BATCH_SIZE = 200;   // ops caps a request at 2000 rows; keep payloads small
  const OPS_TOKEN_RE = /^ops_[A-Za-z0-9_-]{32,}$/;

  function opsRecordKey(record) {
    const r = record || {};
    return String(r.profileId || r.profileUrl || '');
  }

  function nullIfEmpty(value) {
    const s = normalizeSpace(value);
    return s ? s : null;
  }

  function opsRowFor(record) {
    const r = record || {};
    return {
      profile_url: normalizeSpace(r.profileUrl),
      name: nullIfEmpty(r.name),
      company: nullIfEmpty(r.company),
      headline: nullIfEmpty(r.headline),
      location: nullIfEmpty(r.location),
      degree: nullIfEmpty(r.degree),
      profile_id: nullIfEmpty(r.profileId),
      method: nullIfEmpty(r.method),
      page_url: nullIfEmpty(r.pageUrl),
      search_query: nullIfEmpty(searchQueryOf(r)),
      ts: nullIfEmpty(r.ts)
    };
  }

  // Everything ops has not acknowledged yet. Failed sends are retried; rows
  // ops declared invalid are not (they will never become valid).
  function opsPending(log, state) {
    const st = state && typeof state === 'object' ? state : {};
    const out = [];
    for (const r of Array.isArray(log) ? log : []) {
      if (!r || typeof r !== 'object') continue;
      if (!normalizeSpace(r.profileUrl)) continue;
      const key = opsRecordKey(r);
      const entry = st[key];
      if (entry && (entry.status === 'ok' || entry.status === 'invalid')) continue;
      out.push(r);
    }
    return out;
  }

  function opsBatches(items, size) {
    const n = (typeof size === 'number' && size > 0) ? size : OPS_BATCH_SIZE;
    const out = [];
    for (let i = 0; i < (items || []).length; i += n) out.push(items.slice(i, i + n));
    return out;
  }

  // Fold one ops response into the state. Rows are matched by the index ops
  // echoes back — never by position in the log, which may have moved.
  function applyOpsResult(state, sent, result, now) {
    const next = Object.assign({}, state && typeof state === 'object' ? state : {});
    const rows = (result && Array.isArray(result.results)) ? result.results : [];
    for (const row of rows) {
      const record = sent[row.index];
      if (!record) continue;
      const key = opsRecordKey(record);
      if (!key) continue;
      const decision = row.decision || 'error';
      const acknowledged = decision === 'create' || decision === 'update' || decision === 'unchanged';
      const entry = {
        status: acknowledged ? 'ok' : (decision === 'invalid' ? 'invalid' : 'error'),
        decision,
        leadId: row.lead_id || null,
        at: now
      };
      if (row.error) entry.error = row.error;
      next[key] = entry;
    }
    return next;
  }

  // Trims, drops any path, insists on https except for a local dev server.
  function opsNormalizeUrl(raw) {
    const s = normalizeSpace(raw);
    if (!s) return OPS_DEFAULT_URL;
    let u;
    try { u = new URL(s); } catch (e) { return null; }
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null;
    return u.origin;
  }

  function opsValidToken(token) {
    return OPS_TOKEN_RE.test(String(token || ''));
  }

  // One sync: pending → batches → POST → state. `fetchFn` is injected so the
  // same function runs in the service worker, in tests, and in Node against a
  // real server. Never throws: the error lands in `summary.error` and the
  // state keeps only what ops acknowledged, so the next run retries the rest.
  async function opsSyncRun(opts) {
    const o = opts || {};
    const settings = o.settings || {};
    const now = typeof o.now === 'number' ? o.now : Date.now();
    const base = opsNormalizeUrl(settings.baseUrl);
    let state = Object.assign({}, o.state && typeof o.state === 'object' ? o.state : {});
    const summary = { at: now, sent: 0, created: 0, updated: 0, unchanged: 0, invalid: 0, errors: 0, error: null };

    if (!opsValidToken(settings.token)) {
      summary.error = 'No valid ops API token configured';
      return { state, summary, error: summary.error };
    }
    if (!base) {
      summary.error = 'Invalid ops URL';
      return { state, summary, error: summary.error };
    }

    const pending = opsPending(o.log, state);
    const fetchFn = o.fetchFn || (typeof fetch === 'function' ? fetch : null);
    for (const batch of opsBatches(pending, o.batchSize)) {
      let result;
      try {
        const resp = await fetchFn(base + OPS_IMPORT_PATH, {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + settings.token,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ rows: batch.map(opsRowFor), commit: true })
        });
        if (!resp.ok) {
          let detail = '';
          try { const j = await resp.json(); detail = (j && (j.detail || j.message)) || ''; } catch (e) { /* no body */ }
          summary.error = 'ops answered ' + resp.status + (detail ? ': ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : '');
          break;
        }
        result = await resp.json();
      } catch (e) {
        summary.error = 'ops unreachable: ' + (e && e.message ? e.message : String(e));
        break;
      }
      state = applyOpsResult(state, batch, result, now);
      summary.sent += batch.length;
      summary.created += result.created || 0;
      summary.updated += result.updated || 0;
      summary.unchanged += result.unchanged || 0;
      summary.invalid += result.invalid || 0;
      summary.errors += result.errors || 0;
    }
    return { state, summary, error: summary.error };
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
    searchQueryFrom,
    searchQueryOf,
    TERM_GROUPS,
    DEFAULT_TERMS,
    DEFAULT_CITIES,
    STATS_CAP,
    normalizeTerms,
    normalizeCities,
    termCount,
    searchQueryFor,
    searchUrlFor,
    splitQuery,
    statsKey,
    normalizeStats,
    bumpStat,
    backfillStats,
    statCountFor,
    statsRows,
    appendRecord,
    profileIdsFromLog,
    CSV_COLUMNS,
    LOG_CAP,
    CONNECT_TEXTS,
    SEND_WITHOUT_NOTE,
    SEND_WITHOUT_NOTE_RE,
    MAX_CLICK_FAILS,
    WEEKLY_QUOTA,
    EVENT_MAX_AGE_DAYS,
    EVENT_CAP,
    CHART_RANGES,
    rangeByKey,
    toMs,
    normalizeEvents,
    appendEvent,
    backfillEvents,
    startOfDay,
    startOfWeek,
    isoWeek,
    formatDay,
    weekQuota,
    bucketEvents,
    chartSvg,
    escapeHtml,
    reportHtml,
    statsSection,
    reportFilename,
    htmlDataUrl,
    BACKUP_APP,
    BACKUP_SCHEMA,
    BACKUP_KEYS,
    RECORD_FIELDS,
    sanitizeRecipeForBackup,
    buildBackup,
    parseBackup,
    backupFilename,
    jsonDataUrl,
    OPS_DEFAULT_URL,
    OPS_IMPORT_PATH,
    OPS_BATCH_SIZE,
    opsRecordKey,
    opsRowFor,
    opsPending,
    opsBatches,
    applyOpsResult,
    opsNormalizeUrl,
    opsValidToken,
    opsSyncRun,
    SEEN_CAP,
    addSeen,
    seenIds,
    PENDING_TEXTS,
    isPendingText,
    isSearchPage,
    MAX_CONSECUTIVE_FAILS,
    UPDATE_API,
    UPDATE_ORIGIN,
    RELEASES_URL,
    UPDATE_CHECK_INTERVAL_MS,
    compareVersions,
    parseLatestRelease,
    updateCheckDue,
    TICK_MS,
    PACE_DEFAULTS,
    normalizePace,
    nextTickDelay,
    paceBlocked,
    OPS_BLOCKLIST_PATH,
    opsNormLinkedin,
    normalizeBlock,
    blockSet,
    isBlockedUrl,
    opsFetchBlocklist
  };

  root.LC = LC;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = LC;
  }
})(typeof window !== 'undefined' ? window : globalThis);
