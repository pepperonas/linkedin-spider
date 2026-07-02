# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Chrome Extension (Manifest V3) that auto-sends LinkedIn connection requests from search result pages. Multilingual (DE/EN primary). Primary path is a direct call to LinkedIn's internal **Voyager API**; if that fails (non-rate-limit), it falls back to clicking the "Vernetzen"/"Connect" button and confirming the dialog. Rate-limited to 1 action per 1.5 seconds, with an automatic 60s pause on a LinkedIn HTTP 429.

**Self-healing:** LinkedIn changes its DOM and API frequently. The extension resists this on two fronts: (1) heuristic, language-agnostic DOM detection (aria-label / text / href), and (2) a MAIN-world request interceptor (`interceptor.js`) that learns LinkedIn's *current* invite request shape from a real click and replays it at scale ("recipe"). When the API path breaks, the click fallback fires, the interceptor captures the live request, and subsequent sends fast-path again automatically.

## Commands

No build step. JS is loaded directly by Chrome.

```bash
npm test            # run vitest suite once
npm run test:ci     # same, verbose reporter
npx vitest run test/lib.test.js          # single test file
npx vitest run -t "getProfileId"          # single test by name
npx vitest                                # watch mode
```

Loading in Chrome:
1. `chrome://extensions` → Developer Mode → "Load unpacked" → select this directory
2. After code changes: click refresh on the extension card, **then reload the LinkedIn tab** (content scripts only re-inject on page load).

Debug via DevTools Console on the LinkedIn tab — all logs prefixed with `[LC]`. A visual status badge (🕸️) is rendered bottom-right of the page reflecting current state.

## Architecture

Two content-script worlds + the popup. The split between `lib.js` and `content.js` is the key thing to understand:

- **`lib.js`** (isolated world) — All pure / DOM-query / recipe helpers, wrapped in a UMD-style IIFE. Exposed on `window.LC` for the extension *and* `module.exports` for tests (so the same file is the unit-test target). Contains: `getCsrfToken`, `getProfileId`, `isConnectButton`, `findNextConnect`, `findConfirmButton`, `realClick`, plus the self-healing helpers `isInviteRequest`, `buildInviteRequest`, `isUsableRecipe` and `DEFAULT_INVITE_RECIPE`. **Loaded before `content.js`** (see `manifest.json` `content_scripts.js` order). Put any logic you'd want to unit-test here, not in `content.js`.
- **`content.js`** (isolated world) — Stateful orchestration IIFE. Pulls helpers off `window.LC`, runs a 1.5s `setInterval` (`tick()`). Holds runtime state: `active`, `pending` (in-flight guard), `rateLimited`, `count`, `learnedRecipe`, and `processedProfiles` (a `Set` of profile IDs). Owns the recipe-driven network call (`sendInvitation` → `trySendWithRecipe`, preferring `learnedRecipe` then `DEFAULT_INVITE_RECIPE`), the `clickFallback`, the badge, the `window.message` listener that receives captured recipes, and the popup message listener.
- **`interceptor.js`** (**MAIN world**, `run_at: document_start`) — Patches `window.fetch` and `XMLHttpRequest` to detect LinkedIn's own "send invitation" request, capture URL/headers/body, and `window.postMessage` the recipe to `content.js`. Runs in the page world so it can see the page's own network calls; **cannot** use `window.LC` (different world), so its invite-detection heuristic is duplicated from `lib.js`'s `isInviteRequest` — keep the two in sync.
- **`popup.html` / `popup.js`** — Popup UI. Talks to the content script via `chrome.tabs.sendMessage`, polls status every 1s while open. Shows API mode (`default` vs `self-healed ✓`). State (`lcEnabled`, `lcCount`, `lcRecipe`) persisted in `chrome.storage.local`.
- **`styles.css`** — Popup styling only (NOT injected into LinkedIn). Styles for the in-page 🍻 marker/tooltip live in `content.js` (`injectStyles()` appends a `<style id="lc-styles">` once on first success).

### Self-healing recipe flow

1. `sendInvitation` tries `learnedRecipe` (if any), then `DEFAULT_INVITE_RECIPE`. Each recipe is turned into a concrete request by `buildInviteRequest`, which substitutes the target `urn:li:fsd_profile:<id>` and always injects a fresh CSRF token (a captured token may be stale).
2. A learned recipe that returns a non-429 error is treated as stale and discarded (so the next click re-teaches one).
3. On API failure → `clickFallback` clicks LinkedIn's real Connect button → LinkedIn issues its own invite request → `interceptor.js` captures it → `content.js` stores it as `learnedRecipe` (memory + `chrome.storage`) → future sends fast-path via the learned recipe.

### Connection flow (per tick)

1. If a confirm dialog is already open (`findConfirmButton`), click it and return.
2. Find next unprocessed connect button (`findNextConnect(processedProfiles)`).
3. Extract profile ID (`getProfileId`) and add it to `processedProfiles` **before** acting — this survives LinkedIn's DOM replacement so the same person isn't hit twice.
4. If a profile ID exists → `sendInvitation()` POSTs to the Voyager API with the CSRF token. Result is `'ok' | 'rate_limited' | 'error'`.
   - `rate_limited` → set `rateLimited`, badge a 60s pause, then auto-resume.
   - `error` → `clickFallback()` (real-clicks the button, waits up to ~3s for either the confirm dialog or the button text flipping to "Ausstehend"/"Pending" = success).
5. No profile ID → straight to `clickFallback()`.
6. On success: increment counter, persist to storage, and replace the button with an animated 🍻 emoji (`makeBeerEmoji()` in content.js): M3-Expressive gravity drop with squash-&-stretch bounces + amber shockwave ring, hover shows a custom fixed-position tooltip ("🍻 Networking, bottled and served by LinkedIn Spider", viewport-clamped, auto-flips below when there's no room above). Full `prefers-reduced-motion` guard.

### Why `realClick()`

LinkedIn's Ember framework ignores plain `.click()`. `realClick()` dispatches `mousedown`/`mouseup`/`click` MouseEvents in sequence.

## LinkedIn Voyager API call

`sendInvitation()` POSTs to:
`/voyager/api/voyagerRelationshipsDashMemberRelationships?action=verifyQuotaAndCreateV2&decorationId=...InvitationCreationResultWithInvitee-2`

Required headers: `csrf-token` (from `getCsrfToken`), `x-restli-protocol-version: 2.0.0`, JSON content-type. Body wraps the invitee URN `urn:li:fsd_profile:<profileId>`. The CSRF token is the value of the `JSESSIONID` cookie.

## DOM selectors (break frequently — early 2026)

Helpers live in `lib.js`; update them there if LinkedIn changes its DOM:
- **Profile ID** (`getProfileId`): walks up to 20 ancestors looking for `componentkey` starting with `SearchResults` (strips that prefix) or `data-chameleon-result-urn` containing `fsd_profile:`.
- **Connect button** (`findNextConnect` / `isConnectButton`): strategy 1 = legacy `[data-view-name="edge-creation-connect-action"]` descendants; strategy 2 = any `a`/`button`/`[role="button"]` recognized by `isConnectButton`. Since LinkedIn's SDUI rollout (2026) the connect element is an `<a>` whose visible "Vernetzen"/"Connect" text is buried in nested hashed-class `<span>`s, so `isConnectButton` primarily matches the **aria-label** (`… als Kontakt einladen` DE / `Invite … to connect` EN) and falls back to exact text. Both strategies exclude elements inside `[role="dialog"]`, `.artdeco-modal`, `dialog`.
- **Confirm dialog** (`findConfirmButton`): anchored regexes (`SEND_WITHOUT_NOTE_RE`) matching aria-label *or* text in 7 languages, covering LinkedIn's A/B wording "Ohne **Notiz** senden" vs "Ohne **Nachricht** senden" (EN: "note" vs "message") — anchored so the sibling "Nachricht senden"/"Send with a message" button never matches. Scans `[role="dialog"]`/`.artdeco-modal`/`dialog` first, then falls back to a document-wide scan (SDUI dialogs aren't always marked as dialogs); `.artdeco-button--primary` inside `.send-invite` remains as legacy fallback.

## Message protocol (popup ↔ content script)

| Action       | Direction       | Payload             | Response            |
|--------------|-----------------|---------------------|---------------------|
| `toggle`     | popup → content | `{ enabled: bool }` | `{ ok: true }`      |
| `getStatus`  | popup → content | —                   | `{ active, count, healed }` |
| `resetCount` | popup → content | —                   | `{ ok: true }`      |

If `sendMessage` hits `chrome.runtime.lastError`, the content script isn't loaded — the popup silently no-ops (user must reload the tab).

## Versioning

User-facing version lives in `manifest.json` (currently 2.7.2); `package.json` version is independent and lags. Bump `manifest.json` for releases.
