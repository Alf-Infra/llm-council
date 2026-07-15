# MEMORY — llm-council

## Iterationen

### v1 (2026-06-21)

- Auftrag: Eigene Web-App nach Karpathys LLM-Council-Prinzip mit parallelen Antworten, anonymisiertem Peer-Review und Chairman-Synthese.
- Codex-Commits: `65e6173`, `7c51771`, `524e479`, `686b640`, `cedd36b`, `c7da97f`
- Besonderheiten: OpenAI-kompatibler Backend-Endpunkt; strukturierte Reviews, SQLite-Persistenz, Streaming sowie Token-/Laufzeittransparenz.
- Reviewer-Finale: Reveal-Timing, Export-Sperre vor Reveal und atomische Modellfreigabe ueber SSE, Detail-GET und Export sind abgedeckt.

### v1.2 (2026-06-26)

- Auftrag: Direkte OpenRouter-Konfiguration in der Eingabemaske, frei editierbare OpenRouter-Modelle und API-Key pro Run.
- Entscheidung: Zunaechst keine LiteLLM-Schicht; OpenRouter ist der primaere Provider fuer groesstmoegliche Modell-Auswahl.
- Sicherheitsgrenze: API-Keys duerfen nur fluechtig fuer den Run genutzt werden und nicht in SQLite, Exporten, Logs oder UI-Projektionen landen.
- Codex-Commit: `1ad121f`
- Tester-Finale: 24/24 Tests gruen, Build gruen, `/health`, Root-Route, `/api/config`, Validierungsfehler und Secret-Redaction geprueft.
- Reviewer-Finale: Gate gruen ohne Concerns; Provider-Kontext, Reveal-Grenzen, `process.env.PORT` und fehlende Secret-Persistenz bestaetigt.

### v1.3 (2026-07-15)

- Auftrag: Paket 1 der Weiterentwicklung — bestätigte Stabilitäts-, Responsive- und Accessibility-Fehler beheben und verbindliche Frontend-Regressionstests einführen.
- Abgrenzung: Noch kein visuelles Redesign und keine OpenRouter-Katalog-/Preset-/Kosten-Erweiterungen; diese folgen nach separater Prüfung in Paket 2 und 3.
- Codex-Commits: `6c91408`, `223d80c`.
- Ergebnis: Stabile Modellzeilen ohne Fokusverlust; konsistenter History-, Export-, Reset- und Terminalzustand; barrierearme Tastatur-, Formular-, Tabellen-, Phasen- und Live-Status-Semantik; mobile Layouts bei 320/390/430 px ohne Dokumentoverflow.
- Tester-Finale: 24 Backendtests und 9 Playwright/Axe-Tests grün; Produktions-Build, `/health`, Root-Route, Reveal-Grenzen und Port-Freigabe bestätigt.
- Reviewer-Finale: Gate grün ohne Concerns; Live-Regionen sind kurz, atomar und angemessen dosiert, Fehler behalten `role="alert"`.

### v1.4 (2026-07-15)

- Auftrag: Paket 2 — visueller und informationeller Umbau zum fokussierten Council Analysis Workspace mit einklappbarer History/Konfiguration, kompakten Ergebnisansichten, Antwortvergleich und strukturierten Reviews.
- Bündelung: Der nach v1.3 im echten Produktionslauf entdeckte moderate Axe-Fehler `heading-order` wird auf Kevins Wunsch im selben Build-/Test-/Review-Zyklus behoben.
- Abgrenzung: OpenRouter-Katalog, Presets, Kosten und erweiterte Laufhistorie bleiben Paket 3.
- Kevin hat nach ausgeschöpften zwei regulären Build-Versuchen einen dritten, eng begrenzten Fix für die Fokus-Rückgabe beim Backdrop-Schließen des mobilen Konfigurationsdrawers freigegeben.
- Gate-Override: Kevin hat am 2026-07-15 Variante B und damit den Deploy trotz rotem finalem Tester-Gate ausdrücklich freigegeben. Akzeptierte Einschränkung: Im mobilen 390-px-Konfigurationsdialog sind Header, Workspace und Skip-Link nicht wirksam `inert`; Desktop ist nicht betroffen, Fokusfalle und Fokus-Rückgabe funktionieren. Dieser Restpunkt wird mit Paket 3 behoben.
- Deploy: GitHub-Push und PM2-Restart erfolgreich; Produktions-Healthcheck auf Port 3110 grün. Deploy-Commit: `1f897ff`.

### v1.4.1 (2026-07-15)

- Auftrag: Paket 2 vollständig abschließen. Desktop-History wirklich einklappbar machen und die mobile modale Hintergrundisolation für Konfigurations- und History-Drawer wirksam korrigieren.
- Abgrenzung: Paket 3 bleibt vollständig außen vor. Deployment erst nach neuem grünem Tester- und Reviewer-Gate.
- Codex-Commit: `e176339`.
- Ergebnis: Desktop-History klappt vollständig ein und gibt ihre Grid-Breite frei; beide mobilen Drawer setzen und entfernen die Hintergrundisolation wirksam per `inert`, bei erhaltener Fokusfalle, Escape-/Backdrop-Bedienung und exakter Fokus-Rückgabe.
- Tester-Finale: 24 Backendtests und 19 Playwright/Axe-Tests grün; Produktions-Build, `/health`, Root-Route, Port-Freigabe und alle Reveal-/Export-/Secret-/SSE-Grenzen bestätigt.
- Reviewer-Finale: Gate grün ohne Concerns; Produktionsregressionen und Umfangsabgrenzung zu Paket 3 unabhängig bestätigt.

### v1.5 (2026-07-15)

- Auftrag: Paket 3 — dynamischer OpenRouter-Katalog, gültige Modellkennungen, Presets und 3-/5-Phasenmodi, vollständige Vorabvalidierung, transparente Call-/Kostenprognose, historische Preissnapshots, vollständige Run-Auswahl, Konfigurationsübernahme und flüchtige API-Key-Regeln.
- Integrationsentscheidung: Modell- und Preisfelder kommen aus den offiziellen OpenRouter-Modellendpunkten; Tests verwenden ausschließlich injizierbare Fixtures und verursachen keine realen Modellkosten.
- Abgrenzung: Keine weiteren Provider, keine LiteLLM-Schicht, keine Accounts und keine persistierten API-Keys. Paket-1/2-Grenzen bleiben verbindlich.
- Kevin hat nach rotem Review des zweiten v1.5-Builds einen dritten, eng auf drei Punkte begrenzten Fixversuch freigegeben: stale Katalog blockiert Run-Starts, Aliase werden vor jeder Seiteneffektgrenze kanonisiert und Preissnapshots entstehen ausschließlich aus dem frischen serverseitigen Katalog.
- Kevin hat nach dem dritten v1.5-Build einen vierten, ausschließlich auf die erneute kanonische Invariantenprüfung begrenzten Fixversuch freigegeben: Alias-Kollisionen dürfen weder doppelte Council-Modelle noch Chairman = Council erzeugen und müssen vor jeder Seiteneffektgrenze mit 422 enden.
- Codex-Commits: `369fd96`, `c71f739`, `b6da128`, `c520a27`.
- Ergebnis: Sicherer dynamischer OpenRouter-Katalog mit Fresh-/Stale-Semantik, katalogvalidierte Presets und 3-/5-Phasenmodi, serverautoritativ kanonisierte Auswahl und Preise, transparente Call-/Kostenprognose, stabile historische Preissnapshots, vollständige Run-Auswahl und Konfigurationsübernahme ohne API-Key. Stale oder kanonisch kollidierende Auswahlen enden vor jeder Seiteneffektgrenze mit klarer 503-/422-Semantik.
- Tester-Finale: 38 Backendtests und 21 Playwright/Axe-Tests grün; Build, HTTP-Smokes, Portbereinigung, Secret-Lebenszyklus, Run-State und alle Paket-1/2-Grenzen bestätigt.
- Reviewer-Finale: Gate grün ohne Concerns; V15-002 bis V15-004 und die kanonische Auswahl-Invariante sind geschlossen.

### v1.5.1 (2026-07-15)

- Auftrag: Produktive Darstellung des OpenRouter-Modellkatalogs lesbar und übersichtlich machen; lange Treffer dürfen im schmalen Konfigurationsbereich nicht überlappen.
- Abgrenzung: Reiner UI-/Accessibility-Fix. Direkter offizieller OpenRouter-Katalog, 15-Minuten-Cache, Safe-Field-Projektion, Validierung und alle übrigen v1.5-Funktionen bleiben unverändert.
- Codex-Commit: `40da231`.
- Ergebnis: Selbstständig wachsende, responsive Katalogkarten mit klarer Name-/Slug-/Metadatenhierarchie, beschrifteten Input-/Outputpreisen, verständlichem Leerzustand und eindeutigem „Modell hinzufügen“. Die Trefferliste bleibt in 340-px-Rail und mobilem Drawer intern scrollbar und overflow-frei.
- Tester-Finale: 38 Backendtests und 22 Playwright/Axe-Tests grün; Bounding-Box-, Overflow-, Keyboard- und Axe-Regressionsprüfung sowie Build, HTTP-Smokes und Portbereinigung bestätigt.
- Reviewer-Finale: Gate grün ohne Concerns; Diff auf UI/Styles/Test begrenzt, alle v1.5- und Paket-1/2-Grenzen unverändert.

### v1.5.2 (2026-07-15)

- Auftrag: Chairman-Stufe so ausrichten, dass sie aus Council-Antworten, Reviews und Ranking eine direkte, eigenständige bestmögliche Endantwort erzeugt statt eines Modellvergleichs.
- Designentscheidung: Modell- und Providernamen bleiben für die UI transparent, werden im Chairman-Arbeitsmaterial jedoch durch anonyme Kandidatenbezeichnungen ersetzt. Reviews und Ranking dienen ausschließlich als interne Qualitätssignale.
- Oberfläche: Ergebnisansicht „Synthese“ wird in „Endantwort“ umbenannt; übrige Transparenz-Tabs bleiben erhalten.
- Abgrenzung: Keine Änderung an Katalog, Validierung, Preisen, Presets, Secrets oder Persistenz. Deployment erst nach grünem Tester- und Reviewer-Gate.
- Kevin hat nach dem gelben Review des zweiten Builds einen dritten, ausschließlich auf drei dauerhaft committed Offline-Fachszenarien begrenzten Versuch freigegeben. Der bestätigte Chairman-Produktionscode darf dabei nicht erneut verändert werden.
- Codex-Commits: `0d4c203`, `3dc02aa`, `0652680`.
- Ergebnis: Der Chairman erhält alle Kandidaten und die vollständige anonymisierte Qualitätsreihenfolge als internes Material, jedoch keine Rangnummern, Scores, Stimmen, IDs oder Modell-/Provider-/Reviewerattributionen. Seine Ausgabe ist eine direkte eigenständige Antwort ohne Council-, Vergleichs- oder Ranking-Metakommentar.
- Tester-Finale: 43 Backendtests und 22 Playwright/Axe-Tests grün; darin genau drei deterministische Offline-Orchestrator-Regressionen für Wissensfrage, Empfehlung und kontroverse Frage. Build, HTTP-Smokes und Portbereinigung bestätigt.
- Reviewer-Finale: Gate grün ohne Concerns; Fix-3-Diff ausschließlich in `tests/orchestrator.test.js`, Produktionscode und bestätigte Prompt-Projektion unverändert.
