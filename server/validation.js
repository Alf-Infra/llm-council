export function normalizeRunRequest(body, defaults) {
  const question = String(body?.question || '').trim();
  const councilModels = Array.isArray(body?.councilModels) ? body.councilModels.map((m) => String(m).trim()).filter(Boolean) : [];
  const chairmanModel = String(body?.chairmanModel || '').trim();
  const criteria = normalizeCriteria(body?.criteria, defaults.criteria);

  const errors = [];
  if (!question) errors.push('Bitte eine Frage eingeben.');
  if (councilModels.length < 2) errors.push('Bitte mindestens zwei Council-Modelle auswählen.');
  if (!chairmanModel) errors.push('Bitte genau ein Chairman-Modell auswählen.');
  if (new Set(councilModels).size !== councilModels.length) errors.push('Council-Modelle dürfen nicht doppelt vorkommen.');
  if (councilModels.includes(chairmanModel)) errors.push('Chairman-Modell muss getrennt von den Council-Modellen sein.');
  if (!criteria.length) errors.push('Bitte mindestens ein Bewertungskriterium auswählen.');
  if (criteria.some((item) => !Number.isFinite(item.weight) || item.weight <= 0)) errors.push('Kriteriengewichte müssen größer als 0 sein.');

  return {
    ok: errors.length === 0,
    errors,
    value: { question, councilModels, chairmanModel, criteria, conversationId: body?.conversationId || null }
  };
}

function normalizeCriteria(input, defaults) {
  const source = Array.isArray(input) && input.length ? input : defaults;
  const known = new Map(defaults.map((item) => [item.id, item]));
  return source
    .map((item) => {
      const id = String(item?.id || '').trim();
      if (!known.has(id)) return null;
      return {
        id,
        label: known.get(id).label,
        weight: Number(item?.weight ?? known.get(id).defaultWeight ?? 1)
      };
    })
    .filter(Boolean);
}
