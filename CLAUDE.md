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

- **`lib.js`** (isolated world) — All pure / DOM-query / recipe helpers, wrapped in a UMD-style IIFE. Exposed on `window.LC` for the extension *and* `module.exports` for tests (so the same file is the unit-test target). Contains: `getCsrfToken`, `getProfileId`, `isConnectButton`, `findNextConnect`, `findConfirmButton`, `realClick`, the self-healing helpers `isInviteRequest`, `buildInviteRequest`, `isUsableRecipe`, `DEFAULT_INVITE_RECIPE`, the contact-log/export helpers `cleanName`, `findCardRoot`, `extractCardInfo`, `buildRecord`, `toCsv`, `csvDataUrl`, `csvFilename`, `appendRecord`, `profileIdsFromLog`, and the v2.9.0 quota/chart/backup layer `normalizeEvents`, `appendEvent`, `startOfWeek`, `isoWeek`, `weekQuota`, `CHART_RANGES`, `bucketEvents`, `chartSvg`, `escapeHtml`, `reportHtml`, `buildBackup`, `parseBackup`, `sanitizeRecipeForBackup`. **Loaded before `content.js`** (see `manifest.json` `content_scripts.js` order) **and also by `popup.html`**, which needs the CSV helpers. Put any logic you'd want to unit-test here, not in `content.js`.
- **`content.js`** (isolated world) — Stateful orchestration IIFE. Pulls helpers off `window.LC`, runs a 1.5s `setInterval` (`tick()`). Holds runtime state: `active`, `pending` (in-flight guard), `rateLimited`, `count`, `learnedRecipe`, and `processedProfiles` (a `Set` of profile IDs). Owns the recipe-driven network call (`sendInvitation` → `trySendWithRecipe`, preferring `learnedRecipe` then `DEFAULT_INVITE_RECIPE`), the `clickFallback`, the badge, the `window.message` listener that receives captured recipes, and the popup message listener.
- **`interceptor.js`** (**MAIN world**, `run_at: document_start`) — Patches `window.fetch` and `XMLHttpRequest` to detect LinkedIn's own "send invitation" request, capture URL/headers/body, and `window.postMessage` the recipe to `content.js`. Runs in the page world so it can see the page's own network calls; **cannot** use `window.LC` (different world), so its invite-detection heuristic is duplicated from `lib.js`'s `isInviteRequest` — keep the two in sync.
- **`popup.html` / `popup.js`** — Popup UI, **300px wide, 596–598px tall** depending on whether the hint line is filled (a field screenshot measured 597px). Talks to the content script via `chrome.tabs.sendMessage`, polls status every 1s while open. Shows the weekly quota, the activity chart, API mode (`default` vs `self-healed ✓`), the contact-log size, and owns the CSV / HTML-report / backup exports plus restore and the footer. Loads `lib.js` **before** `popup.js` (a contract pinned in `test/popup-export.test.js` — without it `LC` is undefined and the export button throws). State (`lcEnabled`, `lcCount`, `lcRecipe`, `lcLog`, `lcEvents`, `lcRange`) persisted in `chrome.storage.local`.
- **`styles.css`** — Popup styling only (NOT injected into LinkedIn). Styles for the in-page 🍻 marker/tooltip live in `content.js` (`injectStyles()` appends a `<style id="lc-styles">` once on first success).

### Self-healing recipe flow

1. `sendInvitation` tries `learnedRecipe` (if any), then `DEFAULT_INVITE_RECIPE`. Each recipe is turned into a concrete request by `buildInviteRequest`, which substitutes the target `urn:li:fsd_profile:<id>` and always injects a fresh CSRF token (a captured token may be stale).
2. A learned recipe that returns a non-429 error is treated as stale and discarded (so the next click re-teaches one).
3. On API failure → `clickFallback` clicks LinkedIn's real Connect button → LinkedIn issues its own invite request → `interceptor.js` captures it → `content.js` stores it as `learnedRecipe` (memory + `chrome.storage`) → future sends fast-path via the learned recipe.

### Contact log + CSV export (v2.8.0)

Every successful request is appended to `chrome.storage.local['lcLog']` — an array of
`{ ts, name, profileUrl, headline, company, location, degree, profileId, method, pageUrl }`, FIFO-capped at `LOG_CAP` (5000).

- **The card is scraped BEFORE the send** (`extractCardInfo` in `tick()`, stored in `cardInfo`). LinkedIn replaces the card markup on success — reading afterwards yields nothing. Every field degrades to `''`; a LinkedIn DOM change empties a column, it never breaks the send.
- `method` records which path won: `'api'` (Voyager recipe) or `'click'` (fallback).
- **Writes re-read the log first** (`logRecord` does a fresh `storage.get` before `set`) so a second LinkedIn tab's entries aren't clobbered by a stale in-memory copy.
- **Cross-session duplicate guard:** on load, `profileIdsFromLog(lcLog)` seeds `processedProfiles`, so `findNextConnect` skips anyone already contacted. `clearLog` clears both the store and the in-memory set — otherwise the popup would wipe the log while the tab keeps skipping the very people it just forgot.
- **CSV** (`toCsv`): semicolon-separated with a UTF-8 BOM (what German Excel opens into columns without an import wizard), CRLF rows, every field quoted, inner quotes doubled, newlines/tabs flattened to spaces, and a **formula-injection guard** (leading `= + - @` gets an apostrophe) — these are scraped names heading into a spreadsheet.
- **Download** uses `chrome.downloads.download({ saveAs: true })` with a **`data:` URL, not a blob URL**: `saveAs` closes the popup, which revokes any blob URL the popup created before the download starts. A failed API call falls back to an `<a download>` click — but a *cancelled* save dialog must NOT (it reports via `runtime.lastError` containing `CANCELED`, and falling back there would write the file the user just declined).
- The popup reads `lcLog` **straight from storage**, never through the content script, so the export works with the popup open over any tab.
- `Reset Counter` only zeroes `lcCount`; `Clear Log` (two-step confirm, no `confirm()` in a popup) wipes `lcLog`.

### Connection flow (per tick)

1. If a confirm dialog is already open (`findConfirmButton`), click it and return. If it survives 5 consecutive ticks (confirm click not registering), the modal's dismiss button is clicked instead so the run doesn't stall (`stuckDialogTicks`).
2. Find next unprocessed connect button (`findNextConnect(processedProfiles)`).
3. Extract profile ID (`getProfileId`) and add it to `processedProfiles` **before** acting — this survives LinkedIn's DOM replacement so the same person isn't hit twice.
4. If a profile ID exists → `sendInvitation()` POSTs to the Voyager API with the CSRF token. Result is `'ok' | 'rate_limited' | 'error'`.
   - `rate_limited` → set `rateLimited`, badge a 60s pause, then auto-resume.
   - `error` → `clickFallback()` (real-clicks the button, waits up to ~6s for either the confirm dialog or the button text flipping to "Ausstehend"/"Pending" = success). A found confirm dialog is clicked via `confirmAndVerify()`: click → verify the dialog actually closed → retry up to 3×.
5. No profile ID in the DOM → resolve it from the card's `/in/<vanity>` profile link (`getVanityFromCard` in lib.js — aborts if the container holds links to *different* profiles, so the whole result list can never be mistaken for a card) via a Voyager profile lookup (`resolveProfileIdByVanity` in content.js, response regex-scanned for `urn:li:fsd_profile:`, cached in `vanityCache`). Resolved IDs are checked against `processedProfiles` before sending (findNextConnect can't filter these itself — no URN in the DOM). Only if that fails too → `clickFallback()`. If nothing at all happens there (no dialog, no state change), the failure is counted on the element itself (`data-lc-fails`); after `MAX_CLICK_FAILS` (3) attempts `findNextConnect` skips it, so one broken card can't wedge the run.
6. On success: increment counter, persist to storage, and replace the button with an animated 🍻 emoji (`makeBeerEmoji()` in content.js): M3-Expressive gravity drop with squash-&-stretch bounces + amber shockwave ring, hover shows a custom fixed-position tooltip ("🍻 Networking, bottled and served by LinkedIn Spider", viewport-clamped, auto-flips below when there's no room above). Full `prefers-reduced-motion` guard.

### Why `realClick()`

LinkedIn's Ember framework ignores plain `.click()`, and the newer SDUI (React) components only respond to **pointer** events — plain MouseEvents are silently ignored. `realClick()` therefore dispatches a full sequence (`pointerover`/`pointerdown`/`mousedown`/`pointerup`/`mouseup`/`click`) with real element-center coordinates and `view`, plus a `focus()` beforehand. It falls back to constructing events without `view` in environments that reject it (vitest's jsdom), and skips PointerEvents where the constructor doesn't exist.

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
| `clearLog`   | popup → content | —                   | `{ ok: true }`      |
| `reloadState`| popup → content | —                   | `{ ok: true }`      |

`getStatus` answers `{ active, count, healed, contextGone }`.

`reloadState` is sent after a restore so the tab re-reads storage instead of running on pre-restore counters. It **merges** into `processedProfiles` rather than replacing it — a restore that shrinks the log must not make the current session re-ask people it already contacted.

If `sendMessage` hits `chrome.runtime.lastError`, the content script isn't loaded — the popup silently no-ops (user must reload the tab).

## Surviving an extension reload (v2.9.1)

⚠️ **Updating or reloading the extension orphans the content script in every already-open tab.** It keeps executing, but its link to the extension is severed: `chrome.runtime.id` becomes `undefined` and every `chrome.storage.*` call throws `Extension context invalidated`. Before 2.9.1 that killed the run **silently** — the throw escaped from `tick()` as an unhandled rejection, so there were no sends, no log entries, an unchanged badge, and a popup that could not reach the tab yet still displayed "Paused". It looked exactly like "the extension is broken", and the only cure is reloading the page.

- `contextLost()` / `giveUp()` in `content.js`: all storage access goes through `storageGet`/`storageSet`/`storageRemove`, which check `chrome.runtime.id` first and catch the throw. On the first failure the scan interval is cleared, `active` goes false, and the badge reads **`⚠️ Reload this page`**.
- ⚠️ **`updateBadge` is a no-op once `contextGone` is set.** Without that, the `✅ #N <name>` line painted immediately afterwards covers the one message explaining why nothing is being recorded. A mutation probe found this in the fix itself.
- `getStatus` carries `contextGone` so the popup can distinguish "paused" from "nobody is listening".
- Popup: `tabReachable` drives the status line (`⚠️ Reload the LinkedIn tab`, `.status.warn`, measured 6.26:1) after `MISS_LIMIT` unanswered polls, and the poll backs off `POLL_FAST` 1s → `POLL_SLOW` 5s. It recovers on its own. Quota, chart and all three exports keep working — they read storage, not the tab.
- ⚠️ **A content-script test stub must define `chrome.runtime.id`.** Without it `contextLost()` is true and the script correctly refuses to start; the pre-2.9.1 stub in `content-log.test.js` had to be fixed, not the guard.

⚠️ **`backfillEvents` must stay one pass + one sort.** The first version appended record by record, and `appendEvent` re-sorts the whole series each call — **619 ms for a 5000-entry log**, growing as n², running synchronously inside the storage callback on every LinkedIn page load. `test/resilience.test.js` caps it at 100 ms for 5000 entries.

## Weekly quota, activity chart, backup (v2.9.0)

**The quota counts `lcEvents`, not `lcLog`.** `lcEvents` is a bare array of epoch-ms send timestamps appended on every success; the contact log is deduplicated by `profileId`, FIFO-capped at 5000 and wiped by `Clear Log`, so counting it would under-report what LinkedIn actually saw. `Clear Log` therefore leaves `lcEvents` alone — timestamps carry no personal data, and the quota has to stay honest. Pruned at `EVENT_MAX_AGE_DAYS` (400) / `EVENT_CAP` (20000).

- **Back-fill on upgrade** is keyed on `lcEvents === undefined`, **not on "empty"**. An empty series is a real state (log cleared) and must never be re-seeded — pinned by a test.
- **Week = Monday 00:00 local** (`startOfWeek`), German/ISO convention. `weekQuota` also returns `rolling7`, because LinkedIn throttles on a sliding window and a Sunday+Monday burst trips it while the calendar week still looks fine. All date maths goes through `Date` setters, never `+ n * 86400000` — the latter drifts across DST.
- **The extension never stops itself at 200.** The display informs; auto-stopping was not asked for and would be a behaviour change.
- **Chart is hand-rolled inline SVG.** A Chrome popup runs under `script-src 'self'`, so a CDN chart library cannot load at all, and a bundled one would be the extension's only runtime dependency. `chartSvg()` returns a *string*, which is what lets the popup and the HTML report share one renderer and lets tests assert on structure.
- ⚠️ **The popup polls once a second.** `renderStats()` keeps a fingerprint (`range:len:first:last`) and only rewrites the SVG on a real change — an unconditional `innerHTML` would tear off a tooltip mid-hover. Same house rule as the hue app's fingerprint lock.
- **Bars carry a transparent full-height `.lc-hit` rect painted *after* them**, so a zero-count column still has a hover target and the bar can't swallow the `<title>`.
- **Backup strips session headers** (`csrf-token`, `cookie`, `authorization`, `x-li-identity`) from the learned recipe — a backup file gets passed around, and a fresh CSRF token is injected on every send anyway, so nothing is lost.
- **`parseBackup` rejects whole or not at all**: app marker, `type`, schema (a *newer* schema is refused, not half-read), then per-field coercion through a whitelist. The popup only writes on `ok: true`, so a bad import cannot half-overwrite a good log.
- **A restore always writes `lcEnabled: false`** — set inside `parseBackup`, not just in the UI, so the safety property is testable.

⚠️ **`&` in the donate URL must be `&amp;` in `popup.html`.** `&curren` is a legacy named character reference (¤), so a raw `&currency_code=` is mangled by the HTML parser. Pinned in `test/version.test.js`.

⚠️ **A Chrome popup is capped at 600px tall — anything past that scrolls out of sight, footer included.** Adding the quota panel and the chart pushed the page to 756px, which put the version and the links below the fold. It is back to **596–598px** (the hint line accounts for the spread; a screenshot from a real install measured 597px) because the three figures became a side-by-side strip (`.stats`, was three full-width `.counter-row`s) and Report/Backup/Restore share one `.btn-row`. Budget accordingly before adding another block; `test/styles.test.js` pins both arrangements.

⚠️ **`screenshot-popup.png` in both READMEs shows the popup and goes stale the moment the layout changes.** `test/version.test.js` only checks that the file exists and carries alt text — it cannot see whether the picture still matches the UI. Re-shoot it after any visible change to `popup.html`/`styles.css`. It is cropped to the popup alone (302×597); the source frame also contained a sliver of the LinkedIn page behind it, which has no business in a public repo.

⚠️ **Measure contrast, do not eyeball it.** The muted tone introduced with this UI (`#8a9199`) shipped at **3.19:1** — below the 4.5:1 floor — and nothing but a browser measurement caught it. It is `#6a7078` (5.0:1) now, in `styles.css` **and** in the report's inline stylesheet inside `lib.js`. `test/styles.test.js` computes the WCAG ratio from the stylesheet and fails under 4.5:1 (3:1 for the large bold figures), so this cannot silently come back.

⚠️ **The suite pins `TZ=Europe/Berlin`** (`vitest.config.js`). The quota and the chart are calendar-local, and the defect naive `+ n * 86_400_000` maths causes only shows where clocks actually shift — in UTC the DST guards pass either way and are worthless. `addDays` is where it bites (day columns step midnight→midnight across the Sunday switch); `startOfWeek` happens to be equivalent under a Monday-start week, because European switches land on a Sunday at 02:00 and so never fall between two weekday midnights. It still uses calendar setters, for timezones where that is not true.

⚠️ **`appendEvent` sorts after appending.** The cap trims from the front, so an out-of-order write (two tabs, a skewed clock, a restored file) would otherwise evict the *newest* entry instead of the oldest. Found by a test, not in the field.

## Releasing

`git tag vX.Y.Z && git push --tags` triggers `.github/workflows/release.yml`: tests → ZIP → GitHub Release.

⚠️ **The ZIP is a hand-maintained `cp` list, not a glob.** `interceptor.js` was added in v2.7.0 and never made it into that list, so the published ZIPs for **v2.7.0–v2.7.4 shipped without it** while `manifest.json` declared it as a content script. Fixed in v2.8.0, and `test/release.test.js` now pins that the `cp` line covers every file `manifest.json` and `popup.html` reference — add a new runtime file, and the suite goes red until the workflow ships it.

## Versioning

SemVer. The user-facing version lives in `manifest.json` (currently **2.9.0**) and is shown in the popup footer, read via `chrome.runtime.getManifest().version` — never hard-coded. `package.json` used to lag independently (it sat at 2.4.0 through five releases); since 2.9.0 the two must match and `test/version.test.js` pins that, along with the version badge in both READMEs and the presence of a `### <version>` changelog heading. Bump `manifest.json` + `package.json` + both README badges + both changelogs together.

## Testing conventions

`test/lib.test.js` + `test/export.test.js` cover the pure/DOM helpers. `test/content-log.test.js` and `test/popup-export.test.js` load `content.js` and `popup.html`+`popup.js` **for real** in jsdom (chrome + `fetch` stubbed, fake timers) rather than re-implementing the logic — the older `test/content.test.js` / `test/popup.test.js` only simulate it, so a change there can pass while the shipped file is broken.

`test/stats.test.js`, `test/backup.test.js`, `test/report.test.js`, `test/styles.test.js` and `test/version.test.js` are pure/file-level; `test/resilience.test.js` loads the real `content.js` against a stub whose `chrome.runtime.id` can be revoked mid-run — `styles.test.js` reads `styles.css`/`lib.js`/`popup.html` as text and asserts on them (contrast ratios, the button-row arrangement, and that every id `popup.js` calls `getElementById` for actually exists). ⚠️ The report's stylesheet lives inside JS string concatenation in `lib.js`; join the literals (`/'\s*\+\s*\n?\s*'/`) before reading rules out of it, or every rule but the first reads as missing. `test/popup-stats.test.js` loads `popup.html` + `popup.js` for real and stubs `FileReader` with a synchronous stand-in — the point is the popup's own wiring (change → read → parse → arm → confirm), not jsdom's reader.

⚠️ **An outcome can be reached by more than one mechanism — probe for that.** Two 2.9.1 probes survived at first: removing `clearInterval` still stopped the sends (because `active = false` already gates `tick`), and removing the `try/catch` in `storageSet` still warned (because the test's synchronous storage stub let the *outer* `storageGet` try/catch swallow it). Both assertions were true for the wrong reason. Fixes: assert `vi.getTimerCount()` drops, and break storage only **after** startup so the failing call is the one under test.

⚠️ **Mutate every new assertion once.** A test you have not watched fail is not a guarantee. This bit during v2.8.0: the "ignores duplicate visually-hidden text" test asserted only the name — which `firstLine` returns with or without dedupe, so removing the dedupe left it green. It is now anchored on the location column, which is what the dedupe actually buys.
