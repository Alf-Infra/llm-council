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
