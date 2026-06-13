import { describe, it, expect, beforeEach } from 'vitest';

// Load lib.js — attaches to globalThis.LC
await import('../lib.js');
const {
  isConnectButton, getProfileId, findNextConnect, findConfirmButton, getCsrfToken, realClick,
  isInviteRequest, buildInviteRequest, isUsableRecipe, DEFAULT_INVITE_RECIPE
} = globalThis.LC;

function clearBody() {
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
}

describe('isConnectButton', () => {
  it('returns true for "Vernetzen"', () => {
    const btn = document.createElement('button');
    btn.textContent = 'Vernetzen';
    expect(isConnectButton(btn)).toBe(true);
  });

  it('returns true for "Connect"', () => {
    const btn = document.createElement('button');
    btn.textContent = 'Connect';
    expect(isConnectButton(btn)).toBe(true);
  });

  it('returns true with surrounding whitespace', () => {
    const btn = document.createElement('button');
    btn.textContent = '  Vernetzen  ';
    expect(isConnectButton(btn)).toBe(true);
  });

  it('returns false for "Ausstehend"', () => {
    const btn = document.createElement('button');
    btn.textContent = 'Ausstehend';
    expect(isConnectButton(btn)).toBe(false);
  });

  it('returns false for "Nachricht"', () => {
    const btn = document.createElement('button');
    btn.textContent = 'Nachricht';
    expect(isConnectButton(btn)).toBe(false);
  });

  it('returns false for "Folgen"', () => {
    const btn = document.createElement('button');
    btn.textContent = 'Folgen';
    expect(isConnectButton(btn)).toBe(false);
  });

  it('matches SDUI <a> via German aria-label even when text is nested', () => {
    const a = document.createElement('a');
    a.setAttribute('aria-label', 'Mohammad Mustejab Baig als Kontakt einladen');
    a.innerHTML = '<span><span><span>Vernetzen</span></span></span>';
    expect(isConnectButton(a)).toBe(true);
  });

  it('matches SDUI <a> via English aria-label', () => {
    const a = document.createElement('a');
    a.setAttribute('aria-label', 'Invite Jane Doe to connect');
    expect(isConnectButton(a)).toBe(true);
  });

  it('does not match a "Nachricht senden" aria-label', () => {
    const a = document.createElement('a');
    a.setAttribute('aria-label', 'Mohammad Mustejab Baig eine Nachricht senden');
    expect(isConnectButton(a)).toBe(false);
  });
});

describe('getProfileId', () => {
  beforeEach(clearBody);

  it('extracts id from componentkey attribute', () => {
    const container = document.createElement('div');
    container.setAttribute('componentkey', 'SearchResultsABC123');
    const btn = document.createElement('button');
    btn.textContent = 'Vernetzen';
    container.appendChild(btn);
    document.body.appendChild(container);

    expect(getProfileId(btn)).toBe('ABC123');
  });

  it('extracts id from data-chameleon-result-urn', () => {
    const container = document.createElement('div');
    container.setAttribute('data-chameleon-result-urn', 'urn:li:fsd_profile:XYZ789');
    const btn = document.createElement('button');
    btn.textContent = 'Vernetzen';
    container.appendChild(btn);
    document.body.appendChild(container);

    expect(getProfileId(btn)).toBe('XYZ789');
  });

  it('returns null when no profile id found', () => {
    const btn = document.createElement('button');
    btn.textContent = 'Vernetzen';
    document.body.appendChild(btn);

    expect(getProfileId(btn)).toBe(null);
  });

  it('traverses up to 20 parent levels', () => {
    const btn = document.createElement('button');
    btn.textContent = 'Vernetzen';

    // Build a 15-level deep nesting with button at the bottom
    let current = btn;
    for (let i = 0; i < 15; i++) {
      const parent = document.createElement('div');
      parent.appendChild(current);
      current = parent;
    }
    current.setAttribute('componentkey', 'SearchResultsDEEP');
    clearBody();
    document.body.appendChild(current);

    const innerBtn = document.body.querySelector('button');
    expect(getProfileId(innerBtn)).toBe('DEEP');
  });

  it('returns null when nesting exceeds 20 levels', () => {
    const btn = document.createElement('button');
    btn.textContent = 'Vernetzen';

    let current = btn;
    for (let i = 0; i < 25; i++) {
      const parent = document.createElement('div');
      parent.appendChild(current);
      current = parent;
    }
    current.setAttribute('componentkey', 'SearchResultsTOODEEP');
    clearBody();
    document.body.appendChild(current);

    const innerBtn = document.body.querySelector('button');
    expect(getProfileId(innerBtn)).toBe(null);
  });
});

describe('findNextConnect', () => {
  beforeEach(clearBody);

  it('finds a Vernetzen button', () => {
    const btn = document.createElement('button');
    btn.textContent = 'Vernetzen';
    document.body.appendChild(btn);

    const result = findNextConnect(new Set());
    expect(result).toBe(btn);
  });

  it('finds a Connect button', () => {
    const btn = document.createElement('button');
    btn.textContent = 'Connect';
    document.body.appendChild(btn);

    const result = findNextConnect(new Set());
    expect(result).toBe(btn);
  });

  it('skips buttons inside dialogs', () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const btn = document.createElement('button');
    btn.textContent = 'Vernetzen';
    dialog.appendChild(btn);
    document.body.appendChild(dialog);

    expect(findNextConnect(new Set())).toBe(null);
  });

  it('skips buttons inside artdeco-modal', () => {
    const modal = document.createElement('div');
    modal.classList.add('artdeco-modal');
    const btn = document.createElement('button');
    btn.textContent = 'Vernetzen';
    modal.appendChild(btn);
    document.body.appendChild(modal);

    expect(findNextConnect(new Set())).toBe(null);
  });

  it('skips already-processed profiles', () => {
    const container = document.createElement('div');
    container.setAttribute('componentkey', 'SearchResultsPROCESSED');
    const btn = document.createElement('button');
    btn.textContent = 'Vernetzen';
    container.appendChild(btn);
    document.body.appendChild(container);

    const processed = new Set(['PROCESSED']);
    expect(findNextConnect(processed)).toBe(null);
  });

  it('prefers data-view-name strategy', () => {
    const dvnContainer = document.createElement('div');
    dvnContainer.setAttribute('data-view-name', 'edge-creation-connect-action');
    const btn1 = document.createElement('button');
    btn1.textContent = 'Vernetzen';
    btn1.id = 'dvn-btn';
    dvnContainer.appendChild(btn1);
    document.body.appendChild(dvnContainer);

    const btn2 = document.createElement('button');
    btn2.textContent = 'Vernetzen';
    btn2.id = 'plain-btn';
    document.body.appendChild(btn2);

    const result = findNextConnect(new Set());
    expect(result.id).toBe('dvn-btn');
  });

  it('returns null when no connect buttons exist', () => {
    const btn = document.createElement('button');
    btn.textContent = 'Folgen';
    document.body.appendChild(btn);

    expect(findNextConnect(new Set())).toBe(null);
  });

  it('finds the SDUI connect <a> and extracts its SearchResults profile id', () => {
    // Mirrors the real 2026 SDUI DOM: outer SearchResults componentkey container,
    // an intermediate UUID-componentkey <a> carrying the connect aria-label, and
    // the visible "Vernetzen" text buried in nested hashed-class spans.
    const outer = document.createElement('div');
    outer.setAttribute('componentkey', 'SearchResultsACoAADw8PROFILE');

    const mid = document.createElement('div');
    mid.setAttribute('componentkey', '35a54ce0-uuid');

    const a = document.createElement('a');
    a.id = 'sdui-connect';
    a.setAttribute('aria-label', 'Mohammad Mustejab Baig als Kontakt einladen');
    a.setAttribute('componentkey', 'a2a64791-uuid');
    a.setAttribute('href', '/preload/search-custom-invite/?vanityName=mmb');
    a.innerHTML = '<span><div><span><span>Vernetzen</span></span></div></span>';

    mid.appendChild(a);
    outer.appendChild(mid);
    document.body.appendChild(outer);

    const result = findNextConnect(new Set());
    expect(result).toBe(a);
    expect(getProfileId(result)).toBe('ACoAADw8PROFILE');
  });

  it('skips the SDUI connect <a> when its profile is already processed', () => {
    const outer = document.createElement('div');
    outer.setAttribute('componentkey', 'SearchResultsACoAADw8PROFILE');
    const a = document.createElement('a');
    a.setAttribute('aria-label', 'Jane Doe als Kontakt einladen');
    a.innerHTML = '<span>Vernetzen</span>';
    outer.appendChild(a);
    document.body.appendChild(outer);

    expect(findNextConnect(new Set(['ACoAADw8PROFILE']))).toBe(null);
  });
});

describe('findConfirmButton', () => {
  beforeEach(clearBody);

  it('finds button by aria-label "Ohne Notiz senden"', () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const btn = document.createElement('button');
    btn.setAttribute('aria-label', 'Ohne Notiz senden');
    btn.textContent = 'Ohne Notiz senden';
    dialog.appendChild(btn);
    document.body.appendChild(dialog);

    expect(findConfirmButton()).toBe(btn);
  });

  it('finds button by aria-label "Send without a note"', () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const btn = document.createElement('button');
    btn.setAttribute('aria-label', 'Send without a note');
    btn.textContent = 'Send';
    dialog.appendChild(btn);
    document.body.appendChild(dialog);

    expect(findConfirmButton()).toBe(btn);
  });

  it('finds button by text content', () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const btn = document.createElement('button');
    btn.textContent = 'Ohne Notiz senden';
    dialog.appendChild(btn);
    document.body.appendChild(dialog);

    expect(findConfirmButton()).toBe(btn);
  });

  it('falls back to primary button in send-invite modal', () => {
    const modal = document.createElement('div');
    modal.classList.add('artdeco-modal', 'send-invite');
    const btn = document.createElement('button');
    btn.classList.add('artdeco-button--primary');
    btn.textContent = 'Senden';
    modal.appendChild(btn);
    document.body.appendChild(modal);

    expect(findConfirmButton()).toBe(btn);
  });

  it('returns null when no dialog exists', () => {
    expect(findConfirmButton()).toBe(null);
  });

  it('returns null when dialog has no confirm button', () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const btn = document.createElement('button');
    btn.textContent = 'Abbrechen';
    dialog.appendChild(btn);
    document.body.appendChild(dialog);

    expect(findConfirmButton()).toBe(null);
  });
});

describe('getCsrfToken', () => {
  it('extracts token from JSESSIONID cookie', () => {
    Object.defineProperty(document, 'cookie', {
      value: 'JSESSIONID="ajax:1234567890"',
      writable: true,
      configurable: true,
    });
    expect(getCsrfToken()).toBe('ajax:1234567890');
  });

  it('extracts token without quotes', () => {
    Object.defineProperty(document, 'cookie', {
      value: 'JSESSIONID=ajax:9876543210',
      writable: true,
      configurable: true,
    });
    expect(getCsrfToken()).toBe('ajax:9876543210');
  });

  it('returns null when no JSESSIONID cookie', () => {
    Object.defineProperty(document, 'cookie', {
      value: 'other=value',
      writable: true,
      configurable: true,
    });
    expect(getCsrfToken()).toBe(null);
  });
});

describe('realClick', () => {
  it('dispatches mousedown, mouseup, and click events', () => {
    const btn = document.createElement('button');
    const events = [];
    ['mousedown', 'mouseup', 'click'].forEach(type => {
      btn.addEventListener(type, (e) => events.push(e.type));
    });

    realClick(btn);

    expect(events).toEqual(['mousedown', 'mouseup', 'click']);
  });

  it('dispatches events that bubble', () => {
    const container = document.createElement('div');
    const btn = document.createElement('button');
    container.appendChild(btn);

    const events = [];
    container.addEventListener('click', () => events.push('bubbled'));

    realClick(btn);

    expect(events).toContain('bubbled');
  });
});

describe('isConnectButton via href heuristic', () => {
  it('matches an <a> linking to the custom-invite flow regardless of language', () => {
    const a = document.createElement('a');
    a.setAttribute('href', '/preload/search-custom-invite/?vanityName=jane');
    a.textContent = 'これは未知の言語です'; // unknown-language text
    expect(isConnectButton(a)).toBe(true);
  });

  it('does not match an ordinary profile link', () => {
    const a = document.createElement('a');
    a.setAttribute('href', 'https://www.linkedin.com/in/jane-doe/');
    a.textContent = 'Jane Doe';
    expect(isConnectButton(a)).toBe(false);
  });
});

describe('isInviteRequest', () => {
  it('matches the voyager relationships invite endpoint', () => {
    expect(isInviteRequest(
      '/voyager/api/voyagerRelationshipsDashMemberRelationships?action=verifyQuotaAndCreateV2',
      null
    )).toBe(true);
  });

  it('matches by body shape even when the URL is unfamiliar', () => {
    const body = JSON.stringify({ invitee: { inviteeUnion: { memberProfile: 'urn:li:fsd_profile:ABC' } } });
    expect(isInviteRequest('/some/future/graphql/endpoint', body)).toBe(true);
  });

  it('ignores unrelated requests', () => {
    expect(isInviteRequest('/voyager/api/feed/updates', '{"foo":1}')).toBe(false);
    expect(isInviteRequest(undefined, undefined)).toBe(false);
  });
});

describe('buildInviteRequest', () => {
  it('fills the default recipe template with the profile id and a fresh csrf token', () => {
    const req = buildInviteRequest(DEFAULT_INVITE_RECIPE, 'PROFILE123', 'ajax:tok');
    expect(req.method).toBe('POST');
    expect(req.headers['csrf-token']).toBe('ajax:tok');
    expect(req.body).toContain('urn:li:fsd_profile:PROFILE123');
    expect(req.body).not.toContain('%PROFILE_ID%');
  });

  it('substitutes the profile urn in a captured (learned) body', () => {
    const learned = {
      url: '/some/captured/endpoint',
      method: 'POST',
      headers: { 'x-li-foo': 'bar', 'csrf-token': 'stale' },
      body: JSON.stringify({ invitee: { inviteeUnion: { memberProfile: 'urn:li:fsd_profile:OLDONE' } } })
    };
    const req = buildInviteRequest(learned, 'NEWONE', 'ajax:fresh');
    expect(req.url).toBe('/some/captured/endpoint');
    expect(req.headers['x-li-foo']).toBe('bar');
    expect(req.headers['csrf-token']).toBe('ajax:fresh'); // stale token overridden
    expect(req.body).toContain('urn:li:fsd_profile:NEWONE');
    expect(req.body).not.toContain('OLDONE');
  });

  it('returns null when recipe or profile id is missing', () => {
    expect(buildInviteRequest(null, 'X', 'tok')).toBe(null);
    expect(buildInviteRequest(DEFAULT_INVITE_RECIPE, '', 'tok')).toBe(null);
  });
});

describe('isUsableRecipe', () => {
  it('accepts the default template recipe', () => {
    expect(isUsableRecipe(DEFAULT_INVITE_RECIPE)).toBe(true);
  });

  it('accepts a captured body carrying a profile urn', () => {
    expect(isUsableRecipe({ url: '/x', body: 'urn:li:fsd_profile:ABC' })).toBe(true);
  });

  it('rejects recipes without a substitutable urn or url', () => {
    expect(isUsableRecipe({ url: '/x', body: '{"no":"urn"}' })).toBe(false);
    expect(isUsableRecipe({ body: 'urn:li:fsd_profile:ABC' })).toBe(false);
    expect(isUsableRecipe(null)).toBe(false);
  });
});
