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
  <img src="https://img.shields.io/badge/version-2.7.4-blue?style=flat-square" alt="Version">
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
  <img src="https://img.shields.io/badge/tests-67_passing-success?style=flat-square&logo=vitest&logoColor=white" alt="Tests">
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

1. Open LinkedIn people search (e.g. `https://www.linkedin.com/search/results/people/`)
2. Click the extension icon in the Chrome toolbar
3. Switch the toggle to ON
4. The badge in the bottom right shows progress in real time

**Status Badge:**
- "🕸️ ready" (grey) — Extension loaded, inactive
- "🕸️ Active (X sent)" (green) — Running, X requests sent
- "🕸️ ⏳ Name..." (LinkedIn blue) — Request being sent
- "🕸️ 🧬 Recipe learned" (purple) — API request successfully learned (self-healing)
- "🕸️ ✅ #X Name" (dark green) — Successful request
- "🕸️ ❌ Rate-Limit! 60s pause..." (red) — LinkedIn 429, waiting automatically
- "🕸️ ❌ No CSRF Token!" (red) — API error

## Architecture

Two content-script worlds plus the popup:

| File | World | Role |
|------|-------|------|
| `interceptor.js` | **MAIN** (`document_start`) | Patches `fetch`/`XMLHttpRequest`, captures LinkedIn's invite request, posts the "recipe" via `postMessage` |
| `lib.js` | ISOLATED | Pure, testable core functions: selectors, recipe building, invite detection |
| `content.js` | ISOLATED | Orchestration: DOM scan, recipe-driven API calls, click fallback, recipe learning, badge |
| `popup.html` / `popup.js` | — | Popup UI: toggle, counter, API mode |
| `styles.css` | — | Popup styling |
| `manifest.json` | — | Chrome Extension Manifest V3 |
| `icon.png` | — | Extension icon |

## Tests

```bash
npm install
npm test
```

**67 unit and integration tests** with Vitest + jsdom:
- `test/lib.test.js` — core functions, self-healing helpers (recipe building, invite detection), multilingual detection
- `test/content.test.js` — integration tests for message handling and DOM interaction
- `test/popup.test.js` — popup UI and Chrome API tests

Single file / single test:
```bash
npx vitest run test/lib.test.js
npx vitest run -t "buildInviteRequest"
```

## CI/CD

- **Tests** — Run automatically on push to `main` and on pull requests
- **Release** — On push of a `v*` tag, tests are run and a GitHub Release with ZIP is created

## Changelog

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
