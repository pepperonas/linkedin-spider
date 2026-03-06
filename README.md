<p align="center">
  <img src="icon.png" alt="LinkedIn Auto-Connect" width="128" height="128">
</p>

<h1 align="center">LinkedIn Auto-Connect</h1>

<p align="center">
  <img src="https://img.shields.io/badge/version-2.2.0-blue?style=flat-square" alt="Version">
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
- Verarbeitete Buttons werden ausgegraut (opacity 0.5)
- Echtzeit-Statusanzeige im Badge
- Automatische Rate-Limit-Erkennung mit 60s Pause
- Click-Fallback erkennt "Ausstehend"-Statuswechsel als Erfolg
- DOM-Scan beim Laden (Debug-Output in Console)

## Installation

1. Repository klonen oder herunterladen
2. Chrome öffnen: `chrome://extensions`
3. "Entwicklermodus" aktivieren (oben rechts)
4. "Entpackte Erweiterung laden" klicken
5. Projektordner auswählen

## Verwendung

1. LinkedIn-Personensuche öffnen (z.B. `https://www.linkedin.com/search/results/people/`)
2. Extension-Icon in der Chrome-Toolbar anklicken
3. Toggle auf AN schalten
4. Badge unten rechts zeigt Fortschritt in Echtzeit

**Status-Badge:**
- "LC: bereit" (grau) — Extension geladen, inaktiv
- "LC: Aktiv (X gesendet)" (grün) — Läuft, X Anfragen versendet
- "LC: Sende an Name..." (LinkedIn-Blau) — Anfrage wird gerade gesendet
- "LC: #X Name" (dunkelgrün) — Erfolgreiche Anfrage
- "LC: Rate-Limit! 60s Pause..." (rot) — LinkedIn 429, wartet automatisch
- "LC: Fehler XXX" (rot) — API-Fehler

## Dateien

- `manifest.json` — Chrome Extension Manifest V3
- `content.js` — Kernlogik: DOM-Scanning, API-Calls, Click-Fallback, Badge
- `popup.html` — Popup-UI mit Toggle und Counter
- `popup.js` — Popup-Logik und Messaging
- `styles.css` — Popup-Styling
- `icon.png` — Extension-Icon

## Hinweise

- Funktioniert nur auf `*.linkedin.com`-Seiten
- Content Script läuft bei `document_idle`
- Bei Reload der LinkedIn-Seite bleibt der AN/AUS-Status erhalten
- Counter wird in `chrome.storage.local` gespeichert
- Bereits verarbeitete Profile werden per Set im Speicher getrackt (überlebt DOM-Ersetzung durch LinkedIn)
- Modals werden automatisch übersprungen (kein Versand bei Buttons in Dialogen)

## Sicherheit

CSRF-Token wird automatisch aus Session-Cookie extrahiert. API-Calls nutzen `credentials: 'include'` und senden den `csrf-token`-Header gemäß LinkedIn Voyager-Protokoll.
