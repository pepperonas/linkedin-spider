import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import LC from '../lib.js';

// interceptor.js runs in the page's MAIN world and cannot see window.LC, so it
// carries its own copy of the invite heuristic. Nothing enforced that the two
// stay in step — until this file.
const SRC = fs.readFileSync(path.resolve('interceptor.js'), 'utf8');

function extractLooksLikeInvite() {
  const m = SRC.match(/function looksLikeInvite\(url, body\) \{[\s\S]*?\n {2}\}\n/);
  if (!m) throw new Error('interceptor.js: looksLikeInvite not found');
  // eslint-disable-next-line no-new-func
  return new Function(m[0] + '; return looksLikeInvite;')();
}

const INVITE_URL = '/voyager/api/voyagerRelationshipsDashMemberRelationships?action=verifyQuotaAndCreateV2&decorationId=x';
const INVITE_BODY = JSON.stringify({ invitee: { inviteeUnion: { memberProfile: 'urn:li:fsd_profile:ACoAAB1' } } });

describe('interceptor.js keeps its invite heuristic identical to lib.js', () => {
  const looksLikeInvite = extractLooksLikeInvite();
  const cases = [
    [INVITE_URL, null],
    ['/voyager/api/voyagerRelationshipsDashMemberRelationships?action=createv2', ''],
    ['/voyager/api/voyagerRelationshipsDashMemberRelationships', INVITE_BODY],
    ['/voyager/api/voyagerRelationshipsDashMemberRelationships', ''],       // url without action, empty body
    ['/voyager/api/identity/dash/profiles?q=memberIdentity', null],         // the vanity lookup — NOT an invite
    ['/voyager/api/messaging/conversations', INVITE_BODY],                  // body says invite, url does not
    ['/voyager/api/feed/updates', '{"inviteeUnion":1}'],                    // half the body signal only
    ['', null], [null, null], [undefined, INVITE_BODY], [123, INVITE_BODY]
  ];

  it.each(cases)('agrees with LC.isInviteRequest for %s', (url, body) => {
    expect(looksLikeInvite(url, body)).toBe(LC.isInviteRequest(url, body));
  });

  it('recognizes the real invite request and rejects the vanity lookup', () => {
    expect(looksLikeInvite(INVITE_URL, null)).toBe(true);
    expect(looksLikeInvite('/voyager/api/identity/dash/profiles?q=memberIdentity', null)).toBe(false);
  });
});

// --- the real file, loaded in jsdom ----------------------------------------
describe('interceptor.js in the page world', () => {
  let posted, origFetch, origXHR;

  async function armInterceptor() {
    vi.resetModules();
    await import('../interceptor.js');
  }

  beforeEach(() => {
    posted = [];
    origFetch = window.fetch;
    origXHR = window.XMLHttpRequest;
    window.fetch = vi.fn(() => Promise.resolve({ ok: true }));
    vi.spyOn(window, 'postMessage').mockImplementation((msg) => posted.push(msg));
  });
  afterEach(() => {
    window.fetch = origFetch;
    window.XMLHttpRequest = origXHR;
    vi.restoreAllMocks();
  });

  it('captures LinkedIn\'s own invite fetch as a replayable recipe', async () => {
    await armInterceptor();
    await window.fetch(INVITE_URL, {
      method: 'POST',
      headers: { 'csrf-token': 'ajax:1', 'x-restli-protocol-version': '2.0.0' },
      body: INVITE_BODY
    });
    expect(posted.length).toBe(1);
    const msg = posted[0];
    expect(msg.source).toBe('lc-interceptor');
    expect(msg.type).toBe('invite-captured');
    expect(msg.recipe.url).toBe(INVITE_URL);
    expect(msg.recipe.method).toBe('POST');
    expect(msg.recipe.headers['x-restli-protocol-version']).toBe('2.0.0');
    expect(msg.recipe.body).toBe(INVITE_BODY);
    // and the recipe is one content.js will accept
    expect(LC.isUsableRecipe(msg.recipe)).toBe(true);
  });

  it('still forwards the request to the real fetch, unchanged', async () => {
    const underlying = window.fetch;          // the fetch the page had before arming
    await armInterceptor();
    expect(window.fetch).not.toBe(underlying); // it is wrapped ...
    const init = { method: 'POST', body: INVITE_BODY };
    await window.fetch(INVITE_URL, init);
    expect(underlying).toHaveBeenCalledTimes(1);          // ... and still called
    expect(underlying).toHaveBeenCalledWith(INVITE_URL, init);
    expect(posted.length).toBe(1);
  });

  it('ignores everything that is not an invite', async () => {
    await armInterceptor();
    await window.fetch('/voyager/api/identity/dash/profiles?q=memberIdentity', { method: 'GET' });
    await window.fetch('/voyager/api/feed/updates', { method: 'POST', body: '{"x":1}' });
    await window.fetch(INVITE_URL, { method: 'GET' });     // right url, wrong method
    // right url AND a replayable body, but not a POST — only the real send is a POST
    await window.fetch(INVITE_URL, { method: 'PUT', body: INVITE_BODY });
    expect(posted).toEqual([]);
  });

  it('does not post a recipe it could never replay (no profile URN in the body)', async () => {
    await armInterceptor();
    await window.fetch(INVITE_URL, { method: 'POST', body: '{"no":"urn"}' });
    expect(posted).toEqual([]);
  });

  it('reads Headers objects, arrays and plain objects alike', async () => {
    await armInterceptor();
    await window.fetch(INVITE_URL, { method: 'POST', headers: new Headers({ 'csrf-token': 'a' }), body: INVITE_BODY });
    await window.fetch(INVITE_URL, { method: 'POST', headers: [['csrf-token', 'b']], body: INVITE_BODY });
    await window.fetch(INVITE_URL, { method: 'POST', headers: { 'csrf-token': 'c' }, body: INVITE_BODY });
    expect(posted.map((m) => m.recipe.headers['csrf-token'])).toEqual(['a', 'b', 'c']);
  });

  it('captures the same request when LinkedIn uses XMLHttpRequest', async () => {
    // Stub the ORIGINAL send before arming, so the interceptor wraps the stub
    // and jsdom never tries to hit the network.
    const sent = vi.fn();
    window.XMLHttpRequest.prototype.send = sent;
    await armInterceptor();
    const xhr = new window.XMLHttpRequest();
    xhr.open('POST', INVITE_URL);
    xhr.setRequestHeader('csrf-token', 'ajax:9');
    xhr.send(INVITE_BODY);
    expect(posted.length).toBe(1);
    expect(posted[0].recipe.headers['csrf-token']).toBe('ajax:9');
    expect(posted[0].recipe.body).toBe(INVITE_BODY);
    expect(sent).toHaveBeenCalledWith(INVITE_BODY);   // and the real send still happens
  });

  it('never breaks the page when its own bookkeeping throws', async () => {
    await armInterceptor();
    // a Request-like input with a throwing url getter
    const evil = { get url() { throw new Error('boom'); }, method: 'POST' };
    await expect(window.fetch(evil, { method: 'POST', body: INVITE_BODY })).resolves.toBeTruthy();
    expect(posted).toEqual([]);
  });

  it('posts only to its own origin', async () => {
    await armInterceptor();
    await window.fetch(INVITE_URL, { method: 'POST', body: INVITE_BODY });
    expect(window.postMessage).toHaveBeenCalledWith(expect.anything(), window.location.origin);
  });
});
