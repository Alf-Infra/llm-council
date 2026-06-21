# SPEC — LLM Council

**Slug:** llm-council
**Iteration:** v1
**Type:** new-app
**Port:** 3110
**Eingegangen:** 2026-06-21T18:48:11Z

## Beschreibung

Baue eine eigenständige lokale Web-App nach dem Prinzip von Andrej Karpathys
`llm-council`: Mehrere frei konfigurierbare LLMs beantworten dieselbe Anfrage
parallel, bewerten anschließend die anonymisierten Antworten gegenseitig und
ein Chairman-Modell synthetisiert daraus eine transparente finale Antwort.

Die App soll das Referenzprojekt nicht bloß kopieren, sondern die wesentlichen
Schwachstellen verbessern: strukturierte Reviews, persistierte Metadaten,
robuste Fehlerbehandlung sowie sichtbare Token- und Laufzeitdaten.

Referenz: https://github.com/karpathy/llm-council

## Acceptance Criteria

### Council-Konfiguration

- [ ] Die Oberfläche erlaubt vor jedem Lauf die Auswahl von mindestens zwei Council-Modellen und genau einem Chairman-Modell.
- [ ] Modelle werden als frei editierbare OpenAI-kompatible Modellkennungen verwaltet; sinnvolle Defaults sind `gpt-5.5`, `gpt-5.4`, `claude-sonnet-4-6` und `gemini-3-pro-preview`.
- [ ] Die Serverkonfiguration liest `LLM_API_BASE_URL` mit Default `http://localhost:4000/v1`, optional `LLM_API_KEY`, `LLM_REQUEST_TIMEOUT_MS` und `LLM_MAX_OUTPUT_TOKENS` aus Umgebungsvariablen.
- [ ] API-Zugangsdaten werden niemals an den Browser ausgeliefert, in SQLite gespeichert oder in Logs ausgegeben.
- [ ] Der Nutzer kann Bewertungskriterien auswählen beziehungsweise gewichten. V1 enthält mindestens Korrektheit, Tiefe und Praxisnutzen.

### Stage 1 — unabhängige Antworten

- [ ] Eine Frage wird serverseitig parallel an alle gewählten Council-Modelle gesendet.
- [ ] Die UI zeigt den Fortschritt jedes Modells und danach jede Einzelantwort in einer übersichtlichen Tab- oder Kartenansicht.
- [ ] Der Ausfall oder Timeout eines einzelnen Modells bricht den Lauf nicht ab, solange mindestens zwei Antworten vorliegen.
- [ ] Pro Modell werden Status, Laufzeit und – falls vom Provider geliefert – Prompt-, Completion- und Gesamt-Token gespeichert und angezeigt.

### Stage 2 — anonymisiertes Peer-Review

- [ ] Die erfolgreichen Stage-1-Antworten werden pro Lauf zufällig anonymisiert (`Response A`, `Response B`, ...); die Zuordnung bleibt serverseitig.
- [ ] Jedes verfügbare Council-Modell bewertet alle anonymisierten Antworten parallel, ohne Modellnamen oder Provider zu sehen.
- [ ] Reviews werden als strukturiertes JSON angefordert und serverseitig strikt validiert.
- [ ] Jedes Review enthält je Antwort Scores von 1–10 für die aktiven Kriterien, eine kurze Begründung, erkannte Stärken, erkannte Schwächen und eine finale Reihenfolge.
- [ ] Ungültiges JSON wird genau einmal mit einem JSON-Reparaturprompt beim selben Modell nachgefordert; danach wird das Review als fehlgeschlagen markiert.
- [ ] Die App berechnet aus den gültigen Reviews eine transparente Gesamtwertung. Angezeigt werden Durchschnitt pro Kriterium, gewichteter Gesamtscore, Anzahl gültiger Stimmen und Rang.
- [ ] Die UI kann sowohl die anonymisierte Originalbewertung als auch die nach Abschluss aufgelöste Modellzuordnung anzeigen.

### Stage 3 — Chairman-Synthese

- [ ] Der Chairman erhält die Originalfrage, alle erfolgreichen Antworten, die validierten Peer-Reviews und die aggregierte Rangliste.
- [ ] Der Chairman soll eine eigenständige, konsistente Endantwort schreiben und relevante Übereinstimmungen, Konflikte und Unsicherheiten berücksichtigen.
- [ ] Die finale Antwort wird klar von Einzelantworten und Reviews getrennt dargestellt.
- [ ] Fällt der Chairman aus, bleiben Stage 1, Stage 2 und Rangliste vollständig sichtbar und der Lauf erhält einen verständlichen Fehlerstatus.

### Streaming, Persistenz und Historie

- [ ] Der komplette Fortschritt wird per Server-Sent Events oder vergleichbarem HTTP-Streaming an die UI übertragen; die Nutzer sehen Stage- und Modellstatus ohne Seitenreload.
- [ ] Conversations, User-Nachrichten, Runs, Modellantworten, Reviews, Rankings, Fehler und Nutzungsmetadaten werden mit `node:sqlite` persistent gespeichert.
- [ ] Eine Sidebar listet frühere Conversations; gespeicherte Läufe lassen sich nach einem Neustart vollständig wieder öffnen.
- [ ] Folgefragen innerhalb einer Conversation verwenden den bisherigen Dialogkontext in begrenzter, nachvollziehbarer Form.
- [ ] Ein laufender Council-Aufruf kann in der UI abgebrochen werden; sein Status wird als abgebrochen gespeichert.
- [ ] Beim erneuten Laden während oder nach einem Lauf bleibt die gespeicherte Historie konsistent.

### UI und Bedienung

- [ ] React/Vite-UI mit responsivem Desktop- und Mobile-Layout.
- [ ] Die Gestaltung wirkt wie ein fokussierter Analyse-Arbeitsplatz, nicht wie eine generische ChatGPT-Kopie.
- [ ] Ein neuer Lauf zeigt klar die drei Phasen: Antworten, Peer-Review, Synthese.
- [ ] Markdown-Ausgaben werden sicher gerendert; vom Modell geliefertes HTML wird nicht ungefiltert ausgeführt.
- [ ] Leere Eingaben, weniger als zwei Modelle und doppelte Modellkennungen werden verständlich validiert.
- [ ] Fehler werden nutzerverständlich in der Oberfläche gezeigt, ohne interne Stacktraces oder Secrets.

### Export und Betriebsdaten

- [ ] Ein abgeschlossener Lauf kann als Markdown-Datei exportiert werden, inklusive Frage, Modellantworten, Reviews, Rangliste, Endantwort und Metadaten.
- [ ] Die UI zeigt eine Laufzusammenfassung mit Gesamtdauer, Modellaufrufen, erfolgreichen/fehlgeschlagenen Aufrufen und Tokenzahlen, soweit verfügbar.
- [ ] `GET /health` antwortet ohne externen Modellaufruf mit HTTP 200 und `{"ok":true}`.
- [ ] `GET /api/config` liefert nur sichere UI-Konfiguration und niemals den API-Key.

### Qualität

- [ ] Die Council-Orchestrierung ist in testbare Module getrennt; Provider-Calls können in Tests vollständig gemockt werden.
- [ ] Tests decken mindestens Validierung, Anonymisierung, Review-JSON-Parsing/Reparaturpfad, Aggregation, Teilfehler und Persistenz ab.
- [ ] `npm test` ist grün.
- [ ] `npm run build` ist grün.
- [ ] Die App startet mit `npm start` und verwendet `process.env.PORT`; nur wenn es fehlt, wird `PORT.txt` verwendet.
- [ ] Die Root-Route liefert die gebaute React-App aus.

## Stack-Pflicht

- Node.js 22 LTS
- Express-Backend
- React + Vite
- SQLite über `node:sqlite` – nicht `better-sqlite3`
- Tests über `node --test` oder Vitest
- Native `fetch` für OpenAI-kompatible Chat-Completions
- `process.env.PORT` als primäre Portquelle, Fallback auf `PORT.txt`

## Architekturleitplanken

- Frontend und API laufen im Produktionsmodus über denselben Express-Port.
- Keine Provider-SDK-Abhängigkeiten; die Integration bleibt OpenAI-kompatibel.
- Kein Secret im Frontend-Bundle oder in persistierten Run-Daten.
- Modellfehler werden pro Call erfasst und führen zu kontrollierter Degradation.
- Randomisierte Anonymisierung und Aggregationsformel müssen deterministisch testbar sein, indem Tests einen Seed beziehungsweise eine feste Zuordnung injizieren können.
- Strukturierte Reviews verwenden ein klar dokumentiertes internes Schema.
- Datenbank und Runtime-Daten liegen in einem ignorierten `data/`-Verzeichnis.

## Nicht-Ziele für v1

- Keine Benutzerkonten, Mehrmandantenfähigkeit oder öffentliche Internetfreigabe.
- Keine Datei-Uploads, Websuche oder Retrieval-Augmented Generation.
- Keine exakte Euro-/Dollar-Kostenberechnung ohne verlässliche Provider-Preisdaten.
- Keine automatische Auswahl des „besten“ Modells anhand historischer Ergebnisse.
- Kein Tool Calling durch die Council-Modelle.
- Kein Kopieren des Quellcodes oder Designs des Karpathy-Repositories.

## Definition of Done

- Tests grün.
- Produktions-Build erfolgreich.
- App startet auf dem Test-Port aus `process.env.PORT`.
- `/health` ist grün.
- Root-Route liefert HTML.
- Tester-Gate bestanden.
- Reviewer-Gate grün.
- GitHub-Push, PM2-Deploy und abschließender Healthcheck erfolgreich.
