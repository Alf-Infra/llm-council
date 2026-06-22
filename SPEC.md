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

## Iteration v1 Retry-Kontext — Reviewer Blocker

Der erste Build-/Testlauf war technisch grün, aber das Reviewer-Gate blieb rot.
Bitte die folgenden Punkte gezielt beheben:

- Streaming-Fortschritt muss wirklich live in der UI ankommen. Der Reviewer meldet, dass `collectAnswers`/`collectReviews` Events aktuell bis nach `Promise.all` puffern und erst dann ausliefern. Stage- und Modellstatus müssen während der laufenden Calls sichtbar werden.
- Die Anonymisierung darf vor Abschluss von Stage 2 nicht an den Browser geleakt werden. `answers_complete` darf nicht gleichzeitig `model` und `anonymousId` preisgeben, und die UI darf Modellnamen nicht schon neben `Response A/B` anzeigen.
- Fehlgeschlagene oder getimte Stage-1-Modelle müssen in der laufenden UI sichtbar sein. Der Reviewer meldet, dass `deriveRunState` `answer-model_status` ohne `response` nicht korrekt verarbeitet und `answers_complete` nur erfolgreiche Antworten enthält.
- Review-Validierung strikter machen: keine doppelten `responseId`-Einträge, keine zusätzlichen Bewertungen, keine stillschweigend akzeptierten fehlerhaften Reviews.
- Tests erweitern: besonders SSE-Fortschrittsverhalten, Abbruch/Persistenz eines laufenden Runs, Chairman-Ausfall und Wiederöffnung nach Neustart.

## Iteration v1 Reparaturlauf 3 — von Kevin ausdrücklich freigegeben

Der zweite Tester-Lauf hat einen einzelnen reproduzierbaren Laufzeitblocker
gefunden. Behebe diesen gezielt und vermeide darüber hinaus unnötige Umbauten:

- `POST /api/runs` startet korrekt als SSE-Stream und liefert zunächst
  `run_started`, `stage` und `model_status`, endet danach aber sofort mit
  `aborted`.
- Ursache laut Live-Smoke-Test: `server/app.js` verwendet `req.on('close')`
  als Signal für einen getrennten SSE-Client. Bei einem POST feuert dieses
  Event jedoch bereits beim normalen Abschluss des eingelesenen Request-Bodys,
  obwohl die Response-Verbindung weiterhin offen ist.
- Der Council-Run darf nur abgebrochen werden, wenn die ausgehende
  SSE-Verbindung tatsächlich geschlossen beziehungsweise der Client wirklich
  getrennt wurde. Verwende dafür ein semantisch korrektes Response-/Socket-
  Signal und unterscheide normales Request-Ende von echtem Disconnect.
- Ein regulär verbundener Client muss den Council-Run bis zu einem fachlichen
  Terminalevent (`run_complete` oder bei Providerfehlern `run_failed`)
  verfolgen können.
- Ein tatsächlich getrennter Client muss weiterhin den AbortController
  auslösen und den Run persistent als `aborted` markieren.
- Ergänze Regressionstests für beide Fälle:
  1. normal beendeter POST-Requestbody bei weiterhin offenem SSE-Response
     bricht den Run nicht ab;
  2. echter Client-Disconnect bricht den Run kontrolliert ab.
- Bestehende 13 Tests, Produktions-Build, `/health`, `/`, `/api/config`,
  Eingabevalidierung und die Reviewer-Fixes dürfen nicht regressieren.

Tester-Artefakt: `.test-result.json` vom 2026-06-21T19:13:20Z.

## Iteration v1 Reparaturlauf 4 — Anonymisierung vor Stage 2

Kevin hat eine vierte, gezielte Nachbesserung ausdrücklich freigegeben. Das
Reviewer-Gate vom 2026-06-21T20:35:00Z enthält noch genau einen Blocker:

- Der Browser kann aktuell erfolgreiche `answer-model_status`-Events, die
  Modellname und vollständigen Antwortinhalt enthalten, mit dem späteren
  `answers_complete`-Payload korrelieren. Dadurch lässt sich `Response A/B`
  bereits vor Abschluss des anonymisierten Peer-Reviews dem Ursprungsmodell
  zuordnen.

Behebe ausschließlich dieses Informationsleck und erhalte alle bisherigen
Fixes:

- Vor Abschluss von Stage 2 darf kein an den Browser gesendetes Event und kein
  während des aktiven Runs abrufbares API-Payload gleichzeitig oder durch
  triviale Korrelation Ursprungsmodell, Antwortinhalt und `anonymousId`
  offenlegen.
- Laufende Modellstatus dürfen Modellname, Status, Laufzeit und Fehlerstatus
  anzeigen, aber bei erfolgreichen Stage-1-Calls vor Stage-2-Abschluss nicht
  den vollständigen Antworttext enthalten.
- Das Pre-Review-Payload mit den zu bewertenden Antworten darf nur zufällig
  angeordnete anonyme IDs und Inhalte enthalten. Es darf weder Modellnamen noch
  ursprüngliche Array-Indizes oder andere stabile Korrelationsschlüssel
  enthalten.
- Die Zuordnung `anonymousId -> model` bleibt bis zum Abschluss von Stage 2
  ausschließlich serverseitig.
- Nach abgeschlossenem Peer-Review darf ein explizites Reveal-Event die
  Zuordnung und die Stage-1-Modellantworten für die transparente UI freigeben.
- Fehlgeschlagene und getimte Stage-1-Modelle bleiben als Modellstatus sichtbar,
  da sie keinen erfolgreichen Antwortinhalt zuordnen.
- Prüfe auch Projektionen bereits persistierter aktiver Runs: Ein Browser darf
  die Zuordnung nicht durch sofortiges erneutes Laden oder einen parallelen
  Detail-GET vorzeitig erhalten.
- Ergänze einen Regressionstest, der alle vor dem Stage-2-Abschluss sichtbaren
  SSE-Events und aktiven API-Responses betrachtet und nachweist, dass sich
  keine anonyme Antwort einem Ursprungsmodell zuordnen lässt.
- Ergänze einen zweiten Test, der sicherstellt, dass die Zuordnung nach Stage 2
  vollständig und korrekt für die UI aufgelöst wird.
- Die 15 bestehenden Tests, der SSE-Disconnect-Fix, Live-Fortschritt,
  Review-Validierung, Persistenz, Build und Healthchecks dürfen nicht
  regressieren.

Reviewer-Artefakt: `.review-result.json` vom 2026-06-21T20:35:00Z.

## Iteration v1 Reparaturlauf 5 — Export-Sperre und atomisches Reveal

Kevin hat am 2026-06-22 eine fünfte, eng begrenzte Nachbesserung ausdrücklich
freigegeben. Behebe ausschließlich die zwei Blocker aus dem Reviewer-Artefakt
vom 2026-06-21T20:42:38Z und erhalte alle bisherigen Fixes:

1. Der Markdown-Export darf die Stage-2-Anonymisierung nicht umgehen.
   `GET /api/runs/:id/export.md` muss während eines aktiven oder noch nicht
   vollständig enthüllten Runs dieselbe Geheimhaltungsgrenze wie die
   Browser-Projektion respektieren. Vor dem explizit abgeschlossenen Reveal
   dürfen Modellname, `anonymousId` und Antwortinhalt weder gemeinsam noch
   durch triviale Korrelation exportiert werden. Ein vollständiger Export mit
   Modellzuordnung ist erst nach abgeschlossenem Peer-Review und atomarem
   Reveal zulässig. Wähle für frühere Aufrufe eine klare, getestete Semantik
   (zum Beispiel HTTP 409/423 oder einen sicher redigierten Export).

2. Ranking-Persistenz, Reveal-Freigabe, Stage-Wechsel und Browser-Projektion
   müssen atomar beziehungsweise durch einen einzigen persistierten
   Reveal-Zustand konsistent werden. Das bloße Vorhandensein einer Rangliste
   darf nicht als Reveal-Signal gelten. Zwischen `saveRanking`, Ranking-SSE,
   `answers_revealed` und dem Wechsel zu `synthesis` darf ein paralleler
   Detail-GET niemals die Zuordnung `responseId`/`anonymousId -> model`
   erhalten. Erst nachdem der serverseitige Reveal-Zustand vollständig und
   dauerhaft committed ist, darf die Zuordnung über SSE, Detail-API und Export
   sichtbar werden.

Ergänze gezielte Regressionstests:

- Ein Export-Aufruf während `stage=reviews` leakt keine Zuordnung, Modellnamen
  oder gemeinsam korrelierbaren Antwortdaten.
- Ein kontrolliert pausierter Ablauf zwischen Ranking-Berechnung/-Persistenz
  und Reveal prüft per parallelem Detail-GET und Export, dass die Zuordnung
  weiterhin verborgen bleibt.
- Nach atomarem Reveal liefern SSE, Detail-GET und Markdown-Export dieselbe
  vollständige und korrekte Zuordnung.
- Die bestehenden 17 Tests, der SSE-Disconnect-Fix, Live-Fortschritt,
  Review-Validierung, Persistenz, Build und Healthchecks dürfen nicht
  regressieren.

Reviewer-Artefakt: `.review-result.json` vom 2026-06-21T20:42:38Z.

## Iteration v1 Reparaturlauf 6 — Reveal-Timing

Kevin hat am 2026-06-22 Option a und damit einen sechsten, ausschließlich auf
den letzten Reviewer-Blocker begrenzten Reparaturlauf freigegeben.

Der Export ist vor dem Reveal inzwischen korrekt gesperrt. Offen ist nur noch
die zeitliche Konsistenz des Reveals:

- `server/orchestrator.js` setzt `revealed_at` derzeit vor dem `ranking`-Yield.
  Das Ranking enthält bereits die Zuordnung `responseId`/`anonymousId -> model`.
- Nach diesem Yield kann der Async-Generator beliebig lange pausieren, bevor
  `answers_revealed` gesendet wird. In diesem Zwischenzustand geben Ranking-SSE,
  Detail-GET und Export die Modellzuordnung bereits frei, obwohl der
  persistierte Run weiterhin `stage=reviews` ist.
- Das explizite Reveal muss aus Browser-Sicht konsistent sein. Vor dem
  `answers_revealed`-Übergang dürfen weder Ranking-SSE noch Detail-GET noch
  Export eine Modellzuordnung enthalten. Das Ranking darf vor dem Reveal
  weiterhin anonymisierte Scores/Ränge zeigen, muss Modellfelder aber
  redigieren.
- `revealed_at`, die freigegebene Ranking-Projektion, `answers_revealed` und der
  anschließende Stage-Wechsel müssen so geordnet beziehungsweise persistiert
  werden, dass kein von API/SSE beobachtbarer Zwischenzustand die Zuordnung
  vorzeitig offenlegt.
- Ergänze einen Regressionstest, der den Async-Generator gezielt direkt nach
  dem Ranking-Yield und vor `answers_revealed` pausiert. In genau diesem Zustand
  müssen Ranking-Event, paralleler Detail-GET und Export anonymisiert bzw.
  gesperrt bleiben.
- Nach dem tatsächlichen Reveal müssen SSE, Detail-GET und Export weiterhin
  dieselbe vollständige Modellzuordnung liefern.
- Die bestehenden 20 Tests und alle bisherigen Fixes dürfen nicht regressieren.

Reviewer-Artefakt: `.review-result.json` vom 2026-06-22T08:00:06+02:00`.
