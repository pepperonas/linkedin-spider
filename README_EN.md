<p align="center">
  <img src="thumbnail.png" alt="LinkedIn Spider" width="600">
</p>

<h1 align="center">LinkedIn Spider</h1>

<p align="center">
  <a href="README.md"><img src="https://img.shields.io/badge/%F0%9F%87%A9%F0%9F%87%AA_Deutsch-Dokumentation-black?style=for-the-badge" alt="Deutsch"></a>
  &nbsp;&nbsp;
  <a href="README_EN.md"><img src="https://img.shields.io/badge/%F0%9F%87%AC%F0%9F%87%A7_English-Documentation-black?style=for-the-badge" alt="English"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-2.6.0-blue?style=flat-square" alt="Version">
  <img src="https://img.shields.io/badge/manifest-v3-green?style=flat-square&logo=googlechrome&logoColor=white" alt="Manifest V3">
  <img src="https://img.shields.io/badge/platform-Chrome-yellow?style=flat-square&logo=googlechrome&logoColor=white" alt="Chrome">
  <img src="https://img.shields.io/badge/language-JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black" alt="JavaScript">
  <img src="https://img.shields.io/github/license/pepperonas/linkedin-spider?style=flat-square" alt="License">
</p>

<p align="center">
  <img src="https://img.shields.io/github/last-commit/pepperonas/linkedin-spider?style=flat-square&color=purple" alt="Last Commit">
  <img src="https://img.shields.io/github/repo-size/pepperonas/linkedin-spider?style=flat-square&color=orange" alt="Repo Size">
  <img src="https://img.shields.io/github/stars/pepperonas/linkedin-spider?style=flat-square" alt="Stars">
  <img src="https://img.shields.io/github/forks/pepperonas/linkedin-spider?style=flat-square" alt="Forks">
  <img src="https://img.shields.io/github/issues/pepperonas/linkedin-spider?style=flat-square" alt="Issues">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/API-LinkedIn_Voyager-0A66C2?style=flat-square&logo=linkedin&logoColor=white" alt="LinkedIn Voyager API">
  <img src="https://img.shields.io/badge/rate_limit-1.5s_interval-informational?style=flat-square" alt="Rate Limit">
  <img src="https://img.shields.io/badge/build-no_build_step-brightgreen?style=flat-square" alt="No Build Step">
  <img src="https://img.shields.io/badge/dependencies-zero-success?style=flat-square" alt="Zero Dependencies">
</p>

<p align="center">
  <a href="https://www.paypal.com/donate/?business=martinpaush@gmail.com&currency_code=EUR"><img src="https://img.shields.io/badge/Sponsor_this_project-PayPal-00457C?style=for-the-badge&logo=paypal&logoColor=white" alt="Donate via PayPal"></a>
</p>

<p align="center">
  Chrome Extension (Manifest V3) that automatically sends connection requests on LinkedIn search result pages.
</p>

## How It Works

The extension scans LinkedIn search results for "Connect" buttons and sends connection requests directly via the LinkedIn Voyager API. If the API call fails (but is not rate-limited), a click fallback is used automatically.

**Technical Details:**
- 3-tier button detection: `data-view-name` attribute, text search ("Vernetzen"/"Connect"), `aria-label` matching
- Profile ID extraction from `componentkey` attribute in the DOM tree
- API call to `/voyager/api/voyagerRelationshipsDashMemberRelationships`
- Click fallback with `realClick()` (mousedown/mouseup/click events) when API fails
- Rate limiting: 1 request every 1.5 seconds
- Automatic 60s pause on LinkedIn 429 rate limit
- CSRF token extracted from `JSESSIONID` cookie
- Profile-ID-based tracking prevents duplicate processing after DOM replacement

## Features

- ON/OFF toggle via popup
- Request counter (persistent in `chrome.storage`)
- Reset counter
- Visual status badge (bottom right on page)
- Successful connections are marked with a 🍻 emoji
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

## Usage

1. Open LinkedIn people search (e.g. `https://www.linkedin.com/search/results/people/`)
2. Click the extension icon in the Chrome toolbar
3. Switch the toggle to ON
4. The badge in the bottom right shows progress in real time

**Status Badge:**
- "🕸️ ready" (grey) — Extension loaded, inactive
- "🕸️ Active (X sent)" (green) — Running, X requests sent
- "🕸️ ⏳ Name..." (LinkedIn blue) — Request being sent
- "🕸️ ✅ #X Name" (dark green) — Successful request
- "🕸️ ❌ Rate-Limit! 60s pause..." (red) — LinkedIn 429, waiting automatically
- "🕸️ ❌ No CSRF Token!" (red) — API error

## Files

- `manifest.json` — Chrome Extension Manifest V3
- `lib.js` — Extracted, testable core functions (DOM selectors, click events)
- `content.js` — Main logic: DOM scanning, API calls, click fallback, badge
- `popup.html` — Popup UI with toggle and counter
- `popup.js` — Popup logic and messaging
- `styles.css` — Popup styling
- `icon.png` — Extension icon

## Tests

```bash
npm install
npm test
```

40 unit and integration tests with Vitest + jsdom:
- `test/lib.test.js` — Tests for all extracted core functions
- `test/content.test.js` — Integration tests for message handling and DOM interaction
- `test/popup.test.js` — Popup UI and Chrome API tests

## CI/CD

- **Tests** — Run automatically on push to `main` and on pull requests
- **Release** — On push of a `v*` tag, tests are run and a GitHub Release with ZIP is created

## Notes

- Only works on `*.linkedin.com` pages
- Content script runs at `document_idle`
- ON/OFF state persists across LinkedIn page reloads
- Counter is saved in `chrome.storage.local`
- Already processed profiles are tracked via an in-memory Set (survives DOM replacement by LinkedIn)
- Modals are automatically skipped (no sending for buttons inside dialogs)

## Security

The CSRF token is automatically extracted from the session cookie. API calls use `credentials: 'include'` and send the `csrf-token` header according to the LinkedIn Voyager protocol.
