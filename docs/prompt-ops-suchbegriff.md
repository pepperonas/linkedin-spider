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
  "ts": "2026-09-06T00:39:38.873Z"
}
```

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
