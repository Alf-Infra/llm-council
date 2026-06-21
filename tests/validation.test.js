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
