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
  <img src="https://img.shields.io/badge/version-2.7.3-blue?style=flat-square" alt="Version">
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
  <img src="https://img.shields.io/badge/self--healing-aktiv-success?style=flat-square&logo=shield&logoColor=white" alt="Self-Healing">
  <img src="https://img.shields.io/badge/API-LinkedIn_Voyager-0A66C2?style=flat-square&logo=linkedin&logoColor=white" alt="LinkedIn Voyager API">
  <img src="https://img.shields.io/badge/auto--recovery-DOM_%2B_API-brightgreen?style=flat-square" alt="Auto Recovery">
  <img src="https://img.shields.io/badge/rate_limit-1.5s_interval-informational?style=flat-square" alt="Rate Limit">
  <img src="https://img.shields.io/badge/i18n-7_Sprachen-ff69b4?style=flat-square" alt="i18n">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/tests-63_passing-success?style=flat-square&logo=vitest&logoColor=white" alt="Tests">
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
  Chrome Extension (Manifest V3) zum automatischen Versenden von Kontaktanfragen auf LinkedIn-Suchergebnisseiten — <b>mit selbstheilender Erkennung gegen LinkedIns DOM- und API-Änderungen</b>.
</p>

## Funktionsweise

Die Extension scannt LinkedIn-Suchergebnisse nach "Vernetzen"-Buttons und sendet Kontaktanfragen direkt über die LinkedIn Voyager API. Schlägt die API fehl (aber kein Rate-Limit), wird automatisch ein Click-Fallback verwendet — der zugleich LinkedIns echten Request auslöst, aus dem sich die Extension selbst neu kalibriert.

**Technische Details:**
- Mehrstufige, sprachunabhängige Button-Erkennung: `aria-label`-Muster, sichtbarer Text (6 Sprachen) **und** `href`-Heuristik (`search-custom-invite`), plus Legacy-`data-view-name`-Strategie
- Robuste Profil-ID-Extraktion: `componentkey="SearchResults…"` **oder** jedes Attribut mit einer `urn:li:fsd_profile:`-ID
- API-Aufruf an `/voyager/api/voyagerRelationshipsDashMemberRelationships`
- Click-Fallback mit `realClick()` (volle Pointer-+Maus-Event-Sequenz) wenn die API fehlschlägt
- Rate-Limiting: 1 Anfrage alle 1,5 Sekunden
- Automatische 60s-Pause bei LinkedIn 429 Rate-Limit
- CSRF-Token aus `JSESSIONID`-Cookie (bei jedem Request frisch eingesetzt)
- Profil-ID-basiertes Tracking verhindert doppelte Verarbeitung nach DOM-Ersetzung

## 🧬 Self-Healing (NEU in 2.7.0)

LinkedIn ändert sein Frontend (CSS-Klassen, DOM-Struktur) und seine internen APIs ständig — der häufigste Grund, warum solche Tools über Nacht kaputtgehen. LinkedIn Spider wehrt sich auf **zwei Ebenen** dagegen:

1. **Robuste DOM-Erkennung** — überlebt umbenannte Hash-Klassen, umgebautes DOM und Sprachwechsel, weil sie über `aria-label`, Text *und* `href` erkennt statt über zerbrechliche CSS-Selektoren.
2. **API-Auto-Capture** — ein Interceptor im MAIN-World der Seite (`interceptor.js`) belauscht LinkedIns eigenen Invite-Request und lernt dessen aktuelle Form ("Recipe": URL, Header, Body). Künftige Anfragen werden über dieses gelernte Recipe verschickt.

**Die Selbstheilungs-Schleife:** Bricht der API-Pfad → greift der Klick-Fallback → LinkedIn feuert seinen eigenen Request → der Interceptor schneidet ihn mit → ab dann läuft der schnelle API-Weg automatisch wieder. Ein veraltetes Recipe wird bei Fehler verworfen und neu gelernt. Das gelernte Recipe wird in `chrome.storage` persistiert; das Popup zeigt den API-Modus (`default` bzw. `self-healed ✓`).

> **Grenze:** Die Extension kann keinen völlig unbekannten API-Vertrag erraten — sie braucht **einen** funktionierenden echten Klick, um neu zu lernen. Solange LinkedIns Klick-Pfad funktioniert (der bricht praktisch nie vollständig weg), heilt sich der API-Pfad daraus von selbst.

## Features

- 🧬 **Self-Healing** gegen DOM- und API-Änderungen (siehe oben)
- 🌐 **Mehrsprachig** — Erkennung in DE / EN / FR / IT / ES / NL / PT
- AN/AUS-Schalter über Popup
- Anfragen-Zähler (persistent in `chrome.storage`)
- API-Modus-Anzeige im Popup (`default` / `self-healed ✓`)
- Counter zurücksetzen
- Visuelles Status-Badge (unten rechts auf der Seite)
- Erfolgreiche Vernetzungen werden mit 🍻-Emoji markiert — mit Material-3-Expressive-Physik-Animation (Fall mit Gravitation, Aufprall-Squash & abklingende Bounces) und Custom-Tooltip beim Hover
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

> **Hinweis:** Nach jedem Code-Update das Refresh-Icon auf der Extension-Karte klicken **und** den LinkedIn-Tab neu laden (F5) — sonst läuft der alte Content-Script mit ungültigem Kontext weiter.

## Verwendung

1. LinkedIn-Personensuche öffnen (z.B. `https://www.linkedin.com/search/results/people/`)
2. Extension-Icon in der Chrome-Toolbar anklicken
3. Toggle auf AN schalten
4. Badge unten rechts zeigt Fortschritt in Echtzeit

**Status-Badge:**
- "🕸️ ready" (grau) — Extension geladen, inaktiv
- "🕸️ Active (X sent)" (grün) — Läuft, X Anfragen versendet
- "🕸️ ⏳ Name..." (LinkedIn-Blau) — Anfrage wird gerade gesendet
- "🕸️ 🧬 Recipe learned" (violett) — API-Request erfolgreich gelernt (Self-Healing)
- "🕸️ ✅ #X Name" (dunkelgrün) — Erfolgreiche Anfrage
- "🕸️ ❌ Rate-Limit! 60s pause..." (rot) — LinkedIn 429, wartet automatisch
- "🕸️ ❌ No CSRF Token!" (rot) — API-Fehler

## Architektur

Zwei Content-Script-Welten plus Popup:

| Datei | World | Rolle |
|-------|-------|-------|
| `interceptor.js` | **MAIN** (`document_start`) | Patcht `fetch`/`XMLHttpRequest`, schneidet LinkedIns Invite-Request mit, schickt das "Recipe" per `postMessage` |
| `lib.js` | ISOLATED | Reine, testbare Kernfunktionen: Selektoren, Recipe-Bau, Invite-Erkennung |
| `content.js` | ISOLATED | Orchestrierung: DOM-Scan, recipe-getriebene API-Calls, Click-Fallback, Recipe-Lernen, Badge |
| `popup.html` / `popup.js` | — | Popup-UI: Toggle, Counter, API-Modus |
| `styles.css` | — | Popup-Styling |
| `manifest.json` | — | Chrome Extension Manifest V3 |
| `icon.png` | — | Extension-Icon |

## Tests

```bash
npm install
npm test
```

**63 Unit- und Integrationstests** mit Vitest + jsdom:
- `test/lib.test.js` — Kernfunktionen, Self-Healing-Helfer (Recipe-Bau, Invite-Erkennung), Mehrsprachen-Erkennung
- `test/content.test.js` — Integrationstests für Message-Handling und DOM-Interaktion
- `test/popup.test.js` — Popup-UI und Chrome-API-Tests

Einzelne Datei / einzelner Test:
```bash
npx vitest run test/lib.test.js
npx vitest run -t "buildInviteRequest"
```

## CI/CD

- **Tests** — Laufen automatisch bei Push auf `main` und bei Pull Requests
- **Release** — Bei Push eines `v*`-Tags werden Tests ausgeführt und ein GitHub Release mit ZIP erstellt

## Changelog

### 2.7.3 — Pointer-Events & Anti-Blockade
- 🛠️ **FIX:** `realClick()` sendet jetzt eine volle Pointer-+Maus-Sequenz (`pointerdown`/`pointerup` + Koordinaten) — LinkedIns neue SDUI-(React-)Buttons reagieren nur auf Pointer-Events, reine MouseEvents wurden ignoriert (Klick-Fallback tat „nichts")
- 🛠️ **FIX:** Karten ohne Profil-ID, bei denen der Klick-Fallback wiederholt scheitert, werden nach 3 Versuchen übersprungen (`data-lc-fails`) — vorher blockierte eine einzige kaputte Karte den gesamten Lauf endlos
- 🛠️ **FIX:** Bestätigungs-Klick wird verifiziert (Dialog wirklich zu?) und bis zu 3× wiederholt; hängt der Dialog trotzdem, wird er nach 5 Ticks geschlossen, statt den Lauf zu stoppen
- ⏱️ Dialog-Wartefenster nach dem Klick von 3 s auf 6 s erhöht (träge Suchseiten)
- ✅ Testabdeckung von 60 auf 63 erhöht

### 2.7.2 — Bestätigungsdialog-Fix
- 🛠️ **FIX:** LinkedIn hat den Dialog-Wortlaut geändert („Ohne **Nachricht** senden" statt „Ohne **Notiz** senden") — Erkennung matcht jetzt beide Varianten per Regex in allen 7 Sprachen, verankert, sodass der Nachbar-Button („Nachricht senden") nie getroffen wird
- 🛠️ **FIX:** SDUI-Dialoge ohne `role="dialog"`/`.artdeco-modal` werden über einen dokumentweiten Fallback-Scan gefunden
- ✅ Testabdeckung von 56 auf 60 erhöht

### 2.7.1 — 🍻 Material 3 Expressive
- ✨ **NEU:** Animiertes 🍻-Erfolgs-Emoji im Material-3-Expressive-Stil — spatialer Spring mit Gravitations-Fall, Aufprall-Squash-&-Stretch, abklingenden Bounces (Overshoot/Settle) und Amber-Shockwave-Ring
- ✨ **NEU:** Custom-Tooltip beim Hover („🍻 Networking, bottled and served by LinkedIn Spider") mit Spring-Entrance, viewport-Klemmung und Auto-Flip; `position: fixed`, um LinkedIns Overflow-Clipping zu entgehen
- ♿ Voller `prefers-reduced-motion`-Guard + `role="img"`/`aria-label`

### 2.7.0 — Self-Healing
- 🧬 **NEU:** API-Auto-Capture via MAIN-World-Interceptor — lernt LinkedIns aktuellen Invite-Endpoint selbst
- 🛠️ **FIX:** Connect-Buttons wurden nach Linkedins SDUI-Umstellung nicht mehr gefunden (verschachtelte `<span>`-Hashes, kein `data-view-name` mehr) → Erkennung jetzt über `aria-label` / Text / `href`
- 🌐 **NEU:** Mehrsprachige Erkennung (DE/EN/FR/IT/ES/NL/PT) für Connect-Buttons und Bestätigungsdialog
- 🛠️ **FIX:** Profil-ID-Extraktion robuster — matcht jede `urn:li:fsd_profile:`-ID, nicht nur zwei feste Attribute
- ✨ Popup zeigt den API-Modus (`default` / `self-healed ✓`)
- ✅ Testabdeckung von 40 auf 56 erhöht

### 2.6.0
- Englische Sprachunterstützung, Badge-Meldungen auf Englisch

## Hinweise

- Funktioniert nur auf `*.linkedin.com`-Seiten
- `interceptor.js` läuft im MAIN-World bei `document_start`, `lib.js`/`content.js` im ISOLATED-World bei `document_idle`
- Bei Reload der LinkedIn-Seite bleibt der AN/AUS-Status erhalten
- Counter und gelerntes API-Recipe werden in `chrome.storage.local` gespeichert
- Bereits verarbeitete Profile werden per Set im Speicher getrackt (überlebt DOM-Ersetzung durch LinkedIn)
- Modals werden automatisch übersprungen (kein Versand bei Buttons in Dialogen)

## Sicherheit

CSRF-Token wird automatisch aus dem Session-Cookie extrahiert und bei jedem Request frisch eingesetzt (ein mitgeschnittenes Token könnte abgelaufen sein). API-Calls nutzen `credentials: 'include'` und senden den `csrf-token`-Header gemäß LinkedIn Voyager-Protokoll. Gelernte Recipes verbleiben lokal in `chrome.storage` und werden nicht nach außen übertragen.

## Entwickler

**Martin Pfeffer** — [celox.io](https://celox.io)

## Lizenz

MIT — siehe [LICENSE](LICENSE)
