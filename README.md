# LinkedIn Auto-Connect

Chrome Extension (Manifest V3) zum automatischen Versenden von Kontaktanfragen auf LinkedIn-Suchergebnisseiten.

**Version:** 2.2.0

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
