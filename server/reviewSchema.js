export function validateReviewPayload(payload, anonymousIds, criteriaIds) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, error: 'Review ist kein JSON-Objekt.' };
  if (!Array.isArray(payload.responses)) return { ok: false, error: 'responses fehlt oder ist keine Liste.' };
  if (!Array.isArray(payload.ranking)) return { ok: false, error: 'ranking fehlt oder ist keine Liste.' };

  const ids = new Set(anonymousIds);
  const criteria = new Set(criteriaIds);
  const seen = new Set();
  for (const entry of payload.responses) {
    if (!entry || typeof entry !== 'object') return { ok: false, error: 'Antwortbewertung ist ungültig.' };
    if (!ids.has(entry.responseId)) return { ok: false, error: `Unbekannte Antwort-ID: ${entry.responseId}` };
    if (seen.has(entry.responseId)) return { ok: false, error: `Doppelte Antwortbewertung: ${entry.responseId}` };
    seen.add(entry.responseId);
    if (typeof entry.rationale !== 'string' || !entry.rationale.trim()) return { ok: false, error: 'Begründung fehlt.' };
    if (!Array.isArray(entry.strengths) || !Array.isArray(entry.weaknesses)) return { ok: false, error: 'Stärken oder Schwächen fehlen.' };
    if (entry.detailed_analysis !== undefined && typeof entry.detailed_analysis !== 'string') return { ok: false, error: 'detailed_analysis muss ein String sein.' };
    if (!entry.scores || typeof entry.scores !== 'object') return { ok: false, error: 'scores fehlt.' };
    const scoreKeys = Object.keys(entry.scores);
    if (scoreKeys.length !== criteriaIds.length || scoreKeys.some((key) => !criteria.has(key))) return { ok: false, error: 'scores enthält unbekannte oder fehlende Kriterien.' };
    for (const criterion of criteriaIds) {
      const score = entry.scores[criterion];
      if (!Number.isInteger(score) || score < 1 || score > 10) return { ok: false, error: `Score ${criterion} muss 1-10 sein.` };
    }
  }
  if (seen.size !== anonymousIds.length) return { ok: false, error: 'Nicht alle Antworten wurden bewertet.' };
  if (payload.ranking.length !== anonymousIds.length) return { ok: false, error: 'Ranking enthält nicht alle Antworten.' };
  if (new Set(payload.ranking).size !== payload.ranking.length || payload.ranking.some((id) => !ids.has(id))) return { ok: false, error: 'Ranking enthält ungültige Antwort-IDs.' };
  return { ok: true, value: payload };
}

export function extractJsonObject(text) {
  const raw = String(text || '').trim();
  try {
    return JSON.parse(raw);
  } catch {}
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return JSON.parse(raw.slice(start, end + 1));
  }
  throw new Error('Ungültiges JSON');
}

export function buildReviewRepairPrompt(invalidText, error, anonymousIds, criteria) {
  return [
    'Repariere die folgende Peer-Review-Ausgabe zu streng validem JSON.',
    'Gib ausschließlich JSON zurück, kein Markdown.',
    `Erlaubte responseId-Werte: ${anonymousIds.join(', ')}`,
    `Pflichtkriterien: ${criteria.map((c) => c.id).join(', ')}`,
    `Validierungsfehler: ${error}`,
    'Schema: {"responses":[{"responseId":"Response A","scores":{"correctness":1},"rationale":"kurz","strengths":["..."],"weaknesses":["..."],"detailed_analysis":"Freitextanalyse"}],"ranking":["Response A"]}',
    'Ungültige Ausgabe:',
    invalidText
  ].join('\n');
}
