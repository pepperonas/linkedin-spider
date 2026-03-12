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
  Chrome Extension (Manifest V3) zum automatischen Versenden von Kontaktanfragen auf LinkedIn-Suchergebnisseiten.
</p>

## Funktionsweise

Die Extension scannt LinkedIn-Suchergebnisse nach "Vernetzen"-Buttons und sendet Kontaktanfragen direkt über die LinkedIn Voyager API. Falls die API fehlschlägt (aber kein Rate-Limit), wird automatisch ein Click-Fallback verwendet.

**Technische Details:**
- 3-stufige Button-Erkennung: `data-view-name`-Attribut, Textsuche ("Vernetzen"/"Connect"), `aria-label`-Matching
- Profil-ID-Extraktion aus `componentkey`-Attribut im DOM-Baum
- API-Aufruf an `/voyager/api/voyagerRelationshipsDashMemberRelationships`
- Click-Fallback mit `realClick()` (mousedown/mouseup/click Events) wenn API fehlschlägt
- Rate-Limiting: 1 Anfrage alle 1,5 Sekunden
- Automatische 60s-Pause bei LinkedIn 429 Rate-Limit
- CSRF-Token aus `JSESSIONID`-Cookie
- Profil-ID-basiertes Tracking verhindert doppelte Verarbeitung nach DOM-Ersetzung

## Features

- AN/AUS-Schalter über Popup
- Anfragen-Zähler (persistent in `chrome.storage`)
- Counter zurücksetzen
- Visuelles Status-Badge (unten rechts auf der Seite)
- Erfolgreiche Vernetzungen werden mit 🍻-Emoji markiert
- Echtzeit-Statusanzeige im Badge
- Automatische Rate-Limit-Erkennung mit 60s Pause
- Click-Fallback erkennt "Ausstehend"-Statuswechsel als Erfolg
- DOM-Scan beim Laden (Debug-Output in Console)

## Installation

### Option 1: Download (empfohlen)

1. **[Neueste Version herunterladen](https://github.com/pepperonas/linkedin-spider/releases/latest)** — ZIP-Datei unter "Assets"
2. ZIP entpacken — es entsteht ein Ordner `linkedin-spider`
3. Chrome öffnen und `chrome://extensions` in die Adressleiste eingeben
4. **Entwicklermodus** aktivieren (Schalter oben rechts)
5. **"Entpackte Erweiterung laden"** klicken
6. Den entpackten `linkedin-spider`-Ordner auswählen
7. Die Extension erscheint in der Chrome-Toolbar

### Option 2: Repository klonen

```bash
git clone https://github.com/pepperonas/linkedin-spider.git
```

1. Chrome öffnen: `chrome://extensions`
2. "Entwicklermodus" aktivieren (oben rechts)
3. "Entpackte Erweiterung laden" klicken
4. Den geklonten Ordner auswählen

## Verwendung

1. LinkedIn-Personensuche öffnen (z.B. `https://www.linkedin.com/search/results/people/`)
2. Extension-Icon in der Chrome-Toolbar anklicken
3. Toggle auf AN schalten
4. Badge unten rechts zeigt Fortschritt in Echtzeit

**Status-Badge:**
- "🕸️ ready" (grau) — Extension geladen, inaktiv
- "🕸️ Active (X sent)" (grün) — Läuft, X Anfragen versendet
- "🕸️ ⏳ Name..." (LinkedIn-Blau) — Anfrage wird gerade gesendet
- "🕸️ ✅ #X Name" (dunkelgrün) — Erfolgreiche Anfrage
- "🕸️ ❌ Rate-Limit! 60s pause..." (rot) — LinkedIn 429, wartet automatisch
- "🕸️ ❌ No CSRF Token!" (rot) — API-Fehler

## Dateien

- `manifest.json` — Chrome Extension Manifest V3
- `lib.js` — Extrahierte, testbare Kernfunktionen (DOM-Selektoren, Click-Events)
- `content.js` — Hauptlogik: DOM-Scanning, API-Calls, Click-Fallback, Badge
- `popup.html` — Popup-UI mit Toggle und Counter
- `popup.js` — Popup-Logik und Messaging
- `styles.css` — Popup-Styling
- `icon.png` — Extension-Icon

## Tests

```bash
npm install
npm test
```

40 Unit- und Integrationstests mit Vitest + jsdom:
- `test/lib.test.js` — Tests für alle extrahierten Kernfunktionen
- `test/content.test.js` — Integrationstests für Message-Handling und DOM-Interaktion
- `test/popup.test.js` — Popup-UI und Chrome-API-Tests

## CI/CD

- **Tests** — Laufen automatisch bei Push auf `main` und bei Pull Requests
- **Release** — Bei Push eines `v*`-Tags werden Tests ausgeführt und ein GitHub Release mit ZIP erstellt

## Hinweise

- Funktioniert nur auf `*.linkedin.com`-Seiten
- Content Script läuft bei `document_idle`
- Bei Reload der LinkedIn-Seite bleibt der AN/AUS-Status erhalten
- Counter wird in `chrome.storage.local` gespeichert
- Bereits verarbeitete Profile werden per Set im Speicher getrackt (überlebt DOM-Ersetzung durch LinkedIn)
- Modals werden automatisch übersprungen (kein Versand bei Buttons in Dialogen)

## Sicherheit

CSRF-Token wird automatisch aus Session-Cookie extrahiert. API-Calls nutzen `credentials: 'include'` und senden den `csrf-token`-Header gemäß LinkedIn Voyager-Protokoll.

## Entwickler

**Martin Pfeffer** — [celox.io](https://celox.io)

## Lizenz

MIT — siehe [LICENSE](LICENSE)
