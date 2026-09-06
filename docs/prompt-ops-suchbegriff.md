# Prompt für die celox-ops-Session — Suchbegriff verwerten

> Diesen Text in der ops-Session ausführen. Die Extension-Seite ist mit
> **linkedin-spider 2.13.0** fertig und ausgeliefert; ops kann unabhängig
> nachziehen (siehe „Kompatibilität").

---

Der LinkedIn Spider schreibt ab 2.13.0 mit, **wonach gesucht wurde**, und
liefert es beim Import mit. Bitte in ops verwerten.

## Vertrag (steht fest, Extension-Seite ist live)

**API-Push** `POST /api/rainmaker/leads/import/linkedin-spider` — jede Zeile hat
ein zusätzliches Feld `search_query` (`str | None`, Whitespace normalisiert):

```json
{
  "profile_url": "https://www.linkedin.com/in/anna-beispiel",
  "name": "Anna Beispiel",
  "company": "Muster Hausverwaltung GmbH",
  "headline": "Geschäftsführerin",
  "location": "Berlin, Deutschland",
  "degree": "2.",
  "profile_id": "ACoAAB1",
  "method": "api",
  "page_url": "https://www.linkedin.com/search/results/people/?keywords=hausverwaltung%20Berlin&origin=SWITCH_SEARCH_VERTICAL",
  "search_query": "hausverwaltung Berlin",
  "search_term": "hausverwaltung",
  "search_city": "Berlin",
  "ts": "2026-09-06T00:39:38.873Z"
}
```

**Seit 2.15.0 zerlegt die Extension selbst** (`search_term` / `search_city`) — beides
ist additiv, `search_query` bleibt die Rohform. Der Grund für den Sinneswandel: Die
Extension **rät nicht**, sie weiß es. Der Picker hat die Suche aus einem Begriff und
einer Stadt gebaut, und die Städteliste pflegt der Nutzer selbst; die Zerlegung ist
damit eine Meldung, keine Interpretation. Die Stadt kommt in der Schreibweise der
Liste (Anfrage „berlin" ⇒ `"Berlin"`), fehlt sie, ist das Feld `null` — nie geraten.

⇒ **Ihr braucht keine Städteliste mehr.** Punkt 3 unten (Stadt aus dem Begriff
ableiten) ist damit optional und nur noch als Rückfall für Altzeilen interessant,
die bloß `search_query` tragen.

**CSV-Import** — neue Spalte **`Suchbegriff`**, sie steht zwischen `Methode`
und `Suchseite`:

```
"Datum";"Name";"Profil-URL";"Headline";"Firma";"Ort";"Grad";"Profil-ID";"Methode";"Suchbegriff";"Suchseite"
"06.09.2026 02:39";"Anna Beispiel";"https://…/in/anna-beispiel";"Geschäftsführerin";"Muster Hausverwaltung GmbH";"Berlin, Deutschland";"2.";"ACoAAB1";"api";"hausverwaltung Berlin";"https://…?keywords=hausverwaltung%20Berlin&origin=SWITCH_SEARCH_VERTICAL"
```

Der Parser bildet über Spaltennamen ab, die Position ist also egal — und ein
**älteres CSV ohne die Spalte muss weiter laufen** (Regressionstest).

Die Extension speichert den Begriff **unverändert** und deutet ihn bewusst
nicht: kein Städtenamen-Abgleich, keine Segment-Erkennung. Die Abbildung gehört
ops (dieselbe Regel wie beim CSV-Import), und ein zweiter Parser wäre ein
zweites Ding, das auseinanderläuft — die `norm_linkedin`-Parität ist die
Mahnung dazu.

## Warum das Feld gebraucht wird

Die Trefferkarte nennt den Ort oft nicht, und wo LinkedIn keinen hat, rutscht
die **Headline in die Ort-Zeile** — in ops gemessen: **39 Leads** trugen eine
Berufsbezeichnung als Adresse, deshalb gibt es `ist_ortsangabe`. Der Suchbegriff
ist die ehrliche Quelle für die Stadt: Wer „hausverwaltung Berlin" oder „CTO
Frankfurt" sucht, hat **Segment und Stadt** in einer Zeichenkette.

## Was ops daraus machen sollte

1. **Schema:** `SpiderRow.search_query: str | None = Field(default=None, max_length=300)`.
2. **CSV:** `CSV_TO_FIELD["Suchbegriff"] = "search_query"`.
3. **Stadt ableiten** (`services/linkedin_spider_import.py`): Abgleich der
   Wort-Token gegen eine kuratierte DACH-Städteliste, längster Treffer gewinnt,
   Groß-/Kleinschreibung egal, Position im Begriff egal („hausverwaltung Berlin"
   wie „Berlin Hausverwaltung").
   - ⚠️ Es gibt Städtenamen, die zugleich Alltagswörter sind (**Essen**, Hof,
     Bergen, Zell). In einem Lead-Suchbegriff ist „Essen" praktisch immer die
     Stadt — trotzdem nur **ganze Token** matchen, nie Teilstrings („Essenz",
     „Hofmann").
   - Kein Treffer ⇒ `None`. Nicht raten.
4. **Verwendung als Adresse:** `_ort(row)` zuerst (Kartenwert, durch
   `ist_ortsangabe` geschützt), **danach** die Stadt aus dem Suchbegriff als
   Rückfall. `merge_into_existing` füllt weiterhin nur Leeres — Semantik
   unverändert.
   - **Eigene Entscheidung:** Sollen die 39 Bestands-Leads, deren `address` in
     Wahrheit eine Berufsbezeichnung ist, repariert werden? `fill` fasst sie
     nicht an. Denkbar wäre „ersetze eine Adresse, die `ist_ortsangabe` nicht
     besteht" — das ist ein Überschreiben und gehört bewusst entschieden, ggf.
     als einmaliges Skript statt als Import-Regel.
5. **Segment:** Der Rest des Begriffs („hausverwaltung", „CTO") ist genau das
   Vokabular, das `services/icp_klassifizierung.py` schon kennt — `finde()`
   gegen `ROLLEN`/`BRANCHEN` inkl. Synonyme. Naheliegend: den Suchbegriff in
   die Textbasis der Klassifizierung aufnehmen (heute `branchen_text(company,
   tags)`), damit `industry` / `role_group` belegt werden statt zu raten.
   Alternativ/zusätzlich `target`. **Eure Entscheidung** — der Import muss den
   Begriff nur bereitstellen.
6. **Notiz-Zeile:** `notes_line()` hängt heute `· Suche: <page_url>` an. Der
   Begriff liest sich besser als die URL (`· Suche: „hausverwaltung Berlin"`).
   - ⚠️ **Idempotenz-Falle:** `merge_into_existing` erkennt eine schon
     vorhandene Zeile per exaktem Stringvergleich. Ändert sich das Format,
     erzeugt derselbe Versand eine **zweite** Notiz-Zeile. Praktisch tritt das
     nur bei einem CSV-Reimport oder nach „Forget sync state" auf (die
     Extension schickt bereits quittierte Zeilen nicht erneut), aber der
     Vergleich sollte trotzdem auf einen **stabilen Präfix** (Zeitstempel)
     umgestellt werden, bevor das Format wandert.

## Kompatibilität

- **ops muss nicht zuerst deployen.** `SpiderRow` setzt kein `extra="forbid"`
  (im Schema geprüft), Pydantic ignoriert das unbekannte Feld also — die
  Extension darf vorlaufen.
- **Rückwirkend:** Die Extension leitet den Begriff für Alt-Einträge aus der
  gespeicherten Such-URL ab, das ganze bestehende Protokoll trägt ihn also. Um
  **bereits übertragene** Leads nachträglich mit Stadt zu versorgen: in der
  Extension Optionsseite → **Forget sync state**, dann Sync. Der Import ist
  idempotent (`decision: unchanged`, wenn nichts fehlt).

## Nicht vergessen

- Tests in `backend/tests/test_linkedin_spider_import.py` +
  `.../integration/test_linkedin_spider_import_http.py`: Stadt aus dem Begriff
  (beide Wortstellungen, kein Treffer, Alltagswort-Falle), Adress-Rückfall nur
  wenn der Kartenwert fehlt, CSV mit **und ohne** die neue Spalte.
- Version + `CHANGELOG.md` nach eurer Regel (`backend/tests/test_versionierung.py`).
- Kein Schema-Migrationsbedarf, solange der Begriff in `address` / `notes` /
  ICP-Felder läuft. Eine eigene Spalte für den Rohbegriff wäre eine Migration —
  nur wenn ihr sie wirklich wollt.

---

## Nachtrag 2026-09-06 (linkedin-spider 2.15.0): zwei weitere Kontrakte

### A) Sagt uns, welche Felder ihr gelesen habt

Antwortet der Import zusätzlich mit `accepted_fields` — der Liste der Feldnamen, die
euer `SpiderRow` wirklich kennt:

```json
{ "created": 3, "updated": 1, "unchanged": 0, "invalid": 0, "errors": 0,
  "accepted_fields": ["profile_url", "name", "company", "headline", "location",
                      "degree", "profile_id", "method", "page_url",
                      "search_query", "search_term", "search_city", "ts"],
  "results": [ … ] }
```

**Wozu:** Die Extension merkt sich je Kontakt, in welcher Zeilen-Form er quittiert
wurde. Wächst die Form (heute: Position + Stadt), schiebt sie die bereits
quittierten Kontakte **einmal** nach. Sagt ops „ich lese die Felder noch nicht",
wartet sie damit, bis ops es kann — und schiebt genau dann nach, ohne dass jemand
„Forget sync state" drücken muss. Ohne `accepted_fields` funktioniert alles weiter,
nur eben von Hand.

⚠️ Bitte die **tatsächlich gelesenen** Felder melden, nicht eine fest getippte Liste
— sonst behauptet die Antwort etwas, das im nächsten Refactoring nicht mehr stimmt.
Ein Ausdruck über die Modellfelder (`list(SpiderRow.model_fields)`) hält sich selbst
aktuell.

### B) Nehmt die Stände entgegen (neue Route)

`POST /api/rainmaker/leads/import/linkedin-spider/tally`, gleicher Bearer-Token:

```json
{ "rows": [
  { "term": "Kaufmännischer Leiter", "city": "Berlin", "sent": 100,
    "first_at": "2026-08-20T09:12:00.000Z", "last_at": "2026-09-05T18:40:00.000Z" },
  { "term": "Leiter Digitalisierung", "city": null, "sent": 64,
    "first_at": "2026-08-22T10:00:00.000Z", "last_at": "2026-09-01T12:00:00.000Z" }
] }
```

Das ist der Zählstand je Kombination — **die Strichliste**, die der Nutzer bisher von
Hand geführt hat („Leiter Digitalisierung (64x)"). Er ist **aggregiert, nicht je
Lead**: `sent` zählt gesendete Anfragen, auch solche, deren Lead längst in einem
anderen Status steht oder gar nicht mehr existiert.

- **Vollständiger Stand, kein Delta.** Jede Übertragung enthält alle Kombinationen;
  ein Upsert auf `(owner, term, city)` ist die richtige Semantik, kein Addieren.
- `city` ist `null`, wenn die Suche keine Stadt trug. `null` ist eine Aussage.
- Antwort ist egal, solange sie 2xx ist. **404/405/501 liest die Extension als
  „diese ops kann das noch nicht"** und lässt den Sync trotzdem als erfolgreich
  gelten — die Leads sind die Arbeit, die Stände sind der Bericht.
- Fachlich: eine kleine eigene Tabelle (`linkedin_spider_tally`) mit Mandanten-Bezug
  reicht. Wo es in der Oberfläche auftaucht — Rainmaker-Auswertung, Kampagnen-Sicht —
  ist eure Entscheidung; naheliegend ist „welche Position in welcher Stadt bringt
  Antworten", zusammen mit den Leads, die aus derselben Kombination stammen.
- ⚠️ Der Zählstand kommt **aus dem Browser** und ist damit Nutzer-Eingabe wie jede
  andere: `sent` klemmen, `term`/`city` in der Länge begrenzen, Zeilenzahl deckeln.

### Reihenfolge im Sync (zur Einordnung)

1. Leads pushen (Batches à 200, `commit: true`)
2. **falls nichts offen war und ops zuletzt „kann ich nicht" sagte:** eine leere
   Vorschau (`{"rows": [], "commit": false}`) nur, um `accepted_fields` zu lesen —
   sie schreibt nichts
3. Stände melden (nur wenn Schritt 1 durchlief)
4. Sperrliste holen (GET, wie bisher)
