<p align="center">
  <img src="thumbnail.png" alt="LinkedIn Spider" width="600">
</p>

<h1 align="center">LinkedIn Spider 🍻</h1>

<p align="center">
  <a href="README.md"><img src="https://img.shields.io/badge/%F0%9F%87%A9%F0%9F%87%AA_Deutsch-Dokumentation-black?style=for-the-badge" alt="Deutsch"></a>
  &nbsp;&nbsp;
  <a href="README_EN.md"><img src="https://img.shields.io/badge/%F0%9F%87%AC%F0%9F%87%A7_English-Documentation-black?style=for-the-badge" alt="English"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-2.10.0-blue?style=flat-square" alt="Version">
  <img src="https://img.shields.io/badge/manifest-v3-green?style=flat-square&logo=googlechrome&logoColor=white" alt="Manifest V3">
  <img src="https://img.shields.io/badge/world-MAIN_%2B_ISOLATED-8957e5?style=flat-square" alt="MAIN + ISOLATED world">
  <img src="https://img.shields.io/badge/platform-Chrome-yellow?style=flat-square&logo=googlechrome&logoColor=white" alt="Chrome">
  <img src="https://img.shields.io/badge/language-JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black" alt="JavaScript">
  <img src="https://img.shields.io/github/license/pepperonas/linkedin-spider?style=flat-square" alt="License">
</p>

<p align="center">
  <img src="https://img.shields.io/github/actions/workflow/status/pepperonas/linkedin-spider/test.yml?branch=main&label=tests&style=flat-square&logo=github" alt="CI">
  <img src="https://img.shields.io/github/last-commit/pepperonas/linkedin-spider?style=flat-square&color=purple" alt="Last Commit">
  <img src="https://img.shields.io/github/repo-size/pepperonas/linkedin-spider?style=flat-square&color=orange" alt="Repo Size">
  <img src="https://img.shields.io/github/stars/pepperonas/linkedin-spider?style=flat-square" alt="Stars">
  <img src="https://img.shields.io/github/forks/pepperonas/linkedin-spider?style=flat-square" alt="Forks">
  <img src="https://img.shields.io/github/issues/pepperonas/linkedin-spider?style=flat-square" alt="Issues">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/self--healing-enabled-success?style=flat-square&logo=shield&logoColor=white" alt="Self-Healing">
  <img src="https://img.shields.io/badge/API-LinkedIn_Voyager-0A66C2?style=flat-square&logo=linkedin&logoColor=white" alt="LinkedIn Voyager API">
  <img src="https://img.shields.io/badge/auto--recovery-DOM_%2B_API-brightgreen?style=flat-square" alt="Auto Recovery">
  <img src="https://img.shields.io/badge/rate_limit-1.5s_interval-informational?style=flat-square" alt="Rate Limit">
  <img src="https://img.shields.io/badge/i18n-7_languages-ff69b4?style=flat-square" alt="i18n">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/tests-346_passing-success?style=flat-square&logo=vitest&logoColor=white" alt="Tests">
  <img src="https://img.shields.io/badge/tested_with-Vitest-6E9F18?style=flat-square&logo=vitest&logoColor=white" alt="Vitest">
  <img src="https://img.shields.io/badge/DOM-jsdom-15a2bb?style=flat-square" alt="jsdom">
  <img src="https://img.shields.io/badge/build-no_build_step-brightgreen?style=flat-square" alt="No Build Step">
  <img src="https://img.shields.io/badge/dependencies-zero_runtime-success?style=flat-square" alt="Zero Dependencies">
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square" alt="PRs Welcome">
</p>

<p align="center">
  <a href="https://www.paypal.com/donate/?business=martinpaush@gmail.com&currency_code=EUR"><img src="https://img.shields.io/badge/Sponsor_this_project-PayPal-00457C?style=for-the-badge&logo=paypal&logoColor=white" alt="Donate via PayPal"></a>
</p>

<p align="center">
  Chrome Extension (Manifest V3) that automatically sends connection requests on LinkedIn search result pages — <b>with self-healing detection against LinkedIn's DOM and API changes</b>.
</p>

## How It Works

The extension scans LinkedIn search results for "Connect" buttons and sends connection requests directly via the LinkedIn Voyager API. If the API call fails (but is not rate-limited), a click fallback is used automatically — which also triggers LinkedIn's real request, from which the extension re-calibrates itself.

**Technical Details:**
- Multi-tier, language-agnostic button detection: `aria-label` patterns, visible text (6 languages) **and** `href` heuristic (`search-custom-invite`), plus a legacy `data-view-name` strategy
- Robust profile ID extraction: `componentkey="SearchResults…"` **or** any attribute carrying a `urn:li:fsd_profile:` ID
- API call to `/voyager/api/voyagerRelationshipsDashMemberRelationships`
- Click fallback with `realClick()` (full pointer+mouse event sequence) when the API fails
- Rate limiting: 1 request every 1.5 seconds
- Automatic 60s pause on LinkedIn 429 rate limit
- CSRF token extracted from `JSESSIONID` cookie (injected fresh on every request)
- Profile-ID-based tracking prevents duplicate processing after DOM replacement

## 🧬 Self-Healing (NEW in 2.7.0)

LinkedIn constantly changes its frontend (CSS classes, DOM structure) and its internal APIs — the most common reason tools like this break overnight. LinkedIn Spider defends against this on **two layers**:

1. **Resilient DOM detection** — survives renamed hashed classes, restructured DOM and language switches, because it detects via `aria-label`, text *and* `href` instead of brittle CSS selectors.
2. **API auto-capture** — an interceptor in the page's MAIN world (`interceptor.js`) listens to LinkedIn's own invite request and learns its current shape (a "recipe": URL, headers, body). Subsequent requests are sent via that learned recipe.

**The self-healing loop:** if the API path breaks → the click fallback fires → LinkedIn issues its own request → the interceptor captures it → from then on the fast API path works again automatically. A stale recipe is discarded on error and re-learned. The learned recipe is persisted in `chrome.storage`; the popup shows the API mode (`default` vs `self-healed ✓`).

> **Limitation:** the extension cannot guess a completely unknown API contract — it needs **one** working real click to re-learn. As long as LinkedIn's click path works (which practically never fully disappears), the API path heals itself from it.

## Features

- 🧬 **Self-healing** against DOM and API changes (see above)
- 🌐 **Multilingual** — detection in DE / EN / FR / IT / ES / NL / PT
- ON/OFF toggle via popup
- Request counter (persistent in `chrome.storage`)
- API mode indicator in the popup (`default` / `self-healed ✓`)
- Reset counter
- 📊 **Weekly quota in the popup** — 200 free connection requests per week, used/remaining with a progress bar (plus the rolling 7-day figure); also shown on the in-page badge
- 📈 **Activity chart** with a selectable period (7 d / 30 d / 90 d / 1 year) — in the popup and in the HTML report
- 💾 **Backup & restore** — export and re-import every stored value as JSON
- 📇 **Contact log** — every sent request is stored permanently (name, date, profile URL, headline, company, location, connection degree, profile ID, send path, search page)
- ⬇ **CSV export** from the popup — spreadsheet-ready (semicolon + UTF-8 BOM), file name with a date stamp pre-filled in the save dialog
- 📊 **HTML report export** — a self-contained file with the chart, the quota and the contact table, no external assets
- 🔖 **Version number + links in the popup footer** (SemVer)
- 🔗 **celox ops integration** — sent requests as Rainmaker leads (status "contacted"), via CSV import in ops or pushed from the extension (service worker, optionally automatic)
- 🔁 **Cross-session duplicate guard** — anyone in the log is never asked again
- Visual status badge (bottom right on page)
- Successful connections are marked with a 🍻 emoji — with a Material 3 Expressive physics animation (gravity drop, impact squash & decaying bounces) and a custom tooltip on hover
- Real-time status display in badge
- Automatic rate limit detection with 60s pause
- Click fallback detects "Pending" status change as success
- DOM scan on load (debug output in console)

## Installation

### Option 1: Download (recommended)

1. **[Download latest release](https://github.com/pepperonas/linkedin-spider/releases/latest)** — ZIP file under "Assets"
2. Unzip — this creates a `linkedin-spider` folder
3. Open Chrome and navigate to `chrome://extensions`
4. Enable **Developer mode** (toggle in top right)
5. Click **"Load unpacked"**
6. Select the unzipped `linkedin-spider` folder
7. The extension appears in the Chrome toolbar

### Option 2: Clone repository

```bash
git clone https://github.com/pepperonas/linkedin-spider.git
```

1. Open Chrome: `chrome://extensions`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the cloned folder

> **Note:** After each code update, click the refresh icon on the extension card **and** reload the LinkedIn tab (F5) — otherwise the old content script keeps running with an invalidated context.

## Usage

<p align="center">
  <img src="screenshot-popup.png" width="302" alt="Popup: weekly quota 164 of 200 with an amber bar, activity chart with period chips, figures, export and backup buttons, footer with version and links">
</p>

<p align="center">
  <em>The popup in use. At the top the weekly quota — 164 of 200 used, the bar turns amber past
  80&nbsp;%. Below it the activity chart (the running column is drawn lighter), the three figures,
  the exports, and the footer with the version and the links.</em>
</p>

1. Open LinkedIn people search (e.g. `https://www.linkedin.com/search/results/people/`)
2. Click the extension icon in the Chrome toolbar
3. Switch the toggle to ON
4. The badge in the bottom right shows progress in real time

**Weekly quota:**

LinkedIn allows **200 connection requests per week** for free. The top of the popup shows how many of those the current week has used, how many are left and when the allowance resets. The bar turns amber past 80 % and red once nothing is left.

- **Week = calendar week, starting Monday 00:00 local time.** Next to it sits the **rolling 7-day count** — LinkedIn throttles on a sliding window, so a Sunday-plus-Monday burst can trip it while the calendar week still looks harmless.
- The count comes from a separate list of timestamps (`lcEvents`), **not** from the contact log: that one is deduplicated, capped and user-clearable, so it would under-report. `Clear Log` therefore wipes the contacts, **not** the quota history.
- The in-page badge carries the figure permanently (`🕸️ ✅ #12 Name · 43/200 wk`) so the quota is visible exactly while requests are going out.
- On the first run after the update the history is seeded once from the timestamps already in the contact log.
- The extension does **not** stop itself at 200 — the display informs, the decision stays with the user.

> **Why "Requests sent" can exceed "Saved contacts":**
> the counter has been running since the first install, the contact log only since **2.8.0**.
> The quota and the chart are fed by the log, so they cannot reach further back than the day
> the log was created. In the screenshot above that is 1259 requests sent against 164 logged.

**Activity:**

Below the quota sits a bar chart of the requests sent. The period is picked with chips and is remembered (`chrome.storage`):

| Period | Resolution | Columns |
|--------|------------|---------|
| 7 d | day | 7 |
| 30 d | day | 30 |
| 90 d | week (Mon–Sun) | 13 |
| 1 y | month | 12 |

The running column is drawn lighter and marked "in progress" in its tooltip — otherwise the unfinished day reads as a slump. The chart is hand-written inline SVG: a Chrome popup runs under `script-src 'self'`, so a CDN chart library cannot load at all — and a bundled one would be the extension's only runtime dependency.

**Exporting contacts:**

Every successful request lands in the log (`Saved contacts` in the popup). **⬇ Export contacts as CSV** opens the save dialog with a suggested name like `linkedin-spider-anfragen-2026-08-30_1432.csv`.

| Column | Content |
|--------|---------|
| Datum | Time of the request, local time (`30.08.2026 14:32`) |
| Name | Name from the result card or the `aria-label` |
| Profil-URL | `https://www.linkedin.com/in/<vanity>` |
| Headline | Position line of the result card |
| Firma | Company link on the card, otherwise split off the headline (`… bei/at/@ …`) |
| Ort | Location line of the result card |
| Grad | Connection degree (`1.` / `2.` / `3.`) |
| Profil-ID | LinkedIn member URN ID |
| Methode | `api` (direct Voyager call) or `click` (fallback) |
| Suchseite | URL the request was triggered from |

Card fields are best-effort: if LinkedIn changes its DOM, the affected column stays empty — sending is unaffected. The export reads `chrome.storage` directly, so it also works when the popup is opened over a non-LinkedIn tab. **Clear Log** wipes the log (two clicks) and thereby lifts the duplicate guard.

**Exporting a report (with the chart):**

**📊 Report** writes a self-contained HTML file (`linkedin-spider-report-2026-09-01_1432.html`): the weekly quota, the chart for the **currently selected** period and the full contact table. Everything is inline — no script, no CDN, no external font; the file opens offline from disk.

**Backup & restore:**

- **💾 Backup** writes every stored value as JSON (`linkedin-spider-backup-2026-09-01_1432.json`): contact log, quota history, counter, selected period and the learned API recipe.
- **↺ Restore** reads such a file back, in two steps: pick the file, then a second click confirms the overwrite.
- **The import is strict.** Foreign or damaged files are rejected **whole** (plain-language error in the popup) and nothing is written. App marker, type and schema version are checked; a newer schema is rejected rather than half-read. Unknown fields in contact records are dropped, broken counters/timestamps/periods are coerced to valid values.
- **Security:** session headers (`csrf-token`, `cookie`, `authorization`) are **stripped** from the recipe before it reaches the file — a backup you pass on carries no session token. Nothing is lost functionally: a fresh CSRF token is injected on every send anyway.
- **A restore never starts sending.** `Auto-Connect` is always OFF afterwards, whatever the file said.

**Pushing leads into celox ops (from 2.10.0):**

Every sent connection request can land in [celox ops](https://ops.celox.io) as a lead — a
`RainmakerLead` with status **"contacted"** and source `linkedin-spider`. ops recognises people who
are already in your pipeline by their profile URL and **only fills in what is missing** — nothing is
overwritten, nobody is moved backwards. A duplicate import is impossible on the database side.

Two paths, one mapping:

| Path | Where | When |
|------|-------|------|
| **CSV import** | ops → Pipeline → **"Spider-CSV"** | The export from above, with a preview (new / updated / already there) before anything is written. No token needed. |
| **Push from the extension** | popup row `ops: … pending` → **Sync**, or automatically after every send | Runs in the service worker, so it survives the popup closing. |

Setup for the push: in ops under **Einstellungen → "API-Token für LinkedIn Spider"** create a token
(shown exactly once), then in the popup click ⚙ → paste the token → **Test connection** → **Save**.
Optionally enable **"Sync automatically"**.

- In ops the token can **only import leads** — it cannot read, change or delete anything. It is stored
  in this browser profile only and is never sent anywhere else.
- The sync state lives in its own storage key (`lcOpsState`), apart from the log: the worker never
  writes `lcLog` while the content script is appending to it.
- Failed pushes (network down, token revoked) stay pending and are retried on the next sync; the error
  is shown in the popup row. What ops rejects as invalid (no LinkedIn profile URL) is not retried forever.
- **What the extension cannot claim:** that a request was accepted. It only sees the send; `connected`
  is set by hand in ops.

**Popup footer:**

The bottom of the popup carries the **version number** (SemVer, read straight from `manifest.json` — never hard-coded) plus links to [celox.io](https://celox.io), the [Google Maps review page](https://g.page/r/CXgdRV3QysvxEBM/review) and a PayPal donation to `martin.pfeffer@celox.io`.

**Status Badge:**
- "🕸️ ready" (grey) — Extension loaded, inactive
- "🕸️ Active (X sent)" (green) — Running, X requests sent
- "🕸️ ⏳ Name..." (LinkedIn blue) — Request being sent
- "🕸️ 🧬 Recipe learned" (purple) — API request successfully learned (self-healing)
- "🕸️ ✅ #X Name · 43/200 wk" (dark green) — Successful request; the suffix is the weekly standing
- "🕸️ ❌ Rate-Limit! 60s pause..." (red) — LinkedIn 429, waiting automatically
- "🕸️ ❌ No CSRF Token!" (red) — API error
- "🕸️ ⚠️ Reload this page" (red) — the extension was updated and this tab still runs the old content script. **Reload the page** and it continues

## Architecture

Two content-script worlds plus the popup:

| File | World | Role |
|------|-------|------|
| `interceptor.js` | **MAIN** (`document_start`) | Patches `fetch`/`XMLHttpRequest`, captures LinkedIn's invite request, posts the "recipe" via `postMessage` |
| `lib.js` | ISOLATED | Pure, testable core functions: selectors, recipe building, invite detection, quota/chart maths, SVG chart, backup format |
| `content.js` | ISOLATED | Orchestration: DOM scan, recipe-driven API calls, click fallback, recipe learning, badge, quota history |
| `popup.html` / `popup.js` | — | Popup UI: toggle, quota, chart, counter, API mode, ops row, CSV/HTML/backup export, restore, footer (loads `lib.js` too) |
| `background.js` | service worker | ops sync: answers `opsSync`/`opsTest` messages and (with auto-sync) reacts to new log entries; the logic itself is `lib.js::opsSyncRun` with `fetch` injected |
| `options.html` / `options.js` / `options.css` | — | Options page: ops URL, API token, auto-sync, connection test, sync state, "Forget sync state" |
| `styles.css` | — | Popup styling |
| `manifest.json` | — | Chrome Extension Manifest V3 |
| `icon.png` | — | Extension icon |

## Tests

```bash
npm install
npm test
```

**346 unit and integration tests** with Vitest + jsdom (the timezone is pinned to `Europe/Berlin` in `vitest.config.js` — the quota and chart maths are calendar-local, and the bug naive millisecond arithmetic causes only exists where clocks actually shift):
- `test/lib.test.js` — core functions, self-healing helpers (recipe building, invite detection), multilingual detection
- `test/export.test.js` — name cleaning, card scraping, CSV generation (quoting, injection guard, BOM), file name, log cap
- `test/content-log.test.js` — loads `content.js` for real and drives a full tick: a successful send lands in the log with its card data, duplicate guard holds
- `test/popup-export.test.js` — loads `popup.html` + `popup.js` for real: export download, cancel behaviour, two-step clear
- `test/content.test.js` — integration tests for message handling and DOM interaction
- `test/popup.test.js` — popup UI and Chrome API tests
- `test/stats.test.js` — quota maths (calendar week, rolling 7 days, clamping), bucketing per period, SVG chart (scaling, running column, escaping, empty state)
- `test/backup.test.js` — backup format, secret stripping, strict import validation (foreign/damaged/too-new files)
- `test/popup-stats.test.js` — loads `popup.html` + `popup.js` for real: quota display, chart + period selection, HTML report, backup/restore round-trip, footer links
- `test/report.test.js` — HTML report: self-containment (no script, no external reference), escaping of scraped names, quota/period figures, empty state
- `test/styles.test.js` — contrast floors (4.5:1 / 3:1) for the popup **and** the report stylesheet, button-row layout contract, every id `popup.js` reaches for exists in the markup
- `test/resilience.test.js` — behaviour after an extension reload (badge notice, timer torn down, `getStatus` reports it) + a runtime cap on the backfill
- `test/ops-sync.test.js` — the sync core (`opsSyncRun` with `fetch` injected): bearer token, batching, matching by response index, 401/network errors leave the state untouched, "invalid" is not retried forever
- `test/background.test.js` — loads `background.js` for real: sync on message, debounced auto-sync, never two runs at once, `lcLog` is never touched
- `test/options.test.js` — loads `options.html` + `options.js` for real: validation, host permission, connection test, sync state, two-step forget
- `test/version.test.js` — SemVer, parity between `manifest.json`, `package.json` and the README badge, footer contract, **documentation integrity** (no dead image reference, every image has alt text, both READMEs list exactly the test files that exist)
- `test/release.test.js` — checks the release ZIP contains every file the manifest references

Single file / single test:
```bash
npx vitest run test/lib.test.js
npx vitest run -t "buildInviteRequest"
```

## CI/CD

- **Tests** — Run automatically on push to `main` and on pull requests
- **Release** — On push of a `v*` tag, tests are run and a GitHub Release with ZIP is created

## Changelog

### 2.10.0 — celox ops integration

- **Leads into ops**: every sent request as a `RainmakerLead` with status "contacted" and source `linkedin-spider`. ops deduplicates on the normalised profile URL (unique index per workspace) and, on a match, fills only empty fields — never overwrites, never moves a lead backwards
- **Two paths, one mapping**: CSV import in ops (Pipeline → "Spider-CSV", with preview) and a push from the extension. The push runs in a new **service worker** (`background.js`) — it survives the popup closing and can deliver automatically after every send (debounced, never two runs in parallel)
- **Options page** (`options.html`) for ops URL, API token, auto-sync and a connection test; the popup shows a single row (`ops: 3 pending · Sync · ⚙`) — it had 4px to spare under Chrome's 600px cap
- The sync state lives in `lcOpsState`, **apart from `lcLog`** — worker and content script never write the same list
- `host_permissions` for `https://ops.celox.io`; a custom ops host is requested via `optional_host_permissions` on save
- ⚠️ **The release guard had a blind spot**: it only knew content scripts and the popup, not `background.service_worker`, `options_ui.page` or `importScripts()` — exactly the kind of gap that shipped 2.7.0–2.7.4 without `interceptor.js`. It now checks every manifest entry point
- Suite 287 → 346; 19 mutation probes, all caught (one only after tightening: matching by response index vs. position was indistinguishable with ordered fixtures)

### 2.9.1 — No longer silent after an update

After the extension is updated, an already-open LinkedIn tab keeps running the
**old** content script — but its link to the extension is gone, so every
`chrome.*` call throws `Extension context invalidated`. Until now the run died
**silently**: no requests, no log entries, an unchanged badge, and a popup that
could not reach the tab yet still showed "Paused". Reloading the page is the
only cure, so that is what it says now.

- **Page badge**: `⚠️ Reload this page` (red) instead of a frozen state. The
  notice is no longer painted over — a later success message would cover the one
  line explaining why nothing is being recorded any more
- The scan timer is torn down instead of firing into the void
- `getStatus` reports `contextGone` so the popup knows
- **Popup**: the status line says `⚠️ Reload the LinkedIn tab` (measured 6.26:1),
  backs its polling off from 1 s to 5 s rather than hammering a silent tab, and
  recovers by itself once the tab answers again. Quota, chart and every export
  keep working throughout — they come from storage, not from the tab
- The toggle no longer implies it started something nobody received
- **Backfill de-quadratified**: the one-off import of history from the contact
  log re-sorted the series on **every** record — measured 619 ms for 5000
  entries, growing as n², synchronously on every page load. Now one pass and one
  sort, with a test capping the runtime
- Suite 263 → 283 tests; 13 new mutation probes, all caught. Two survived at
  first and revealed that the assertions held with or without the fix — since
  tightened. One of those found a real bug in the fix itself: the success
  message was overwriting the warning

### 2.9.0 — Quota, activity, backup

- **Weekly quota in the popup**: 200 free requests per week, used + remaining with a progress bar, reset date, warning colour past 80 % and at 0. Plus the **rolling 7-day count**, because LinkedIn throttles on a sliding window
- The figure also rides on the **in-page badge** — visible exactly while requests are going out
- Counting uses **its own timestamp series** rather than the contact log (that one is deduplicated, capped and clearable, so it would under-report); on the first run after the update it is seeded once from the existing log
- **Activity chart** with a selectable period (7 d / 30 d / 90 d / 1 year), the choice is remembered; hand-written inline SVG with no dependency (a popup runs under `script-src 'self'`). The running column is marked "in progress". It is only redrawn on a real change — the one-second poll would otherwise tear off live tooltips
- **HTML report export**: a self-contained file with the chart, the quota and the contact table, fully inline
- **Backup & restore** of every stored value as JSON. The import is strict (app marker, type, schema; foreign/damaged files are rejected whole without writing anything), session headers are stripped from the recipe before writing, and a restore always leaves `Auto-Connect` OFF
- **SemVer + footer** in the popup: version from the manifest, links to celox.io, the Google Maps review page and a PayPal donation
- `manifest.json` and `package.json` now carry the same version — a test pins it (they had drifted apart across five releases)
- **Popup compacted**: Chrome caps popups at 600px tall and the new blocks pushed the footer below that. The three figures now sit side by side and Report/Backup/Restore share a row. Measured 596–598px depending on state (the hint line is empty or filled); the screenshot above shows 597px
- **Contrast fixed**: the muted tone introduced here measured 3.19:1, below the 4.5:1 floor; every text role now measures 5.0–5.7:1. A test pins the floor — for the popup **and** for the report stylesheet
- Test suite from 136 to 263 tests, every new assertion mutation-probed

### 2.8.0 — Contact log & CSV export

- Every successfully sent request is logged to `chrome.storage.local` (name, timestamp, profile URL, headline, company, location, connection degree, profile ID, send path, search page)
- **CSV export in the popup**: semicolon-separated with a UTF-8 BOM (German Excel opens it straight into columns), file name with a date stamp pre-filled in the save dialog
- Guard against CSV formula injection — scraped names end up in a spreadsheet
- **Cross-session duplicate guard**: already-contacted profiles are not asked again after a reload
- New `downloads` permission
- **Release ZIP fixed**: `interceptor.js` had been missing from the packaging since 2.7.0 even though the manifest declares it as a content script — the ZIPs of releases 2.7.0–2.7.4 are therefore incomplete. A test now pins that the ZIP contains every file the manifest references
- Test suite grown from 67 to 136 tests, every new assertion mutation-tested

### 2.7.4 — Vanity lookup: API path without the overlay
- ✨ **NEW:** Cards without a profile URN in the DOM are now resolved via the card's profile link (`/in/<vanity>`) + a Voyager lookup (`getVanityFromCard` + `resolveProfileIdByVanity`) — these cards take the direct API path too. The click fallback (and thus the invite overlay, which doesn't even open on some pages) is only needed as a last resort
- 🛡️ Ambiguity guard: if the container holds links to *different* profiles (= the whole result list), the lookup aborts instead of inviting the wrong person; resolved IDs are cached and checked against duplicate invitations
- ✅ Test coverage raised from 63 to 67

### 2.7.3 — Pointer events & anti-wedge
- 🛠️ **FIX:** `realClick()` now dispatches a full pointer+mouse sequence (`pointerdown`/`pointerup` + coordinates) — LinkedIn's new SDUI (React) buttons only respond to pointer events, so plain MouseEvents were silently ignored (the click fallback did "nothing")
- 🛠️ **FIX:** Cards without a profile ID whose click fallback keeps failing are skipped after 3 attempts (`data-lc-fails`) — previously a single broken card wedged the whole run forever
- 🛠️ **FIX:** The confirm click is now verified (dialog actually closed?) and retried up to 3×; if the dialog still hangs, it is dismissed after 5 ticks instead of stalling the run
- ⏱️ Post-click dialog wait window raised from 3 s to 6 s (sluggish search pages)
- ✅ Test coverage raised from 60 to 63

### 2.7.2 — Confirm-dialog fix
- 🛠️ **FIX:** LinkedIn changed the dialog wording ("Send without a **message**" instead of "Send without a **note**") — detection now matches both variants via anchored regexes in all 7 languages, so the sibling button ("Send with a message") can never match
- 🛠️ **FIX:** SDUI dialogs without `role="dialog"`/`.artdeco-modal` are found via a document-wide fallback scan
- ✅ Test coverage raised from 56 to 60

### 2.7.1 — 🍻 Material 3 Expressive
- ✨ **NEW:** Animated 🍻 success emoji in Material 3 Expressive style — spatial spring with a gravity drop, impact squash & stretch, decaying bounces (overshoot/settle) and an amber shockwave ring
- ✨ **NEW:** Custom tooltip on hover ("🍻 Networking, bottled and served by LinkedIn Spider") with a spring entrance, viewport clamping and auto-flip; `position: fixed` to escape LinkedIn's overflow clipping
- ♿ Full `prefers-reduced-motion` guard + `role="img"`/`aria-label`

### 2.7.0 — Self-Healing
- 🧬 **NEW:** API auto-capture via a MAIN-world interceptor — learns LinkedIn's current invite endpoint by itself
- 🛠️ **FIX:** Connect buttons were no longer found after LinkedIn's SDUI migration (nested `<span>` hashes, `data-view-name` gone) → detection now via `aria-label` / text / `href`
- 🌐 **NEW:** Multilingual detection (DE/EN/FR/IT/ES/NL/PT) for connect buttons and the confirm dialog
- 🛠️ **FIX:** More robust profile ID extraction — matches any `urn:li:fsd_profile:` ID, not just two fixed attributes
- ✨ Popup shows the API mode (`default` / `self-healed ✓`)
- ✅ Test coverage raised from 40 to 56

### 2.6.0
- English language support, badge messages in English

## Notes

- Only works on `*.linkedin.com` pages
- `interceptor.js` runs in the MAIN world at `document_start`, `lib.js`/`content.js` in the ISOLATED world at `document_idle`
- ON/OFF state persists across LinkedIn page reloads
- Counter and the learned API recipe are saved in `chrome.storage.local`
- Already processed profiles are tracked via an in-memory Set (survives DOM replacement by LinkedIn)
- Modals are automatically skipped (no sending for buttons inside dialogs)

## Security

The CSRF token is automatically extracted from the session cookie and injected fresh on every request (a captured token may have expired). API calls use `credentials: 'include'` and send the `csrf-token` header according to the LinkedIn Voyager protocol. Learned recipes stay local in `chrome.storage` and are never transmitted anywhere.

## Developer

**Martin Pfeffer** — [celox.io](https://celox.io)

## License

MIT — see [LICENSE](LICENSE)
