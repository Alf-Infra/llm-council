const OPENROUTER_ORIGIN = 'https://openrouter.ai';
const MODELS_URL = `${OPENROUTER_ORIGIN}/api/v1/models`;

export const PRESETS = Object.freeze({
  fast: { id: 'fast', label: 'Schnell', mode: 'standard', council: ['google/gemini-2.5-flash-lite', 'openai/gpt-4.1-mini'], chairman: 'openai/gpt-4.1' },
  balanced: { id: 'balanced', label: 'Ausgewogen', mode: 'standard', council: ['openai/gpt-5.4', 'anthropic/claude-sonnet-4.6'], chairman: 'google/gemini-3.1-pro-preview' },
  thorough: { id: 'thorough', label: 'Gründlich', mode: 'iterative', council: ['openai/gpt-5.5', 'anthropic/claude-sonnet-4.6', 'google/gemini-3.1-pro-preview'], chairman: 'openai/gpt-5.4' }
});

export class OpenRouterCatalog {
  constructor({ fetchImpl = fetch, timeoutMs = 10000, maxBytes = 5_000_000, ttlMs = 15 * 60_000, now = () => Date.now() } = {}) {
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.maxBytes = maxBytes;
    this.ttlMs = ttlMs;
    this.now = now;
    this.cache = null;
  }

  async getModels({ refresh = false } = {}) {
    const ageMs = this.cache ? this.now() - this.cache.loadedAt : null;
    if (!refresh && this.cache && ageMs < this.ttlMs) return { models: this.cache.models, ageMs, stale: false };
    try {
      const response = await this.fetch(MODELS_URL, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(this.timeoutMs) });
      if (!response.ok) throw new Error(`Katalog HTTP ${response.status}`);
      const length = Number(response.headers.get('content-length') || 0);
      if (length > this.maxBytes) throw new Error('Katalogantwort ist zu groß.');
      const text = await readLimited(response, this.maxBytes);
      const models = parseCatalog(JSON.parse(text));
      this.cache = { models, loadedAt: this.now() };
      return { models, ageMs: 0, stale: false };
    } catch (error) {
      if (this.cache) return { models: this.cache.models, ageMs: this.now() - this.cache.loadedAt, stale: true, warning: 'OpenRouter ist vorübergehend nicht erreichbar; letzter Katalog wird verwendet.' };
      throw new Error('OpenRouter-Modellkatalog ist derzeit nicht verfügbar.');
    }
  }

  async validateSelection(modelIds) {
    const result = await this.getModels();
    const byId = new Map(result.models.flatMap((model) => [[model.id, model], ...(model.canonicalSlug ? [[model.canonicalSlug, model]] : [])]));
    return modelIds.map((requestedId) => {
      const id = String(requestedId || '').trim();
      const model = byId.get(id);
      let error = null;
      if (!id || !id.includes('/')) error = 'Vollständiger OpenRouter-Slug mit Organisationspräfix erforderlich.';
      else if (!model) error = 'Modell ist im aktuellen OpenRouter-Katalog nicht verfügbar.';
      else if (model.expiresAt && Date.parse(model.expiresAt) <= this.now()) error = 'Modell ist abgelaufen.';
      return { requestedId: id, ok: !error, error, canonicalSlug: model?.canonicalSlug || model?.id || null, model: model || null };
    });
  }
}

export function parseCatalog(payload) {
  if (!payload || !Array.isArray(payload.data)) throw new Error('Ungültiges Katalogschema.');
  return payload.data.map(projectModel).filter(Boolean);
}

function projectModel(raw) {
  if (!raw || typeof raw.id !== 'string' || !raw.id.includes('/')) return null;
  const output = raw.architecture?.output_modalities || raw.output_modalities || [];
  if (Array.isArray(output) && output.length && !output.includes('text')) return null;
  return {
    id: raw.id,
    canonicalSlug: typeof raw.canonical_slug === 'string' ? raw.canonical_slug : raw.id,
    name: typeof raw.name === 'string' ? raw.name.slice(0, 200) : raw.id,
    description: typeof raw.description === 'string' ? raw.description.slice(0, 1000) : '',
    contextLength: finiteOrNull(raw.context_length),
    inputModalities: stringArray(raw.architecture?.input_modalities),
    outputModalities: stringArray(output),
    supportedParameters: stringArray(raw.supported_parameters),
    expiresAt: typeof raw.expiration_date === 'string' ? raw.expiration_date : null,
    pricing: {
      prompt: priceOrNull(raw.pricing?.prompt),
      completion: priceOrNull(raw.pricing?.completion),
      request: priceOrNull(raw.pricing?.request)
    }
  };
}

export function callPlan(mode, councilCount) {
  const iterative = mode === 'iterative';
  return { mode: iterative ? 'iterative' : 'standard', baseCalls: (iterative ? 4 : 2) * councilCount + 1, repairCallsMax: iterative ? councilCount * 2 : councilCount };
}

export function estimateCost({ mode, councilModels, chairmanModel, prices, assumptions = { answerPrompt: 1500, answerCompletion: 1200, reviewPrompt: 5000, reviewCompletion: 900, chairmanPrompt: 8000, chairmanCompletion: 1800 } }) {
  const plan = callPlan(mode, councilModels.length);
  const lookup = (id) => prices[id];
  const cost = (id, prompt, completion, calls = 1) => {
    const p = lookup(id);
    if (!p || p.prompt == null || p.completion == null) return null;
    return calls * ((prompt * p.prompt) + (completion * p.completion) + (p.request || 0));
  };
  let total = 0;
  for (const id of councilModels) {
    const answer = cost(id, assumptions.answerPrompt, assumptions.answerCompletion, mode === 'iterative' ? 2 : 1);
    const review = cost(id, assumptions.reviewPrompt, assumptions.reviewCompletion, mode === 'iterative' ? 2 : 1);
    if (answer == null || review == null) return { ...plan, available: false, estimatedUsd: null, assumptions };
    total += answer + review;
  }
  const chairman = cost(chairmanModel, assumptions.chairmanPrompt, assumptions.chairmanCompletion);
  if (chairman == null) return { ...plan, available: false, estimatedUsd: null, assumptions };
  return { ...plan, available: true, estimatedUsd: total + chairman, assumptions };
}

export function validatePresets(models) {
  const available = new Set(models.map((model) => model.id));
  return Object.values(PRESETS).map((preset) => ({ ...preset, available: [...preset.council, preset.chairman].every((id) => available.has(id)) }));
}

async function readLimited(response, limit) {
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > limit) throw new Error('Katalogantwort ist zu groß.');
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new Error('Katalogantwort ist zu groß.'); }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

const finiteOrNull = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const priceOrNull = (value) => value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const stringArray = (value) => Array.isArray(value) ? value.filter((item) => typeof item === 'string').slice(0, 100) : [];
