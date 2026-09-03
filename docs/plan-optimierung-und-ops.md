# LinkedIn Spider — Optimierungsplan + Leads in ops

Stand 2026-09-03, Basis v2.9.1 (`77931ae`) und ops `main`. Alle Befunde sind aus
dem Code bzw. aus Messungen dieser Sitzung; Vermutungen sind als solche markiert.

---

## Teil A — Was die Extension noch besser machen kann

Gruppiert nach dem, was es dem Nutzer bringt. Jeder Punkt nennt den Beleg, den
Nutzen und eine Groessenordnung (S = Stunden, M = ein Tag, L = mehrere Tage).

### A1 — Der Lauf verklemmt sich weniger

| # | Befund (Beleg) | Nutzen | Groesse |
|---|---|---|---|
| A1.1 | **Kontingent-Ende wird nicht erkannt.** `trySendWithRecipe` kennt nur `429 → rate_limited` und behandelt jeden anderen Fehler als `error` → Click-Fallback (`content.js:286`). Erreicht LinkedIn sein Wochenlimit, antwortet der `verifyQuotaAndCreateV2`-Endpunkt mit einem anderen Fehler (genauer Status/Body **unbekannt — muss erst mitgeschnitten werden**). Dann faellt JEDE Karte in den Fallback, der je 3 × bis 6 s wartet (`clickFallback`: 20 × 300 ms, `MAX_CLICK_FAILS` = 3) — der Lauf kriecht 18 s pro Karte durch die Liste und markiert alles als „fail". | Sauberer Stopp mit Klartext („Wochenlimit erreicht") statt eines Zombie-Laufs; bindet an die bestehende Kontingent-Anzeige an. | M (Messung + Erkennung + Badge/Popup-Zustand + Tests) |
| A1.2 | **Click-Fallback blockiert bis zu 6 s pro Versuch** — waehrend `pending = true` steht der ganze Lauf. Bei einer Seite mit 10 kaputten Karten sind das 3 Minuten Stillstand. | Kuerzere Wartezeit mit frueher Abbruchbedingung (Dialog erscheint in der Praxis binnen ~1 s oder gar nicht) oder Karte sofort ueberspringen und spaeter erneut versuchen. | S |
| A1.3 | **„Ausstehend"/„Pending"-Erkennung nur DE/EN** (`content.js:387/396`), obwohl Connect- und Dialog-Erkennung 7 Sprachen kennen. Auf FR/ES/IT/PT/NL zaehlt ein erfolgreicher Klick ohne Dialog als Fehlschlag. | Konsistente Mehrsprachigkeit; ein `PENDING_TEXTS`-Array in `lib.js` neben `CONNECT_TEXTS`. | S |
| A1.4 | **Duplikatsperre vergisst nach ~6 Monaten.** `LOG_CAP` = 5000 Zeilen FIFO; bei 200/Woche ist das nach 25 Wochen voll, danach fallen die aeltesten Kontakte raus — und werden wieder anfragbar. Speicher ist nicht der Grund: 5000 Zeilen ≈ 2 MB von 10 MB `storage.local`. | Getrennte, kompakte **ID-Merkliste** (`lcSeen`: nur Profil-IDs, ~20 B je Eintrag → 100 000 IDs ≈ 2 MB) die nie FIFO-t, unabhaengig vom Volltext-Protokoll. | S |
| A1.5 | **Content-Script laeuft auf JEDER LinkedIn-Seite** (`manifest.json`: `*://*.linkedin.com/*`): DOM-Scan, Badge und 1,5-s-Tick auch im Feed, in Messaging, auf Profilen. | Nur auf Suchergebnis-Seiten aktiv werden (URL-Muster `/search/results/`), sonst kein Badge, kein Timer. Weniger Sichtbarkeit fuer LinkedIn, weniger Last, kein 🕸️ im Feed. ⚠️ Vorsicht: SPA-Navigation — der URL-Wechsel muss beobachtet werden (`popstate` + `pushState`-Hook), sonst bleibt die Extension nach einer In-App-Navigation aus. | S–M |

### A2 — Kontoschutz (neu, optional — kein bisheriger Auftrag)

| # | Idee | Nutzen | Groesse |
|---|---|---|---|
| A2.1 | **Tempo-Deckel** neben dem festen 1,5-s-Intervall: „max. N pro Stunde / pro Tag" als Einstellung im Popup, Default aus. Die Kontingent-Historie (`lcEvents`) liefert die Zaehlung bereits. | Weniger Auffaelligkeit gegenueber LinkedIns Missbrauchserkennung (164 Anfragen an einem Tag wie im Screenshot sind ein klares Muster). | S–M |
| A2.2 | **Zufalls-Jitter** auf das Intervall (1,5 s ± 40 %) statt metronomischer Takt. | Dito; billig. | S |
| A2.3 | **Stopp bei X % Kontingent** (z. B. 90 %) als Schalter. | Der Nutzer entscheidet, die Extension haelt sich dran. | S |

Diese drei sind bewusst als *Option* aufgefuehrt: Sie aendern Verhalten und
gehoeren vom Nutzer freigegeben, nicht stillschweigend eingebaut.

### A3 — Wartbarkeit + Tests

| # | Befund (Beleg) | Nutzen | Groesse |
|---|---|---|---|
| A3.1 | **`interceptor.js` und `lib.js` tragen dieselbe Invite-Heuristik doppelt** (MAIN vs. ISOLATED world, `CLAUDE.md`: „keep the two in sync") — nichts erzwingt das. Kein Test erwaehnt `interceptor.js`. | Test, der `looksLikeInvite` aus `interceptor.js` schneidet und gegen `LC.isInviteRequest` mit identischen Eingaben laufen laesst. Drift wird rot. | S |
| A3.2 | `test/content.test.js` + `test/popup.test.js` **simulieren** die Dateien statt sie zu laden (`CLAUDE.md`, Testing conventions). Sie koennen gruen bleiben, waehrend die echte Datei kaputt ist. | Durch Lade-Tests ersetzen (Muster von `content-log.test.js` / `popup-export.test.js`) oder streichen. | S |
| A3.3 | **GitHub Actions auf Node 20** (`actions/checkout@v4`, `setup-node@v4`) — GitHub kuendigt es in jedem Lauf an. | `@v5`. Trivial, aber bevor es hart bricht. | S |
| A3.4 | **`popup.js` liest jede Sekunde `lcLog` + `lcEvents` komplett** (`refreshStatus → loadState`). Gemessen: Rechenkosten 0,3–2,7 ms je Poll, FCP 60 ms bei 1,93 MB — im Harness. Die IPC-/Deserialisierungskosten von echtem `chrome.storage` bei 2 MB sind **nicht gemessen**. | `chrome.storage.onChanged` statt Poll fuer den Speicher (der 1-s-Poll bleibt nur fuer `getStatus`). Erst messen, dann bauen. | S |

### A4 — Verteilung + Updates

| # | Befund (Beleg) | Nutzen | Groesse |
|---|---|---|---|
| A4.1 | **Sideload-ZIPs aktualisieren sich nie.** Niemand mit 2.7.0–2.7.4 hat je erfahren, dass sein Paket ohne `interceptor.js` kam (README-Changelog 2.8.0). Und 2.9.1 existiert genau deshalb, weil ein Update *ohne* Tab-Reload lautlos ausfiel. | **Update-Hinweis im Popup**: einmal am Tag `https://api.github.com/repos/pepperonas/linkedin-spider/releases/latest` (aus dem Popup, kein Tracking, Ergebnis in `storage`), Footer zeigt „2.9.2 verfuegbar ↗". Braucht `host_permissions` fuer `api.github.com`. | S |
| A4.2 | **Chrome Web Store** wuerde A4.1 obsolet machen (Auto-Update) und den Tab-Reload-Fall entschaerfen. Kostet: Listing, Datenschutzerklaerung (Pflicht wegen `downloads` + gespeicherter Personendaten), Review-Risiko wegen Automatisierung auf LinkedIn. | Reichweite + Updates; **aber**: LinkedIn-Automatisierung verstoesst gegen LinkedIns Nutzungsbedingungen, ein Store-Review kann das ablehnen. Entscheidung des Nutzers. | L |

### A5 — Popup-Kleinigkeiten (aus der Feldnutzung)

| # | Befund | Groesse |
|---|---|---|
| A5.1 | Chart bei 7 d nach einem Tag Nutzung: eine Saeule, sechs leer (Screenshot). Ein Hinweis „Verlauf beginnt mit 2.8.0" unter dem Chart, solange die Historie kuerzer als der Zeitraum ist, erklaert das Bild. | S |
| A5.2 | `Requests sent` (1259) vs. `Saved contacts` (164) — inzwischen im README erklaert, im Popup nicht. Tooltip auf der Kachel. | S |

### Empfohlene Reihenfolge fuer Teil A

1. **A1.1 Kontingent-Ende** — der einzige Punkt, der den Lauf real unbrauchbar machen kann; zuerst die echte LinkedIn-Antwort mitschneiden (der Interceptor kann sie loggen), dann bauen.
2. **A1.4 ID-Merkliste** + **A1.3 Pending-Texte** + **A3.1 Paritaets-Test** + **A3.3 Actions** — vier kleine, risikoarme Schritte, ein Release.
3. **A4.1 Update-Hinweis** — verhindert die naechste 2.7.x-Situation.
4. **A1.5 nur Suchseiten** + **A1.2 Fallback-Wartezeit** — sichtbare Verbesserung, braucht Sorgfalt (SPA-Navigation).
5. A2 nur nach ausdruecklicher Freigabe.

---

## Teil B — Leads aus der Extension zuverlaessig in ops abbilden

### B0 — Was ops heute hat (Fakten aus dem Code)

ops kennt **zwei** Lead-Begriffe:

| | `Lead` (`leads`) | `RainmakerLead` (`rainmaker_leads`) |
|---|---|---|
| Zweck | Website-Lead (URL-zentriert, Website-Analyse) | Akquise-Modul „Rainmaker" (Aktivierung, Punkte, Streak, Heute-Queue) |
| LinkedIn-Feld | keins | **`linkedin_url`** mit generierter Spalte `linkedin_norm` |
| Dedup | keine Unique-Constraint auf `url` — Doppelimport moeglich | **Unique-Index je Owner auf `linkedin_norm`** (`uq_rainmaker_lead_owner_linkedin`) + `find_duplicate_lead` vor dem Insert (409 mit `existing_id`) |
| Status | neu / kontaktiert / interessiert / abgelehnt | new / **contacted** („angeschrieben, Annahme steht aus") / **connected** („LinkedIn: Anfrage angenommen") / in_conversation / proposal / won / lost / dormant |
| Herkunft | — | `source` (String 255) |

**Die richtige Landezone ist `RainmakerLead`.** Der Status `contacted` ist wortwoertlich
das, was die Extension weiss; `linkedin_norm` ist genau der Schluessel, der einen
LinkedIn-Kontakt eindeutig macht (Schema, Laendersubdomain, Query, Fragment,
Schraegstrich weg — `services/lead_dedup.py::norm_linkedin`, gespiegelt als SQL im
Modell). Doppelter Import ist damit auf **Datenbankebene** unmoeglich, nicht nur
im Client — das ist der Kern von „zuverlaessig".

### B1 — Feldabbildung

| Extension (`lcLog`-Datensatz) | ops `RainmakerLead` | Anmerkung |
|---|---|---|
| `profileUrl` | `linkedin_url` | **Dedup-Schluessel.** ⚠️ Fallback-URLs `linkedin.com/in/<profileId>` (wenn die Karte keinen Vanity-Link hatte, `buildRecord`) sind stabil, aber keine „echten" Profil-URLs — funktionieren als Schluessel, nicht als Link. |
| `name` | `contact_name` | |
| `company` | `company` | ⚠️ **In ops Pflichtfeld** (`nullable=False`), in der Extension best-effort und oft leer. Rueckfall wie `discover/import` es haelt: `"Unbenannt"` (`rainmaker.py:1111`). |
| `headline` | `role` | Positionszeile → Rolle. |
| `location` | `address` | Ort, kein voller Anschrift-Datensatz — akzeptabel, `address` ist `Text`. |
| `degree`, `method`, `pageUrl`, `profileId` | `notes` (als Klartext-Zeile) | Kein eigenes Feld; verlorengehen sollen sie nicht. |
| — | `source` | Konstante `"linkedin-spider"` — macht importierte Leads filterbar und spaeter reversibel. |
| — | `status` | `contacted` beim Anlegen. **Beim Treffer auf einen bestehenden Lead nur von `new` auf `contacted` heben** — ein Lead in `in_conversation` oder `won` darf durch einen Import nie zurueckfallen. |
| `ts` | Aktivitaet / Notiz | s. B2. |

### B2 — Was die Extension zuverlaessig behaupten kann, und was nicht

- **Kann**: „Anfrage gesendet am `ts`" → `status: contacted`. Das ist bewiesen (API `resp.ok` oder Klick mit Dialog/Pending-Wechsel).
- **Kann nicht**: „angenommen" → `connected`. Die Extension beobachtet nur den Versand. Annahmen muessten aus LinkedIns Kontaktliste gelesen werden (eigener Voyager-Endpunkt, eigener Lauf) — **nicht Teil dieses Plans**, sondern bewusst als Grenze benannt. `connected` setzt weiterhin der Mensch in ops.

⚠️ **Falle: `POST /leads/{id}/log-contact` ist der falsche Weg fuer einen Import.**
Er laeuft durch `complete_activity` und **vergibt Punkte und Streak** und
**erzwingt eine geplante Folgeaktion** (`RainmakerActivityComplete`, „Enforces a
next action UNLESS the lead is being closed"). 164 Anfragen auf einmal dort
hineinzukippen wuerde die Aktivierungs-Engine mit 164 „Kontakten" fluten und
164 Folgeaktionen verlangen. Der direkte Weg `POST /leads/{id}/activities`
legt dagegen nur eine **geplante** Aktivitaet an (Default `planned`, keine
Punkte) — auch nicht richtig: es fand ja schon statt.

Konsequenz: **Der Versand gehoert als Fakt an den Lead** (`status`, `notes`,
`source`) — **nicht als Aktivitaet in die Engine.** Wenn eine „erledigte"
Aktivitaet ohne Punkte gewuenscht ist, braucht ops dafuer einen eigenen Weg (B4).

### B3 — Zugang und Transport

- **Auth**: ops kennt nur JWT ueber `POST /api/auth/login` (`JWT_EXPIRATION_HOURS`) — kein API-Key. Fuer ein Werkzeug, das unbeaufsichtigt schreibt, ist das ungeeignet (Token laeuft ab, Passwort in der Extension speichern ist keine Option). **Praezedenz in ops: `users.ical_token`** (64 Zeichen, unique, per User) fuer den iCal-Feed. Derselbe Bau als `users.api_token` + ein `get_current_user_or_api_token`-Dependency ist der saubere Weg.
- **CORS**: `CORS_ORIGINS` ist eine feste Liste. Ein Content-Script auf `linkedin.com` unterliegt dem CORS der *Seite* (seit Chrome 85) — der Push muss aus **Popup oder Service-Worker** kommen; mit `host_permissions: ["https://ops.celox.io/*"]` umgeht Extension-Origin CORS ganz. **Die Extension hat heute keinen Service-Worker** — fuer Warteschlange + Wiederholung braucht sie einen.
- **Idempotenz**: `POST /api/rainmaker/leads` → `409 {existing_id}` bei Treffer auf `linkedin_norm`. Ein Importer kann darauf reagieren (bestehenden Lead updaten). Das sind aber **zwei Requests** je Duplikat und der Status-Hebe-Schutz („nur von `new`") liegt dann im Client. Fuer „zuverlaessig" gehoert das in **eine** Transaktion auf dem Server — genau die Lehre, die ops in `routers/cli.py` schon selbst festhaelt („die Rueckmeldung FUEHRT DIE AKTION AUS … in EINER Transaktion").

### B4 — Drei Wege, aufsteigend nach Aufwand

**Weg 1 — CSV-Import in ops (kein Extension-Code)**
Die Extension exportiert bereits die Spalten aus B1. ops bekommt unter Rainmaker
einen Import „LinkedIn-Spider-CSV": Datei waehlen → Vorschau (neu / bereits
vorhanden / Statushebung) → Uebernehmen. Server-seitig ein Endpunkt, der je Zeile
`linkedin_norm` prueft, anlegt oder hebt, `source` setzt — in einer Transaktion,
mit Ergebnis je Zeile. ✅ Zuverlaessig (DB-Index), ✅ reversibel (`source`-Filter),
✅ kein Token, kein CORS, kein Service-Worker. ❌ Manuell, kein Live-Stand.
**Groesse: M (ops).** Das ist der Weg, der am schnellsten Nutzen bringt.

**Weg 2 — Push aus der Extension**
Service-Worker + `host_permissions` + `api_token` in ops + Outbox in `storage`
(`lcOutbox`: Datensaetze mit `synced: false`), Sync-Knopf im Popup, optional
automatisch nach jedem Versand. Serverseitig **derselbe** Endpunkt wie Weg 1 —
Weg 2 baut auf Weg 1 auf, nicht daneben. Popup zeigt je Kontakt „in ops ✓".
**Groesse: M (ops: Token + Dependency) + M (Extension: Worker, Outbox, UI, Tests).**

**Weg 3 — Rueckkanal ops → Extension (Idee, kein Auftrag)**
ops weiss, wen man *nicht* anschreiben soll: `lost` mit `lost_reason`, bestehende
Kunden (`link-customer`), `contact_stale`. Ein `GET /api/rainmaker/leads/linkedin-blocklist`
(nur `linkedin_norm`-Werte) in die Extension-Merkliste (A1.4) gespeist — und die
Extension fragt niemanden an, den ops schon abgehakt hat. Das waere der Punkt, an
dem die Integration in beide Richtungen traegt. **Groesse: S (ops) + S (Extension), setzt Weg 2 voraus.**

### B5 — Antwort auf die Frage

**Ja, zuverlaessig geht — mit `RainmakerLead`, ueber `linkedin_norm`, und nur fuer
den Status `contacted`.** Die drei Dinge, die es dafuer braucht, sind alle klein
und klar: (1) ein Import-Endpunkt in ops, der je Zeile in *einer* Transaktion
anlegt-oder-hebt und **nicht** durch die Punkte-Engine laeuft; (2) `"Unbenannt"`
als Firmen-Rueckfall; (3) die Grenze akzeptieren, dass „angenommen" von Hand
bleibt. Was *nicht* zuverlaessig waere: ueber `log-contact` importieren (Punkte,
Streak, Folgeaktionszwang), ueber `Lead`/`leads` importieren (keine Dedup), oder
den Client die Status-Hebe-Regel entscheiden lassen.

### Stand 2026-09-03: Weg 1 + Weg 2 UMGESETZT

- ops `v1.1.0` (`4bda31d`…`bc83834`, live auf ops.celox.io): `routers/spider_import.py`
  (`/api/rainmaker/leads/import/linkedin-spider` + `/parse`), Rainmaker-Knopf „Spider-CSV",
  API-Token unter Einstellungen, Migration `backend/scripts/add_user_api_token.sql`
  (in Prod eingespielt, Backup `/root/celox-ops-pre-spider-20260903-042332.sql.gz`).
- Extension `v2.10.0`: Service-Worker `background.js`, Optionsseite, Popup-Zeile,
  Sync-Kern `lib.js::opsSyncRun`.
- Entscheidungen aus „Offene Entscheidungen" 3–5: Weg 1 UND 2 (Auftrag); Firmen-Rückfall
  `"Unbenannt"` — die Extension liefert die Headline-Firma ohnehin schon als `company`,
  der Rückfall greift nur, wenn auch die leer ist; **keine** Aktivität in der Engine
  (Status + `source` + Notiz-Zeile). Weg 3 (Rückkanal) bleibt offen.

### Empfohlene Reihenfolge fuer Teil B

1. **Weg 1** — CSV-Import in ops mit Vorschau. Ergebnis sofort nutzbar mit dem
   Export, den es schon gibt.
2. **`users.api_token`** in ops (nach `ical_token`-Muster) + Extension-Service-Worker
   + Outbox → **Weg 2**, derselbe Server-Endpunkt.
3. **Weg 3** nach Freigabe.

---

## Offene Entscheidungen (vom Nutzer)

1. A2 (Tempo-Deckel/Jitter/Stopp bei X %) — einbauen, und wenn ja, mit welchen Defaults?
2. A4.2 Chrome Web Store — anstreben oder bewusst Sideload bleiben?
3. B: mit Weg 1 (CSV) anfangen, oder direkt Weg 2 (Push)?
4. B: Firmen-Rueckfall `"Unbenannt"` oder lieber die Headline als Firmenname, wenn sie ein `bei/at` traegt (die Extension extrahiert das bereits in `company`)?
5. B: Soll ein importierter Lead eine sichtbare „erledigte" Aktivitaet bekommen (braucht in ops einen Weg ohne Punkte), oder reicht `status` + `notes`?

## Nicht in diesem Plan

- Annahme-Erkennung (`connected`) — eigener Voyager-Lauf, eigenes Risiko.
- Nachrichten nach der Annahme senden — andere Produktklasse, anderes ToS-Risiko.
- Migration von `Lead` nach `RainmakerLead` in ops — nicht noetig, die beiden Begriffe koexistieren bewusst.
