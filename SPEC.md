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

## Iteration v1.2 — OpenRouter Provider-Konfiguration

Kevin hat am 2026-06-26 entschieden, die LLM-Council-App zunächst ohne
LiteLLM-Schicht weiterzuentwickeln. Ziel ist eine direkte OpenRouter-
Integration über die vorhandene OpenAI-kompatible Chat-Completions-
Architektur.

Baue die App so um, dass Nutzer OpenRouter direkt in der Eingabemaske
konfigurieren können:

- Die UI enthält einen klaren OpenRouter-Providerbereich mit:
  - Base URL, Default `https://openrouter.ai/api/v1`.
  - API-Key-Eingabe als Passwortfeld.
  - Frei editierbarer Modellliste.
  - Button zum Hinzufügen und Entfernen von Modellen.
  - Verständlicher Status-/Validierungsanzeige.
- LiteLLM darf in dieser Iteration nicht als eigener Provider-Typ,
  Proxy-Preset oder empfohlener Pfad eingebaut werden.
- Die bisherige globale ENV-Konfiguration darf als Backend-Fallback für
  Entwicklung/Tests erhalten bleiben, die neue UI muss aber direkte
  OpenRouter-Runs ermöglichen.
- Der Nutzer kann aus den OpenRouter-Modellen mindestens zwei Council-Modelle
  und genau ein getrenntes Chairman-Modell auswählen.
- Council- und Chairman-Auswahl müssen Modellobjekte mit Provider-Kontext
  verwenden, nicht nur lose Strings. Die Backend-Orchestrierung muss daraus
  korrekt `providerId`, `baseUrl` und `model` ableiten.
- Der eingegebene API-Key darf nur für den aktuellen Run verwendet werden.
  Er darf nicht in SQLite, `config_json`, Conversation-Details, Exporten,
  `.codex-build.json`, `.test-result.json`, Logs oder Browser-Historien-
  Projektionen gespeichert oder angezeigt werden.
- Persistiert werden dürfen nur sichere Metadaten wie Provider-Typ,
  Provider-Label, Base URL, Modellkennung, Rollen, Laufzeit, Token und
  Fehlerstatus.
- Provider-Fehler müssen secretsicher redigiert werden. Antworten wie
  `401`, `403`, Provider-JSON oder Header dürfen keinen API-Key zurück in UI,
  SSE oder Persistenz bringen.
- Die vorhandene Stage-2-Anonymisierung und das Reveal-Timing bleiben
  unverändert strikt: Vor `answers_revealed` darf weiterhin keine Zuordnung
  von anonymisierter Antwort zu Ursprungsmodell/Provider durch SSE,
  Detail-GET oder Export entstehen.
- Der Markdown-Export nach Reveal soll Provider/Modell transparent anzeigen,
  aber niemals API-Keys oder andere Zugangsdaten.
- Ergänze einen sicheren Provider-Test-Endpunkt oder eine gleichwertige
  UI-Validierung, die OpenRouter-Konfiguration testet, ohne Secrets zu
  persistieren. Der Test muss in Tests mockbar sein und darf `/health` sowie
  `/api/config` nicht zu externen Modellaufrufen zwingen.
- Ergänze Regressionstests fuer:
  - Run-Request mit OpenRouter-Provider, mehreren Modellen und Chairman.
  - API-Key wird nicht in persistiertem Run-Config, Detail-API, Export oder
    sicheren Config-Payloads geleakt.
  - Provider-Fehler werden redigiert.
  - Bestehende Anonymisierungs-/Reveal-Tests bleiben gruen.
  - Bestehende `npm test`, `npm run build`, `/health`, Root-Route und
    `process.env.PORT`-Konvention bleiben gruen.

Nicht-Ziele fuer v1.2:

- Keine LiteLLM-/OpenClaw-Proxy-Integration.
- Keine native Anthropic-, Gemini- oder OpenAI-SDK-Integration.
- Keine Speicherung von API-Keys im Browser-LocalStorage oder Backend.
- Keine automatische Modellkatalog-Synchronisierung von OpenRouter; die
  Modellliste bleibt frei editierbar.

## Iteration v1.3 — Paket 1: Stabilität und Accessibility

Kevin hat am 2026-07-15 Paket 1 der geplanten Weiterentwicklung beauftragt.
Diese Iteration behebt ausschließlich die beim UI-Audit bestätigten
Funktions-, Responsive- und Accessibility-Fehler und führt verbindliche
Frontend-Regressionstests ein. Design-Neuordnung und inhaltliche
OpenRouter-Erweiterungen folgen in separaten Paketen.

### Funktionsfehler

- Modellzeilen benötigen dauerhaft stabile, vom editierbaren Modelltext
  unabhängige IDs/React-Keys. Beim Tippen mehrerer einzelner Zeichen muss der
  Fokus im selben Eingabefeld bleiben und der vollständige Text korrekt
  übernommen werden.
- Hinzufügen, Bearbeiten, Rollenwechsel und Entfernen von Modellen müssen auch
  bei ähnlichen oder vorübergehend doppelten Eingaben kontrolliert funktionieren.
- Beim Öffnen einer gespeicherten Conversation muss der neueste Lauf mitsamt
  korrekter `currentRunId` geladen werden. Ein vollständiger enthüllter Lauf
  zeigt den Export dieses Laufs; ein alter oder fremder Export-Link darf nicht
  stehen bleiben.
- Ein abgeschlossener Lauf zeigt die Synthese als abgeschlossene/aktuelle
  Endphase. Beim Rekonstruieren der History dürfen ältere Review-Events den
  persistierten Terminalzustand nicht überschreiben.
- „Neue Conversation“ setzt Conversation-, Run-, Export-, Fehler- und
  Ergebniszustand konsistent zurück.
- Fehler beim initialen Laden von Config oder History ergeben eine
  verständliche Fehleransicht mit Wiederholen-Möglichkeit statt eines
  permanenten Bootscreens.

### Accessibility

- Die Seite besitzt genau eine sinnvolle App-Hauptüberschrift und eine
  nachvollziehbare Überschriftenhierarchie. Markdown-Überschriften aus
  Modellantworten dürfen keine zusätzlichen Seiten-`h1` erzeugen.
- Frage, jede Modellkennung und jeder Gewichtungsregler erhalten eindeutige,
  programmgesteuert verknüpfte Labels. Council-/Chairman-Auswahl und Kriterien
  verwenden passende `fieldset`-/`legend`- oder gleichwertige Semantik.
- Conversation-Einträge sind vollständig per Tastatur aktivierbar. Der
  Löschen-Button hat einen eindeutigen zugänglichen Namen und ist bei
  Tastaturfokus sichtbar; keine verschachtelten interaktiven Elemente.
- Fehler nutzen `role="alert"`; Provider- und Laufstatus verwenden angemessen
  dosierte `role="status"`-/`aria-live`-Semantik. Laufende Fortschritte,
  Fehler und Abschluss sind nicht ausschließlich über Farbe erkennbar.
- Die Phasenanzeige ist semantisch als Fortschrittsfolge ausgezeichnet und
  kennzeichnet aktuelle sowie abgeschlossene Schritte verständlich.
- Ranglisten besitzen Caption, Spaltenüberschriften und korrekte
  Tabellenstruktur. Leere Ranglisten dürfen als verständlicher Empty State
  statt als semantisch leere Tabelle erscheinen.
- Es gibt gut sichtbare `:focus-visible`-Stile für alle interaktiven Elemente
  sowie eine Skip-Link-Möglichkeit zum Hauptinhalt. Icon-Buttons erreichen auf
  Touch-Layouts mindestens 44 × 44 CSS-Pixel.
- Bereits gute Sicherheitsgrenzen, Textkontraste und Secret-Redaction dürfen
  nicht regressieren.

### Responsive Stabilität

- Bei 320, 390 und 430 CSS-Pixeln entsteht kein horizontaler Seitenoverflow.
- Die fünf Phasen bleiben auf Mobile vollständig lesbar und bedienbar, ohne
  die Seite künstlich auf Desktopbreite zu zwingen.
- Modellzeilen, Kriterien, Aktionsbuttons, Sidebar/History, Tabellen und lange
  Modelltexte bleiben auf Mobile nutzbar. Lange Inhalte dürfen innerhalb
  ihrer Komponente umbrechen oder kontrolliert komponentenintern scrollen.

### Verbindliche Regressionstests

- Ergänze echte Browser-/Frontendtests, vorzugsweise mit Playwright, für:
  1. mehrere Zeichen nacheinander in einer Modellkennung bei durchgehendem
     Fokus und korrekt erhaltenem Wert;
  2. vollständige Tastaturbedienung der Conversation-History;
  3. Wiederöffnung eines abgeschlossenen Laufs mit korrekter Endphase und
     korrektem Export-Link;
  4. Reset über „Neue Conversation“ ohne veralteten Export-/Run-Zustand;
  5. Viewports 320, 390 und 430 px ohne horizontalen Dokumentoverflow.
- Ergänze automatisierte Accessibility-Checks mit Axe oder einem
  gleichwertigen etablierten Prüfer für mindestens Initialzustand und
  wiedergeöffneten abgeschlossenen Lauf. Kritische oder ernste Verstöße
  (`critical`/`serious`) sind nicht zulässig.
- Tests dürfen keine echten Provideraufrufe oder API-Keys benötigen und müssen
  deterministisch gegen lokale/mocked Daten laufen.
- Alle bestehenden 24 Backendtests, Anonymisierungs-/Reveal-Grenzen,
  `npm run build`, `process.env.PORT`, `/health`, Root-Route und sichere
  Config-Projektion bleiben grün.

### Nicht-Ziele für v1.3

- Noch kein neues Workspace-Layout, Ergebnis-Tabs, Configuration-Drawer oder
  visuelles Redesign aus Paket 2.
- Noch kein OpenRouter-Modellkatalog, neue Modell-Defaults, Presets,
  Kostenberechnung oder erweiterte Laufhistorie aus Paket 3.
- Keine Änderung an Council-Algorithmen, Review-Prompts, Aggregation,
  Anonymisierung oder Reveal-Timing, außer soweit ein UI-Projektionsfehler
  zwingend korrigiert werden muss.

## Iteration v1.3 — Retry-Kontext: zugängliche Live-Status

Der erste v1.3-Build und alle 32 automatisierten Tests waren grün, das
unabhängige Review fand jedoch einen Accessibility-Blocker:

- Die laufenden Council- und Phasenstatus in `RunView`, `ResponseCard` und
  `ReviewCard` werden nur als normale Texte ausgegeben. Fortschritt,
  Modellfehler und Abschluss werden Screenreadern dadurch nicht zuverlässig
  angekündigt.
- Ergänze angemessen dosierte `role="status"`-/`aria-live`-Semantik, ohne bei
  jedem kleinen Render unnötig den gesamten Bereich erneut anzukündigen.
- Fehler behalten beziehungsweise erhalten `role="alert"`; laufender
  Fortschritt und Abschluss müssen als Statusänderungen zugänglich sein.
- Ergänze eine gezielte deterministische Browser-Regression, welche die
  Live-Region-Semantik für Council-/Phasenfortschritt, Modellstatus und
  Abschluss prüft. Ein reiner Axe-Lauf reicht für dieses Kriterium nicht.
- Alle bisherigen v1.3-Fixes, 24 Backendtests, 8 Browser-/Axe-Tests,
  Reveal-Grenzen, Build und HTTP-Smokes dürfen nicht regressieren.

## Iteration v1.4 — Paket 2: Design und Informationsarchitektur

Kevin hat am 2026-07-15 Paket 2 beauftragt und ausdrücklich entschieden, die
kleine noch offene Überschriftenkorrektur aus Paket 1 in denselben Build-,
Test- und Review-Zyklus aufzunehmen. Ziel ist ein fokussierter, hochwertiger
„Council Analysis Workspace“ statt der bisherigen langen Debug-Ansicht.

### Verbindliche Restkorrektur aus Paket 1

- Die Markdown-Projektion muss für beliebige von Modellen gelieferte
  `h1`-bis-`h6`-Folgen eine konsistente Seitenhierarchie erzeugen. Insbesondere
  dürfen unter einem Ergebnisabschnitt mit `h2` keine `h4` oder tieferen
  Überschriften ohne dazwischenliegende Ebene entstehen.
- Der reale Produktionsfehler wird als Browserfixture nachgebildet: eine
  gespeicherte Antwort enthält mindestens eine Markdown-`###`-Überschrift
  direkt im Antworttext. Nach Wiederöffnung darf Axe keinen
  `heading-order`-Verstoß melden. Die Seite behält genau ein App-`h1`.

### Workspace-Layout und visuelle Richtung

- Gestalte die Oberfläche als eigenständigen Analyse-Arbeitsplatz mit klarer
  visueller Hierarchie, großzügiger lesbarer Typografie, konsistenten
  Abständen, ruhiger Farbpalette und deutlich unterscheidbaren Zuständen.
  Keine generische ChatGPT-Kopie und kein bloßes Umfärben der bestehenden
  Kartenwand.
- Desktop gliedert sich in:
  1. eine schmale, einklappbare History-Navigation links;
  2. einen priorisierten Ergebnis-/Arbeitsbereich in der Mitte;
  3. eine einklappbare Konfigurationsleiste beziehungsweise einen Drawer für
     Provider, Modelle, Rollen und Kriterien rechts.
- Der zentrale Ergebnisbereich erhält eine sinnvolle maximale Lesebreite,
  ohne Ranking oder Vergleich unnötig einzuengen. Navigation und zentrale
  Aktionen dürfen bei langen Ergebnissen sinnvoll sticky bleiben.
- Im leeren Zustand ist die Konfiguration leicht auffindbar. Nach Laufstart
  beziehungsweise beim Öffnen eines fertigen Laufs wird sie platzsparend
  eingeklappt, bleibt aber mit eindeutigem „Konfiguration öffnen“-Schalter
  erreichbar.
- Mobile verwendet keinen dauerhaft hohen Sidebar-Block: History wird als
  zugänglicher Drawer geöffnet, Konfiguration als Drawer oder klarer
  Disclosure-/Akkordeonbereich. Öffnen/Schließen, Escape, Fokusbegrenzung bei
  modalem Drawer und Fokus-Rückgabe an den Auslöser funktionieren korrekt.

### Ergebnisorientierte Informationsarchitektur

- Während eines Laufs steht der Fortschritt im Vordergrund. Nach einem
  abgeschlossenen Lauf ist „Synthese“ die standardmäßig aktive Ergebnisansicht
  und erscheint vor den Detailartefakten.
- Ergebnisse werden in vier klar beschriftete Ansichten gegliedert:
  „Synthese“, „Antworten“, „Bewertungen“ und „Laufdaten“. Zusätzlich kann
  „Antworten“ einen gut erreichbaren Vergleichsmodus enthalten.
- Die Ansichten verwenden ein korrektes zugängliches Tab-/Panel-Muster oder
  eine gleichwertig kompakte, semantische Navigation. Bei Tabs müssen
  Pfeiltasten, Home/End, Enter/Space, `aria-selected`, `aria-controls` und
  Fokusführung dem erwartbaren Tastaturmuster entsprechen.
- Nicht aktive Ergebnisansichten sind tatsächlich aus Layout und
  Accessibility-Tree ausgeblendet. Ein vollständiger gespeicherter Lauf darf
  nicht mehr alle Antworten, Reviews und Synthese gleichzeitig zu einer über
  20.000 px langen Seite stapeln.
- Einzelantworten sind einzeln auswählbar und bieten einen Vergleichsmodus für
  zwei Antworten nebeneinander. Auf kleinen Viewports fällt der Vergleich
  lesbar untereinander zurück. Modellname, anonyme ID, Status, Laufzeit und
  Tokens bleiben nachvollziehbar.

### Strukturierte Bewertungen und Ranglisten

- Reviews werden primär aus dem vorhandenen strukturierten Reviewobjekt als
  verständliche UI gerendert: Kriterienwerte, Gesamt-/Ranginformation,
  Begründung, Stärken und Schwächen. Lange Inhalte sind aufklappbar.
- Das rohe Review-JSON bleibt nur in einem klar als „Technische Details“
  bezeichneten, standardmäßig geschlossenen `<details>`-Bereich verfügbar.
- Ranglisten bleiben echte zugängliche Tabellen und zeigen mindestens Rang,
  Antwort/Modell, gewichteten Score und gültige Stimmen. Soweit die
  vorhandenen Daten es hergeben, werden Kriterienwerte sowie die Veränderung
  zwischen Runde 1 und Runde 2 verständlich dargestellt. Fehlende Werte werden
  ehrlich als nicht verfügbar gekennzeichnet, nicht erfunden.
- Fortschritt und Phasen zeigen visuell und semantisch „ausstehend“, „läuft“,
  „abgeschlossen“ und „Fehler“. Der Zustand darf nie allein von Farbe
  abhängen. Die in v1.3 eingeführten dosierten Live-Regionen bleiben erhalten.
- Laufdaten formatieren Dauer menschenlesbar (`4:11 min` statt `251431 ms`),
  Calls, Erfolge/Fehler und Tokens als beschriftete Kennzahlen. Eine
  Kostenberechnung ist weiterhin Paket 3 und darf hier nicht vorgetäuscht
  werden.

### Responsive und Accessibility

- Desktopprüfung mindestens bei 1280 × 800 und 1440 × 1000; Mobileprüfung bei
  320, 390 und 430 CSS-Pixeln. Es entsteht kein horizontaler Dokumentoverflow.
- Touchziele, Fokusdarstellung, Skip-Link, Labels, Tabellen, Live-Regionen,
  History-Tastaturbedienung, Modellfokus und Reset-/Exportzustände aus v1.3
  dürfen nicht regressieren.
- Drawer, Tabs, Antwortauswahl, Vergleich und aufklappbare Reviewdetails sind
  vollständig mit Tastatur und Screenreader-Semantik bedienbar.
- `prefers-reduced-motion` wird respektiert; Animationen sind dezent und für
  Funktion oder Verständnis nicht erforderlich.
- Modellinhalte bleiben sicher gerendert. Kein ungefiltertes HTML, kein
  `dangerouslySetInnerHTML` und keine Aufweichung der Reveal-Grenzen.

### Verbindliche Browser-Regressionen

- Erweitere die Playwright-Suite deterministisch für mindestens:
  1. aktive Syntheseansicht nach Wiederöffnung eines abgeschlossenen Laufs;
  2. Tastaturbedienung der vier Ergebnisansichten einschließlich korrekter
     Tab-/Panel-Semantik;
  3. Auswahl und Vergleich zweier Antworten;
  4. strukturierte Reviewdarstellung und standardmäßig geschlossenes Roh-JSON;
  5. Desktop-Konfigurationsleiste und Mobile-History-/Konfigurationsdrawer
     einschließlich Escape und Fokus-Rückgabe;
  6. echte Markdown-`###`-Fixture ohne Axe-`heading-order`-Verstoß;
  7. 320/390/430 px ohne Dokumentoverflow sowie sinnvolles gestapeltes
     Vergleichslayout;
  8. Produktionsähnlicher abgeschlossener Lauf bleibt deutlich kompakter als
     die bisherige alles gleichzeitig rendernde Ansicht.
- Axe prüft Initialzustand und vollständigen gespeicherten Lauf. Es sind keine
  `critical`/`serious`-Verstöße und ausdrücklich kein `heading-order`-Verstoß
  zulässig.
- Alle bestehenden 24 Backendtests und 9 v1.3-Browserregressionen bleiben
  grün oder werden bei bewusst geänderter UI-Semantik gleichwertig angepasst.
  Anonymisierung, atomisches Reveal, Export-Sperre, Secret-Redaction,
  `process.env.PORT`, Build, `/health` und Root-Route dürfen nicht regressieren.

### Nicht-Ziele für v1.4

- Noch kein dynamischer OpenRouter-Modellkatalog, keine neuen Modell-Defaults,
  keine Presets und keine Vorabvalidierung aller ausgewählten Modelle.
- Noch keine Kostenberechnung oder Budgetgrenzen.
- Noch keine erweiterte Auswahl einzelner historischer Runs innerhalb einer
  Conversation und kein „Konfiguration kopieren und erneut ausführen“.
- Keine Änderung an Council-Algorithmus, Review-Prompts, Aggregation,
  Verbesserungsschleife, Persistenzschema oder Reveal-Timing.

## Iteration v1.4 — Retry-Kontext: Konfigurationszustand und modale Drawer

Der erste v1.4-Build sowie 24 Backend- und 15 Playwright/Axe-Tests waren grün,
das unabhängige Review fand jedoch zwei fachliche Blocker:

1. **Desktop-Konfiguration nach Laufstart**
   - `startRun()` startet den SSE-Lauf, setzt `configOpen` aber nicht zurück.
   - Klappe die Desktop-Konfiguration beim Laufstart platzsparend ein, ohne die
     gute Auffindbarkeit im Empty State zu verlieren.
   - Der eindeutig beschriftete Schalter zum erneuten Öffnen muss erhalten
     bleiben.
   - Ergänze eine deterministische Browser-Regression für genau diesen
     Zustandswechsel.

2. **Vollständige modale Fokusführung der mobilen Drawer**
   - History- und Konfigurationsdrawer benötigen zugängliche Dialog-/Modal-
     Semantik oder ein nachweislich gleichwertiges Muster.
   - Beim Öffnen muss der Fokus sinnvoll in den jeweiligen Drawer wechseln.
   - Solange er offen ist, bleibt die Tastaturfokussierung vollständig im
     Drawer; Hintergrund und Backdrop dürfen nicht fokussierbar oder für
     assistive Technik als aktive Oberfläche erreichbar sein.
   - Escape und Backdrop schließen weiterhin, danach kehrt der Fokus exakt zum
     jeweiligen Auslöser zurück.
   - Ergänze deterministische Focus-Containment-Regressionen für beide Drawer,
     inklusive initialem Fokus, Vorwärts-/Rückwärts-Tabbing und Fokus-Rückgabe.

Alle bisherigen v1.4-Funktionen und v1.3-Regressionsgrenzen sowie 24 Backend-
tests, Reveal/Export/Secret/SSE, `process.env.PORT`, Build und HTTP-Smokes
müssen grün bleiben.

## Iteration v1.4 — ausdrücklich freigegebener Fix-Versuch 3

Kevin hat am 2026-07-15 Option (a) und damit einen dritten, ausschließlich auf
den letzten Reviewer-Blocker begrenzten Build-Versuch freigegeben.

- Auf einem frischen mobilen Viewport bei 390 px öffnet der Header-Schalter
  „Konfiguration öffnen“ den modalen Konfigurationsdrawer, ohne den echten
  Auslöser in `configTriggerRef` festzuhalten.
- Beim anschließenden Schließen über `.drawerBackdrop` ist der Drawer zwar zu,
  aber der Fokus fällt auf `document.body`, weil `configTriggerRef.current`
  `null` ist.
- Erfasse den tatsächlich verwendeten mobilen Konfigurations-Auslöser vor dem
  Öffnen zuverlässig und bewahre ihn über den gesamten modalen Lebenszyklus.
- Nach Backdrop-Schließen muss der Fokus exakt auf denselben sichtbaren
  Header-Schalter zurückkehren. Escape-Schließen und alle anderen bereits
  funktionierenden Fokus-Rückgaben müssen erhalten bleiben.
- Ergänze eine frische deterministische Playwright-Regression bei 390 px:
  Seite neu laden, Konfigurationsdrawer über den mobilen Header öffnen,
  initialen Fokus und modale Semantik prüfen, über den Backdrop schließen und
  anschließend exakten Fokus auf dem auslösenden Header-Schalter verlangen.
- Der Test muss den vorher fehlenden Backdrop-Pfad prüfen und darf nicht durch
  einen zuvor verwendeten Desktop-Schalter oder bestehenden Ref-Zustand
  beeinflusst werden.
- Der Fix bleibt eng begrenzt. Workspace-Design, Tabs, Vergleich, strukturierte
  Reviews, History-Drawer, Fokusfalle, Hintergrundisolation, Heading-Fix,
  v1.3-Regressionsgrenzen, 24 Backendtests, bestehende 16 Browser/Axe-Tests,
  Reveal/Export/Secret/SSE, Build und HTTP-Smokes dürfen nicht regressieren.

## Iteration v1.4.1 — Paket 2 vollständig abschließen

Kevin hat am 2026-07-15 nach eigener Live-Prüfung den gezielten Abschluss von
Paket 2 beauftragt. v1.4 bleibt bis zu grünen Tester- und Reviewer-Gates
produktiv. Diese Iteration behebt ausschließlich die zwei noch offenen Punkte
aus Paket 2; sämtliche Inhalte aus Paket 3 bleiben Nicht-Ziele.

### 1. Desktop-History wirklich einklappbar machen

- Die linke Conversation-History muss bei Desktop-Viewports ab 1101 px über
  einen klar beschrifteten, tastaturbedienbaren Schalter ein- und ausgeklappt
  werden können. Der aktuelle dauerhaft reservierte 248-px-Bereich erfüllt die
  ursprüngliche Planung nicht.
- Im eingeklappten Zustand darf die Sidebar weder Layoutbreite reservieren noch
  fokussierbare oder für assistive Technik aktive Bedienelemente enthalten.
  Der zentrale Workspace nutzt den freigewordenen Platz.
- Ein sichtbarer Schalter zum erneuten Öffnen bleibt jederzeit erreichbar und
  kommuniziert den Zustand mit `aria-expanded` und einer eindeutigen
  Beschriftung. Beim Schließen darf der Fokus nicht verloren gehen.
- Mobile History bleibt der bestehende modale Drawer. Desktop-Collapse und
  Mobile-Drawer dürfen ihre Zustände und Fokus-Auslöser nicht gegenseitig
  verfälschen.
- Ergänze eine deterministische Browser-Regression bei 1440 × 1000: History
  schließen, nachweisen, dass ihre Grid-Breite entfällt und ihre Inhalte nicht
  fokussierbar/zugänglich sind, Schalter fokussiert beziehungsweise erreichbar
  bleibt, History wieder öffnen und Zustand sowie Bedienbarkeit bestätigen.

### 2. Mobile modale Hintergrundisolation wirksam machen

- Reproduziere den finalen Tester-Befund in einem frischen Produktions-Build
  bei 390 × 850: mobilen Konfigurationsdrawer ausschließlich über den sichtbaren
  Header-Schalter öffnen und danach die tatsächlichen DOM-Attribute sowie
  `HTMLElement.inert` prüfen.
- Solange der Konfigurationsdialog offen ist, müssen `header.mobileBar`,
  `main.workspace`, `.skipLink` und alle sonstigen Hintergrundbereiche
  nachweislich inert beziehungsweise gleichwertig vollständig aus Fokusfolge
  und Accessibility-Tree isoliert sein. Der Dialog selbst und sein Backdrop
  bleiben bedienbar.
- Verwende eine robuste React-DOM-Abbildung für das boolesche `inert`-Attribut;
  ein Ausdruck, der im Produktions-DOM zu `null` beziehungsweise
  `element.inert === false` führt, ist nicht ausreichend.
- Dasselbe Isolationsprinzip gilt symmetrisch für den mobilen History-Drawer.
  Initialer Fokus, Tab-/Shift-Tab-Fokusfalle, Escape, Backdrop-Schließen und
  exakte Fokus-Rückgabe zu beiden mobilen Auslösern bleiben erhalten.
- Ergänze eine frische Regression bei 390 × 850 für beide Drawer. Sie muss
  Attribute und DOM-Properties der Hintergrundbereiche prüfen und zusätzlich
  nachweisen, dass Hintergrundcontrols während des Dialogs nicht per Tastatur
  erreichbar sind. Nach Schließen muss `inert` vollständig entfernt und der
  Hintergrund wieder bedienbar sein.

### Abschluss-Gates

- Alle bisherigen 24 Backendtests und 17 Playwright/Axe-Tests bleiben grün.
- Ergänzte Desktop-Collapse- und Mobile-Isolationsregressionen laufen gegen den
  gebauten Produktionsstand, nicht nur gegen Quelltextannahmen.
- `npm run build`, Test-Port 3210, `/health`, Root-Route und Cleanup sind grün.
- Reveal-/Export-Atomizität, Secret-Redaction, SSE-Abbruch, stabile
  Modellfokussierung, Heading-Hierarchie, Tabs, Antwortvergleich, strukturierte
  Reviews und Responsive-Verhalten bei 320/390/430 px regressieren nicht.
- Nach grünem Tester-Gate ist ein neues unabhängiges Reviewer-Gate für den
  finalen v1.4.1-Stand verbindlich. Erst danach darf deployed werden.

### Nicht-Ziele

- Kein OpenRouter-Modellkatalog, keine Änderung der Modell-Defaults, keine
  Presets und keine Vorabvalidierung aller Modelle.
- Keine Kostenprognose, Budgetgrenzen oder neuen Laufmodi.
- Keine erweiterte historische Run-Auswahl und kein Kopieren alter
  Konfigurationen.
- Keine Änderung an Council-Algorithmus, Prompts, Persistenzschema oder
  Reveal-Timing.

## Iteration v1.5 — Paket 3: Modelle, Presets, Kosten und vollständige Run-Historie

Kevin hat am 2026-07-15 nach vollständig grünem Abschluss von Paket 2 die
Umsetzung von Paket 3 beauftragt. Ziel ist eine inhaltlich belastbare
Arbeitsoberfläche, die aktuelle OpenRouter-Modelle sicher auswählt, Umfang und
Kosten eines Laufs transparent macht und jeden historischen Run einzeln
nutzbar hält.

Offizielle Integrationsgrundlage (Stand 2026-07-15):

- Modellkatalog: `GET https://openrouter.ai/api/v1/models`
  (`https://openrouter.ai/docs/api/api-reference/models/get-models`)
- Einzelmodell/Alias-Auflösung:
  `GET https://openrouter.ai/api/v1/model/:author/:slug`
  (`https://openrouter.ai/docs/api/api-reference/models/get-model`)
- `pricing.prompt` und `pricing.completion` sind USD pro Token;
  `pricing.request` ist USD pro Request. Historische Kosten dürfen nie mit
  später veränderten Katalogpreisen rückwirkend neu berechnet werden.

### 1. Robuster OpenRouter-Modellkatalog

- Das Backend stellt einen sicheren read-only Katalog-Endpunkt für die UI
  bereit. Es lädt ausschließlich textausgebende Modelle aus dem offiziellen
  OpenRouter-Katalog, validiert das Antwortschema und projiziert nur benötigte
  Felder: `id`, `canonical_slug`, `name`, Beschreibung, Kontextlänge,
  Modalitäten, unterstützte Parameter, Ablaufdatum sowie die relevanten
  Preisfelder.
- Upstream-Aufrufe erhalten Timeout, Größenbegrenzung und einen
  speicherinternen Cache mit nachvollziehbarem Alter. Bei temporärem
  OpenRouter-Ausfall darf ein vorhandener letzter erfolgreicher Cache als
  „veraltet“ gekennzeichnet weiterverwendet werden; ohne Cache erscheint eine
  echte Fehleransicht mit Retry. Fehler oder externe Texte dürfen nicht als
  HTML gerendert werden.
- Weder der serverseitige noch der vom Nutzer eingegebene API-Key wird für den
  öffentlichen Katalog benötigt, geloggt, gecacht oder an einen anderen Host
  gesendet. Benutzerdefinierte Base-URLs dürfen nicht als beliebiges
  serverseitiges Fetch-Ziel für den Katalog dienen (kein SSRF).
- Die UI bietet eine durchsuchbare, tastatur- und screenreaderbedienbare
  Modellwahl nach Anzeigename oder vollständigem Slug. Angezeigt werden
  mindestens Anbieter/Name, exakter Slug, Kontextlänge und Prompt-/Completion-
  Preis pro eine Million Token.
- Manuelle Modellkennungen bleiben möglich. Sie werden sichtbar als manuell
  gekennzeichnet und vor dem Lauf über eine sichere OpenRouter-Slug-Auflösung
  verifiziert. Alias-Auflösung zeigt den kanonischen Slug transparent; die App
  sendet einen gültigen OpenRouter-Identifier mit Organisationspräfix.
- Veraltete freie Defaults ohne Organisationspräfix werden ersetzt. Aktuell
  bestätigte katalogfähige Ausgangsmodelle sind:
  `openai/gpt-5.5`, `openai/gpt-5.4`,
  `anthropic/claude-sonnet-4.6` und
  `google/gemini-3.1-pro-preview`. Beim Start wird jede Empfehlung gegen den
  geladenen Katalog abgeglichen; ein später nicht mehr verfügbares Modell wird
  nicht still verwendet.

### 2. Presets und Laufmodi

- Biete drei klar erklärte Presets, die ausschließlich aktuell validierte
  Katalogmodelle verwenden und Council, Chairman sowie Laufmodus vollständig
  setzen:
  - **Schnell:** zwei kostengünstige/schnelle Council-Modelle, getrenntes
    Chairman-Modell, Standardlauf;
  - **Ausgewogen:** zwei hochwertige unterschiedliche Modellfamilien,
    getrenntes Chairman-Modell, Standardlauf;
  - **Gründlich:** drei hochwertige unterschiedliche Modellfamilien,
    getrenntes Chairman-Modell, iterativer Lauf.
- Empfohlene Slugs dürfen in einer zentralen Presetdefinition stehen, müssen
  aber bei jeder Katalogaktualisierung verifiziert werden. Ist ein Presetmodell
  nicht verfügbar, wird das Preset deaktiviert oder verlangt eine bewusste
  Ersatzwahl; kein stilles Downgrade und keine erfundene ID.
- Presets überschreiben eine bestehende manuelle Konfiguration erst nach einer
  eindeutigen Benutzeraktion. Die konkrete Modellliste, Phasezahl und
  Kostenprognose sind vor dem Start sichtbar.
- Laufmodus ist unabhängig vom Preset editierbar:
  - **Standard (3 Phasen):** Antworten → Peer-Review → Synthese;
  - **Iterativ (5 Phasen):** Antworten → Peer-Review → Verbesserung →
    Re-Review → Synthese.
- Backend-Orchestrierung, Phasenanzeige, SSE, Persistenz, Export und
  Rekonstruktion müssen beide Modi korrekt abbilden. Alte Runs ohne
  Modusfeld gelten rückwärtskompatibel als iterativ.

### 3. Vollständige Vorabvalidierung

- Vor dem Start werden alle eindeutigen Council- und Chairman-Modelle geprüft,
  nicht nur das erste Council-Modell. Geprüft werden mindestens: nicht leer,
  vollständiger/auflösbarer Slug, im aktuellen Katalog vorhanden oder als
  Alias auflösbar, textfähige Ausgabe, nicht abgelaufen, keine Dublette und
  Chairman nicht zugleich Council-Mitglied.
- Die Validierung ist nicht abrechnungspflichtig und darf keine Chat-
  Completion pro Modell auslösen. Einzelne Fehler werden dem jeweiligen Modell
  zugeordnet; solange ein ausgewähltes Modell ungültig ist, bleibt der Lauf
  blockiert.
- „Provider testen“ darf nicht länger suggerieren, alle Modelle seien gültig,
  wenn nur eines geprüft wurde. Trenne verständlich zwischen API-Key/
  Providerverbindung und Katalogvalidierung der vollständigen Auswahl.
- Catalog-/Validierungsantworten sind begrenzt, schema-validiert und geben
  weder API-Key noch interne Upstream-Fehler ungefiltert an Browser, Logs oder
  Persistenz weiter.

### 4. Transparente Call- und Kostenprognose

- Vor dem Start zeigt die App mindestens Council-Anzahl, Laufmodus, geplante
  Basismodellaufrufe und eine geschätzte USD-Kostenspanne beziehungsweise
  nachvollziehbare Schätzung. Standardlauf: `2N + 1` Basiscalls; iterativer
  Lauf: `4N + 1` Basiscalls. Mögliche zusätzliche JSON-Reparaturaufrufe werden
  separat als variable Obergrenze/Caveat ausgewiesen.
- Die Kostenschätzung basiert auf den geladenen Prompt-, Completion- und
  Requestpreisen sowie sichtbaren, konservativen Tokenannahmen. Jede Annahme
  ist in der UI erklärbar; unbekannte oder nicht numerische Preise ergeben
  „nicht verfügbar“, niemals fiktiv `0,00 $`.
- Beim Start wird pro Modell ein minimaler Preissnapshot ohne externe Texte
  und ohne Secrets im Run gespeichert. Nach Abschluss werden tatsächliche
  Prompt-/Completion-Token je Call mit diesem Snapshot berechnet und als
  geschätzte tatsächliche Modellkosten, Gesamtbetrag und Modellaufschlüsselung
  angezeigt. Fehlende Usage- oder Preisfelder bleiben sichtbar unvollständig.
- OpenRouter-Generation-IDs beziehungsweise serverseitig gemeldete echte
  Kosten dürfen zusätzlich genutzt werden, falls bereits sicher verfügbar;
  eine nachträgliche externe Abfrage mit geheimen Schlüsseln ist kein Muss.
  UI und Export müssen klar zwischen Prognose und tatsächlicher/aus Usage
  berechneter Schätzung unterscheiden.
- Historische Runs behalten ihren damaligen Preissnapshot. Ein neuer Katalog
  darf historische Summen nicht verändern.

### 5. Vollständige Run-Historie und Wiederverwendung

- Die linke History zeigt unter jeder Conversation alle Runs einzeln, nicht nur
  den neuesten. Jeder Eintrag enthält mindestens Datum/Uhrzeit, Status,
  Laufmodus, Modellgruppe und eine kurze Laufkennung. Lange Listen bleiben
  kompakt und tastaturbedienbar.
- Jeder abgeschlossene, fehlgeschlagene und abgebrochene Run ist einzeln
  auswählbar. Auswahl rekonstruiert exakt diesen Run, setzt `currentRunId`
  korrekt und bindet Export, Phasen, Ergebnisse, Kosten und Laufdaten nur an
  diesen Run. Es darf kein Artefakt eines zuvor geöffneten Runs sichtbar oder
  exportierbar bleiben.
- Alte Daten ohne neue v1.5-Felder werden defensiv als „nicht verfügbar“
  dargestellt. Persistenzmigrationen sind idempotent, rückwärtskompatibel und
  zerstören keine vorhandenen Conversations/Runs.
- „Konfiguration übernehmen“ kopiert Provider-Base-URL, Modelle/Rollen,
  Kriterien, Preset/Custom-Zustand und Laufmodus aus einem historischen Run in
  einen neuen Entwurf. Der alte Run bleibt unverändert. API-Keys werden nie aus
  Historie oder Persistenz rekonstruiert; die UI fordert sie bei Bedarf neu an.
- Optionales „Erneut ausführen“ darf erst nach sichtbarer Übernahme und erneuter
  vollständiger Validierung starten, nicht unmittelbar durch einen einzelnen
  unbeabsichtigten Klick.

### 6. Flüchtige API-Key-Verwaltung

- Der API-Key bleibt ausschließlich im flüchtigen Browser-/Requestzustand und
  wird weiterhin niemals in SQLite, Katalogcache, URL, Export, SSE, Logs oder
  API-Antworten persistiert.
- Neben dem Passwortfeld gibt es eine eindeutig beschriftete Aktion
  „API-Key löschen“, die den Wert sofort aus dem React-Zustand entfernt und
  den Status zugänglich bestätigt.
- Biete eine verständliche flüchtige Aufbewahrungsregel mindestens für
  „bis Tab geschlossen wird“ und „nach jedem Lauf löschen“. Standard ist die
  sicherere Regel „nach jedem Lauf löschen“. Auch Fehler, Abbruch und
  `Neue Conversation` müssen der gewählten Regel konsistent folgen.
- Kein Browser-Storage für den Key. Tests prüfen explizit LocalStorage,
  SessionStorage, IndexedDB, History-Daten, Serverpersistenz und Exporte.

### UX, Accessibility und Responsive

- Katalogsuche, Combobox/Listbox, Presets, Laufmodus, Kostenhinweise,
  verschachtelte Run-Historie und Konfigurationsübernahme sind vollständig per
  Tastatur bedienbar, korrekt beschriftet und besitzen nachvollziehbare Fokus-
  und Live-Statusführung. Keine Information wird nur farblich vermittelt.
- Große Kataloglisten werden performant dargestellt und erzeugen keinen
  tausende Elemente langen Accessibility-Tree; Filterung/Begrenzung oder
  Virtualisierung muss die Bedienbarkeit erhalten.
- Desktop 1280/1440 sowie Mobile 320/390/430 px bleiben ohne horizontalen
  Dokumentoverflow. Drawer-`inert`, Fokusfalle, Fokus-Rückgabe,
  History-Collapse, Tabs, Heading-Order, Modelltippen und Reduced Motion aus
  Paket 1/2 dürfen nicht regressieren.
- Lade-, Leere-, Stale-Cache-, Validierungs- und Kosten-unbekannt-Zustände sind
  echte verständliche UI-Zustände und keine dauerhaft hängenden Spinner.

### Verbindliche Tests und Sicherheitsgrenzen

- Deterministische Backendtests mit injizierbarem/mockbarem OpenRouter-Upstream
  für Katalogschema, Timeout, Cache/Stale-Fallback, Größenbegrenzung, SSRF-
  Vermeidung, Slug-/Aliasvalidierung, Presets, beide Laufmodi, Callformeln,
  Preisberechnung, Preissnapshots, Migrationen und Secret-Redaction.
- Produktionsnahe Playwright/Axe-Regressionen für Suche/Modellwahl, manuelle
  ID, alle Presets, vollständige Auswahlvalidierung, Kostenpreview, beide
  Laufmodi, alle Runs einer Conversation, Run-Wechsel ohne State-Leak,
  Konfigurationsübernahme ohne Key, Key-Löschung/-Policy sowie Fehler- und
  Responsive-Zustände.
- Bestehende 24 Backendtests und 19 Playwright/Axe-Tests bleiben grün.
  Reveal-/Export-Atomizität, Anonymisierung, Secret-Grenzen, SSE-Abbruch,
  `process.env.PORT`, Build, `/health`, Root-Route und Test-Port-Cleanup bleiben
  unverändert verbindlich.
- Keine Tests gegen den echten OpenRouter-Dienst und keine realen
  kostenpflichtigen Modellaufrufe in CI/Tester. Externe Antworten gelten als
  untrusted data und werden ausschließlich als Daten verarbeitet.
- Deployment erst nach grünem unabhängigem Tester- und Reviewer-Gate.

### Nicht-Ziele für v1.5

- Keine weiteren Provider neben OpenRouter und keine LiteLLM-Schicht.
- Keine automatische Modellauswahl durch ein LLM und keine autonome
  Budgetentscheidung.
- Keine Änderung der Review-Prompts, Bewertungslogik oder Anonymisierungs-
  und Reveal-Grenzen außerhalb der notwendigen 3-/5-Phasensteuerung.
- Keine Accounts, Cloud-Synchronisierung oder dauerhafte Speicherung von
  API-Keys.

## Iteration v1.5 — ausdrücklich freigegebener Fix-Versuch 3

Kevin hat am 2026-07-15 Option (a) und damit einen dritten, ausschließlich auf
die drei offenen Reviewer-Concerns V15-002, V15-003 und V15-004 begrenzten
Build-Versuch freigegeben. Der produktive v1.4.1-Stand bleibt bis zu einem
neuen grünen Tester- und Reviewer-Gate unverändert.

### V15-002 — Stale Katalog darf keinen Run starten

- Ein stale Cache darf weiterhin ausschließlich zum sichtbar als veraltet
  gekennzeichneten Durchsuchen der UI dienen. Für `POST /api/runs` ist eine
  frische erfolgreiche Katalogvalidierung zwingend.
- Schlägt der Refresh fehl oder liefert die Validierung `stale`, antwortet der
  Run-Endpunkt vor dem Öffnen des SSE-Streams mit einer klaren `503`-
  Fehlerantwort. Es gibt in diesem Fall keine Conversation, keinen Run, keine
  Persistenzänderung, keinen Orchestrator- oder Provider-Aufruf.
- Ergänze deterministische HTTP-Regressionen für:
  1. gefüllter Cache + anschließender Upstream-Ausfall → `503`, null
     Store-/Orchestrator-/Provider-Seiteneffekte;
  2. frischer Cache → gültiger Start;
  3. kein Cache + Upstream-Ausfall → `503`, ebenfalls null Seiteneffekte.

### V15-003 — Kanonische Slugs atomar erzwingen

- Die serverseitige Katalogvalidierung liefert für jeden Council- und
  Chairman-Eintrag den `canonical_slug`. Vor SSE, Preisbildung, Persistenz,
  Orchestrator und Provider werden sämtliche Modellreferenzen atomar auf
  diesen kanonischen Slug normalisiert.
- Alias-IDs dürfen nicht unverändert zum Provider gelangen. Falls ein Modell
  nicht eindeutig kanonisiert werden kann, antworte `422` ohne jede
  Seiteneffektgrenze.
- Der kanonische Slug muss konsistent in Provider-Call, redaktierter
  Run-Konfiguration, Preissnapshot, UI-/SSE-Projektion und Export verwendet
  werden. Die ursprüngliche Alias-Eingabe darf höchstens als rein informative,
  sichere UI-Angabe erhalten bleiben und niemals die Ausführung steuern.
- Ergänze positive und negative HTTP-Tests für `id != canonical_slug` in jeder
  Council-Position und beim Chairman. Instrumentiere den tatsächlich an den
  Provider übergebenen Input und belege den kanonischen Slug.

### V15-004 — Preissnapshot ausschließlich serverseitig

- Ignoriere beziehungsweise verwerfe jedes vom Client gesendete
  `priceSnapshot`- oder Preisfeld vollständig. Nach frischer erfolgreicher
  Katalogvalidierung erzeugt das Backend den minimalen Preissnapshot
  ausschließlich aus den serverseitig projizierten Katalogeinträgen der
  kanonischen Modelle.
- Snapshot und Kostenberechnung verwenden je Modell mindestens kanonischen
  Slug, `pricing.prompt`, `pricing.completion`, `pricing.request`, Katalog-
  Zeitstempel und klaren Währungs-/Einheitenkontext. Nicht numerische oder
  fehlende Werte bleiben unbekannt und werden nicht zu `0` umgedeutet.
- Der serverseitige Snapshot wird vor Orchestrator/Persistenz in den
  normalisierten Run-Input eingesetzt und danach unverändert historisch
  gespeichert. Provider, Client oder ein späterer Katalogrefresh dürfen ihn
  nicht rückwirkend verändern.
- Ergänze Tests mit manipulierten, fehlenden und widersprüchlichen
  Clientpreisen. Gespeicherter Snapshot und Kosten müssen stets den frisch
  validierten kanonischen Katalogpreisen entsprechen.

### Erneute Abschluss-Gates

- Die drei neuen Fehlerpfade prüfen ausdrücklich HTTP-Status sowie null
  Provider-, Orchestrator- und Persistenzaufrufe vor jeder Seiteneffektgrenze.
- Alle bisherigen 32 Backendtests und 21 Playwright/Axe-Tests, Build,
  Produktions-Smokes, Secret-Lebenszyklus, Preissnapshots, Run-State-Leaks und
  sämtliche Paket-1/2-Grenzen bleiben grün.
- Keine Erweiterung außerhalb dieser drei Concerns. Deployment erst nach einem
  neuen grünen Tester- und Reviewer-Gate.

## Iteration v1.5 — ausdrücklich freigegebener Fix-Versuch 4

Kevin hat am 2026-07-15 Option (a) und damit einen vierten, ausschließlich auf
den neuen Reviewer-Blocker zur kanonischen Auswahl-Invariante begrenzten
Build-Versuch freigegeben. Alle drei Concerns aus Fixversuch 3 gelten laut
Review als geschlossen und dürfen nicht erneut geöffnet werden.

### Kanonische Auswahl-Invarianten nach Alias-Auflösung

- Nach `canonicalizeRunInput` und vor SSE, Store, Orchestrator, Provider und
  Preissnapshot wird die vollständig kanonisierte Gesamtauswahl erneut
  validiert.
- Die kanonischen Council-Slugs müssen paarweise eindeutig sein. Zwei
  verschiedene rohe Alias-Slugs, die auf dasselbe kanonische Modell zeigen,
  ergeben `422` mit einem dem Council zugeordneten verständlichen Fehler.
- Der kanonische Chairman-Slug darf keinem kanonischen Council-Slug
  entsprechen. Alias-vs.-Alias, Alias-vs.-Canonical und
  Canonical-vs.-Alias ergeben jeweils `422` mit verständlicher
  Chairman-/Council-Konfliktmeldung.
- Die Prüfung darf nicht nur `modelRef.key`, die rohe ID oder die vor der
  Kanonisierung vorhandene Auswahl vergleichen. Maßgeblich ist ausschließlich
  der endgültige `canonical_slug`, der tatsächlich Provider, Persistenz und
  Kosten steuert.
- Jeder Konflikt wird als normale JSON-Fehlerantwort beendet, bevor der
  SSE-Stream geöffnet oder irgendeine Conversation beziehungsweise ein Run
  angelegt wird. Garantiert null Store-, Orchestrator- und Provider-Aufrufe.
- Eine gültige Auswahl aus unterschiedlichen Alias-Slugs, die auf
  unterschiedliche kanonische Modelle zeigen, muss weiterhin starten und
  ausschließlich die kanonischen Slugs sowie serverseitigen Preise verwenden.

### Verbindliche Regressionen

- HTTP-Test: zwei unterschiedliche Council-Aliase → derselbe kanonische Slug
  → `422`, null Persistenz/Orchestrator/Provider.
- HTTP-Test: Council-Alias und Chairman-Canonical beziehungsweise umgekehrt →
  derselbe kanonische Slug → `422`, null Persistenz/Orchestrator/Provider.
- Positiver Kontrolltest: unterschiedliche kanonische Slugs passieren die
  erneute Prüfung und erreichen den instrumentierten Orchestrator ausschließlich
  kanonisiert.
- Alle bisherigen 35 Backendtests und 21 Playwright/Axe-Tests, insbesondere
  stale-`503`, serverseitiger Preissnapshot, Alias-Kanonisierung,
  Secret-Lebenszyklus, Run-State-Leaks und sämtliche Paket-1/2-Grenzen bleiben
  grün. Keine Änderung außerhalb dieses Blockers.
- Deployment erst nach einem neuen grünen Tester- und Reviewer-Gate.

## Iteration v1.5 — Retry-Kontext: serverseitige vollständige Modellvalidierung

Der erste v1.5-Build sowie 30 Backend- und 21 Playwright/Axe-Tests waren grün,
der unabhängige Tester fand jedoch den Sicherheitsblocker `V15-001`:

- Die Browser-UI ruft zwar `/api/models/validate` auf, aber ein direkter
  `POST /api/runs` kann diese Prüfung umgehen.
- `server/app.js` normalisiert den Request und startet anschließend den
  Orchestrator, ohne die vollständige Auswahl aller Council-Modelle und des
  Chairman-Modells serverseitig gegen den aktuellen Katalog zu validieren.
- Dadurch könnten ungültige, abgelaufene, nicht-kanonische oder nicht mehr
  verfügbare Modellkennungen kostenpflichtige Provider-Calls erreichen.

Verbindlicher Fix:

- `POST /api/runs` muss **vor** Orchestrator-, Persistenz- oder Providerarbeit
  die vollständige Council-/Chairman-Auswahl serverseitig und kostenfrei gegen
  den sicheren Katalog validieren.
- Die Prüfung umfasst jedes ausgewählte Modell, nicht nur das erste oder eine
  Teilmenge, und nutzt dieselbe kanonische Full-Slug-/Alias-Semantik wie der
  Validierungsendpunkt.
- Bei ungültiger, fehlender, abgelaufener oder nicht verfügbarer Auswahl endet
  der Request mit einer klaren 4xx-Antwort; es darf kein Provider-Call, Run,
  Conversation-Restzustand oder Kostenartefakt entstehen.
- Cache-/Stale-Fallback-Verhalten muss konsistent und sicher bleiben. Ein
  Katalogfehler darf nicht stillschweigend als erfolgreiche Validierung gelten.
- Ergänze deterministische Backend-Regressionen für direkten API-Bypass,
  vollständige Mehrmodell-/Chairman-Prüfung, keinerlei Provideraufruf bei
  Fehler und erfolgreichen Start einer vollständig gültigen Auswahl.
- Browservalidierung bleibt als UX-Hilfe erhalten, ist aber nicht die
  Sicherheitsgrenze.

Alle übrigen v1.5-Funktionen, 30 Backendtests, 21 Browser/Axe-Tests sowie
Paket-1/2-, Reveal-, Export-, Secret-, SSE-, Build-, Health- und Port-Grenzen
müssen grün bleiben.
