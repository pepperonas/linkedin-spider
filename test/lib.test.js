import { describe, it, expect, beforeEach } from 'vitest';

// Load lib.js — attaches to globalThis.LC
await import('../lib.js');
const { isConnectButton, getProfileId, findNextConnect, findConfirmButton, getCsrfToken, realClick } = globalThis.LC;

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
