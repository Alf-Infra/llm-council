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
