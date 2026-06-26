export function normalizeRunRequest(body, defaults) {
  const question = String(body?.question || '').trim();
  const councilModels = Array.isArray(body?.councilModels) ? body.councilModels.map((m) => normalizeModelRef(m, defaults)).filter(Boolean) : [];
  const chairmanModel = normalizeModelRef(body?.chairmanModel, defaults);
  const criteria = normalizeCriteria(body?.criteria, defaults.criteria);

  const errors = [];
  if (!question) errors.push('Bitte eine Frage eingeben.');
  if (councilModels.length < 2) errors.push('Bitte mindestens zwei Council-Modelle auswählen.');
  if (!chairmanModel) errors.push('Bitte genau ein Chairman-Modell auswählen.');
  if (new Set(councilModels.map((item) => item.key)).size !== councilModels.length) errors.push('Council-Modelle dürfen nicht doppelt vorkommen.');
  if (chairmanModel && councilModels.some((item) => item.key === chairmanModel.key)) errors.push('Chairman-Modell muss getrennt von den Council-Modellen sein.');
  if (!criteria.length) errors.push('Bitte mindestens ein Bewertungskriterium auswählen.');
  if (criteria.some((item) => !Number.isFinite(item.weight) || item.weight <= 0)) errors.push('Kriteriengewichte müssen größer als 0 sein.');
  if ([...councilModels, chairmanModel].filter(Boolean).some((item) => !item.provider.baseUrl)) errors.push('Provider Base URL fehlt.');

  return {
    ok: errors.length === 0,
    errors,
    value: { question, councilModels, chairmanModel, criteria, conversationId: body?.conversationId || null }
  };
}

export function normalizeModelRef(input, defaults) {
  if (typeof input === 'string') {
    const model = input.trim();
    if (!model) return null;
    const provider = {
      id: 'env',
      type: 'openai-compatible',
      label: 'ENV fallback',
      baseUrl: defaults.apiBaseUrl,
      apiKey: defaults.apiKey || '',
      requestTimeoutMs: defaults.requestTimeoutMs,
      maxOutputTokens: defaults.maxOutputTokens
    };
    return toModelRef({ provider, model });
  }

  const model = String(input?.model || '').trim();
  if (!model) return null;
  const providerInput = input.provider || input;
  const provider = {
    id: String(providerInput.providerId || providerInput.id || 'openrouter').trim() || 'openrouter',
    type: String(providerInput.providerType || providerInput.type || 'openrouter').trim() || 'openrouter',
    label: String(providerInput.providerLabel || providerInput.label || 'OpenRouter').trim() || 'OpenRouter',
    baseUrl: String(providerInput.baseUrl || 'https://openrouter.ai/api/v1').trim(),
    apiKey: String(providerInput.apiKey || ''),
    requestTimeoutMs: defaults.requestTimeoutMs,
    maxOutputTokens: defaults.maxOutputTokens
  };
  return toModelRef({ provider, model });
}

export function safeModelRef(ref) {
  return {
    key: ref.key,
    model: ref.model,
    provider: {
      id: ref.provider.id,
      type: ref.provider.type,
      label: ref.provider.label,
      baseUrl: ref.provider.baseUrl
    }
  };
}

function toModelRef({ provider, model }) {
  const key = `${provider.id}:${provider.baseUrl}:${model}`;
  return { key, model, provider };
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
