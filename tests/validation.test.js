import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRuntimeConfig, safeUiConfig } from '../server/config.js';
import { normalizeRunRequest } from '../server/validation.js';

test('validates empty input, duplicate models and too few council members', () => {
  const config = loadRuntimeConfig({ LLM_API_KEY: 'secret-key' });
  const result = normalizeRunRequest({
    question: '',
    councilModels: ['gpt-5.5'],
    chairmanModel: 'gpt-5.5',
    criteria: []
  }, config);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /Frage/);
  assert.match(result.errors.join(' '), /mindestens zwei/);
});

test('safe UI config never exposes API key', () => {
  const safe = safeUiConfig(loadRuntimeConfig({ LLM_API_KEY: 'secret-key', LLM_API_BASE_URL: 'http://x/v1' }));
  assert.equal('apiKey' in safe, false);
  assert.equal(JSON.stringify(safe).includes('secret-key'), false);
});

test('normalizes OpenRouter model objects with provider context', () => {
  const provider = { id: 'openrouter', type: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-or-secret' };
  const result = normalizeRunRequest({
    question: 'Q?',
    councilModels: [{ provider, model: 'model-a' }, { provider, model: 'model-b' }],
    chairmanModel: { provider, model: 'model-c' },
    criteria: [{ id: 'correctness', weight: 1 }]
  }, loadRuntimeConfig());
  assert.equal(result.ok, true);
  assert.equal(result.value.councilModels[0].provider.apiKey, 'sk-or-secret');
  assert.equal(result.value.councilModels[0].provider.baseUrl, 'https://openrouter.ai/api/v1');
  assert.equal(result.value.councilModels[0].model, 'model-a');
});
